import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const key = 'codex-workspace-enhancer:task-notes-v1';
class Element {
  constructor(tagName) { this.tagName = tagName; }
  children = [];
  attributes = {};
  value = '';
  textWrites = 0;
  _textContent = '';
  get textContent() { return this._textContent; }
  set textContent(value) { this.textWrites++; this._textContent = value; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() { this.focused = true; }
  querySelector(selector) {
    const attr = selector.slice(1, -1);
    for (const child of this.children) {
      if (attr in child.attributes) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}
function fixture(initial = {}) {
  const storage = new Map([[key, JSON.stringify(initial)]]);
  let fail = false;
  let writes = 0;
  const context = vm.createContext({
    document: { createElement: tag => new Element(tag) },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => {
      if (fail) throw new Error('Storage full');
      writes++;
      storage.set(key, value);
    } },
  });
  for (const name of ['cleanTaskPreviewText', 'taskOverviewPresentation', 'taskContextForSnapshot', 'createTaskAutoContextSection', 'renderTaskAutoContextSection', 'createTaskExcerptSection', 'renderTaskExcerptSection', 'readTaskNotesStore', 'createTaskNotesSection', 'renderTaskNotesSection', 'editTaskNotes', 'saveTaskNotes', 'cancelTaskNotes']) {
    const start = source.indexOf(`  function ${name}(`);
    assert.notEqual(start, -1, name);
    vm.runInContext(source.slice(start, source.indexOf('\n  }', start) + 4), context);
  }
  const section = context.createTaskNotesSection();
  const find = (attr) => section.querySelector(`[data-codex-task-${attr}]`);
  const input = (field, value) => { const node = find(`note-input-${field}`); node.value = value; node.oninput(); };
  return { context, section, find, input, storage, get writes() { return writes; }, fail: () => { fail = true; } };
}

test('drafts are isolated per task and survive switching without persistence', () => {
  const f = fixture();
  f.context.editTaskNotes(f.section, { threadId: 'a' });
  f.input('conclusion', 'A 草稿');
  f.input('nextStep', 'A 下一步');
  f.context.renderTaskNotesSection(f.section, { threadId: 'b' });
  assert.equal(f.find('note-input-conclusion').value, '');
  f.context.editTaskNotes(f.section, { threadId: 'b' });
  f.input('conclusion', 'B 草稿');
  f.context.renderTaskNotesSection(f.section, { threadId: 'a' });
  assert.equal(f.find('note-input-conclusion').value, 'A 草稿');
  assert.equal(f.find('note-input-nextStep').value, 'A 下一步');
  assert.equal(f.writes, 0);
});

test('recreating the section retains unsaved drafts in the same runtime', () => {
  const f = fixture();
  f.context.editTaskNotes(f.section, { threadId: 'a' });
  f.input('conclusion', '保留的草稿');
  f.input('nextStep', '保留的下一步');
  const replacement = f.context.createTaskNotesSection();
  f.context.renderTaskNotesSection(replacement, { threadId: 'a' });
  assert.equal(replacement.querySelector('[data-codex-task-note-input-conclusion]').value, '保留的草稿');
  assert.equal(replacement.querySelector('[data-codex-task-note-input-nextStep]').value, '保留的下一步');
  assert.equal(replacement.querySelector('[data-codex-task-notes-editor]').hidden, false);
  assert.equal(f.writes, 0);
});

test('only explicit save persists both fields; cancel restores saved values', () => {
  const f = fixture({ b: { conclusion: 'B 已存', nextStep: '' } });
  f.context.editTaskNotes(f.section, { threadId: 'a' });
  f.input('conclusion', 'A 已确认');
  f.input('nextStep', 'A 待执行');
  f.find('notes-save').onclick();
  assert.deepEqual(JSON.parse(f.storage.get(key)), { a: { conclusion: 'A 已确认', nextStep: 'A 待执行' }, b: { conclusion: 'B 已存', nextStep: '' } });
  assert.equal(f.find('notes-editor').hidden, true);
  f.find('notes-edit').onclick();
  f.input('conclusion', '丢弃草稿');
  f.find('notes-cancel').onclick();
  assert.equal(f.find('note-input-conclusion').value, 'A 已确认');
  f.find('notes-edit').onclick();
  f.input('nextStep', '丢弃下一步');
  f.find('notes-cancel').onclick();
  assert.equal(f.find('note-input-nextStep').value, 'A 待执行');
  assert.equal(f.writes, 1);
});

test('excerpt remains an unconfirmed draft and fields have basic form semantics', () => {
  const f = fixture();
  f.context.renderTaskNotesSection(f.section, { threadId: 'a', latestAnswer: '**答复摘录**' });
  f.find('notes-edit').onclick();
  f.find('notes-excerpt').onclick();
  assert.equal(f.find('note-input-conclusion').value, '答复摘录');
  assert.equal(f.find('note-conclusion').textContent, '暂无');
  assert.equal(f.writes, 0);
  for (const field of ['conclusion', 'nextStep']) assert.equal(f.find(`note-input-${field}`).maxLength, 4000);
  for (const action of ['save', 'cancel', 'edit', 'excerpt']) assert.equal(f.find(`notes-${action}`).type, 'button');
});

test('empty notes use one compact state and one entry, saved fields remain explicit', () => {
  const f = fixture({ b: { conclusion: '已确认原文\n第二行', nextStep: '' } });
  f.context.renderTaskNotesSection(f.section, { threadId: 'a' });
  assert.equal(f.find('notes-empty').hidden, false);
  assert.equal(f.find('notes-view').hidden, true);
  assert.equal(f.find('notes-edit').hidden, false);
  for (const action of ['save', 'cancel', 'excerpt']) assert.equal(f.find(`notes-${action}`).hidden, true);
  f.find('notes-edit').onclick();
  assert.equal(f.find('notes-empty').hidden, true);
  assert.equal(f.find('notes-edit').hidden, true);
  assert.equal(f.find('notes-excerpt').hidden, false);
  f.context.renderTaskNotesSection(f.section, { threadId: 'b' });
  assert.equal(f.find('notes-view').hidden, false);
  assert.equal(f.find('notes-empty').hidden, true);
  assert.equal(f.find('note-conclusion').textContent, '已确认原文\n第二行');
  assert.equal(f.find('note-nextStep').textContent, '暂无');
  assert.equal(f.writes, 0);
});

test('native excerpt starts collapsed and preserves task-specific expansion across updates and switches', () => {
  const f = fixture();
  const section = f.context.createTaskExcerptSection();
  assert.equal(section.tagName, 'details');
  assert.equal(section.children[0].tagName, 'summary');
  f.context.renderTaskExcerptSection(section, { threadId: 'a', latestAnswer: '第一条' });
  assert.equal(section.open, false);
  section.open = true;
  section.ontoggle();
  f.context.renderTaskExcerptSection(section, { threadId: 'a', latestAnswer: '更新的答复' });
  assert.equal(section.open, true);
  assert.equal(section.children[1].textContent, '更新的答复');
  f.context.renderTaskExcerptSection(section, { threadId: 'b' });
  assert.equal(section.open, false);
  f.context.renderTaskExcerptSection(section, { threadId: 'a' });
  assert.equal(section.open, true);
  const replacement = f.context.createTaskExcerptSection();
  f.context.renderTaskExcerptSection(replacement, { threadId: 'a' });
  assert.equal(replacement.open, true);
  section.open = false;
  section.ontoggle();
  f.context.renderTaskExcerptSection(section, { threadId: 'b' });
  f.context.renderTaskExcerptSection(section, { threadId: 'a' });
  assert.equal(section.open, false);
  assert.equal(f.writes, 0);
});

test('storage failure leaves draft editable with visible error and no false success', () => {
  const f = fixture({ a: { conclusion: '原值', nextStep: '' } });
  f.context.editTaskNotes(f.section, { threadId: 'a' });
  f.input('conclusion', '未存值');
  f.fail();
  f.find('notes-save').onclick();
  assert.match(f.find('notes-error').textContent, /保存失败/);
  assert.equal(f.find('notes-editor').hidden, false);
  assert.equal(f.find('note-input-conclusion').value, '未存值');
  assert.equal(JSON.parse(f.storage.get(key)).a.conclusion, '原值');
  assert.equal(f.writes, 0);
});

test('unchanged render preserves text nodes while refreshing the snapshot', () => {
  const f = fixture({ a: { conclusion: '已确认', nextStep: '待执行' } });
  f.context.renderTaskNotesSection(f.section, { threadId: 'a' });
  const nodes = ['note-conclusion', 'note-nextStep', 'notes-error'].map(f.find);
  const counts = nodes.map((node) => node.textWrites);
  const snapshot = { threadId: 'a', latestAnswer: '新摘录' };
  f.context.renderTaskNotesSection(f.section, snapshot);
  assert.deepEqual(nodes.map((node) => node.textWrites), counts);
  assert.equal(f.section.taskNotesSnapshot, snapshot);
  f.context.editTaskNotes(f.section, snapshot);
  f.input('conclusion', '草稿');
  f.fail();
  f.find('notes-save').onclick();
  const errorCounts = nodes.map((node) => node.textWrites);
  f.context.renderTaskNotesSection(f.section, snapshot);
  assert.deepEqual(nodes.map((node) => node.textWrites), errorCounts);
  assert.equal(f.find('note-input-conclusion').value, '草稿');
});

test('automatic context updates without replacing manual notes or active drafts', () => {
  const f = fixture({ a: { conclusion: '用户原笔记', nextStep: '用户下一步' } });
  const taskContext = { threadId: 'a', goal: '目标', progress: '助手已验证', nextStep: '待用户看效果', agreements: ['保留项目布局'], updatedAt: '2026-09-05T16:00:00Z' };
  const snapshot = { threadId: 'a', taskContext };
  f.context.renderTaskNotesSection(f.section, snapshot);
  assert.equal(f.find('notes-edit').textContent, '补充 / 纠正');
  f.find('notes-edit').onclick();
  f.input('conclusion', '尚未保存的纠正');
  const input = f.find('note-input-conclusion');
  const auto = f.context.createTaskAutoContextSection();
  f.context.renderTaskAutoContextSection(auto, snapshot);
  const progress = auto.querySelector('[data-codex-task-auto-progress]');
  assert.equal(progress.textContent, '助手已验证');
  const writes = progress.textWrites;
  f.context.renderTaskAutoContextSection(auto, snapshot);
  assert.equal(progress.textWrites, writes);
  const updated = { ...snapshot, taskContext: { ...taskContext, progress: '按用户反馈继续调整' } };
  f.context.renderTaskAutoContextSection(auto, updated);
  f.context.renderTaskNotesSection(f.section, updated);
  assert.equal(progress.textContent, '按用户反馈继续调整');
  assert.equal(f.find('note-input-conclusion'), input);
  assert.equal(input.value, '尚未保存的纠正');
  assert.equal(JSON.parse(f.storage.get(key)).a.conclusion, '用户原笔记');
  assert.equal(f.writes, 0);
});

test('automatic context only appears for its exact task and falls back to existing notes', () => {
  const f = fixture();
  const auto = f.context.createTaskAutoContextSection();
  const context = { threadId: 'a', goal: '目标', progress: '进展', nextStep: '', agreements: [], updatedAt: '2026-09-05T16:00:00Z' };
  for (const id of ['a', 'local:a', 'cloud:a']) {
    f.context.renderTaskAutoContextSection(auto, { threadId: id, taskContext: context });
    assert.equal(auto.hidden, false);
    assert.equal(auto.querySelector('[data-codex-task-auto-nextStep]').textContent, '暂无待办');
  }
  for (const snapshot of [{ threadId: 'b', taskContext: context }, { threadId: 'a' }, { taskContext: context }]) {
    f.context.renderTaskAutoContextSection(auto, snapshot);
    f.context.renderTaskNotesSection(f.section, snapshot);
    assert.equal(auto.hidden, true);
    assert.equal(f.find('notes-edit').textContent, '编辑笔记');
    assert.equal(f.find('notes-empty').hidden, false);
  }
});
