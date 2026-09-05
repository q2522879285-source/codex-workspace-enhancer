import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  function ', start + 1));
}

test('skill attachments use native nodes, deduplicate, preserve text and remove only in their task', () => {
  const text = { type: { name: 'text' }, text: '原有草稿', marks: ['bold'], nodeSize: 4 };
  let nodes = [text], active = 'a', dispatches = 0, syncs = 0;
  const skillMention = { create: attrs => ({ type: { name: 'skillMention' }, attrs, nodeSize: 1 }) };
  const state = {
    schema: { nodes: { skillMention } },
    get doc() {
      return { descendants(fn) {
        const paragraph = { isTextblock: true, type: { name: 'paragraph', contentMatch: { matchType: () => true } } };
        if (fn(paragraph, 0) === false) return;
        let pos = 1;
        for (const node of nodes) { fn(node, pos); pos += node.nodeSize; }
      } };
    },
    get tr() {
      const operations = [];
      return {
        operations,
        insert(pos, node) { operations.push(['insert', pos, node]); return this; },
        delete(from, to) { operations.push(['delete', from, to]); return this; },
      };
    },
  };
  const controller = { view: { state, dispatch(tr) {
    dispatches++;
    for (const [operation, pos, value] of tr.operations) {
      if (operation === 'insert') { assert.equal(pos, 1); nodes.unshift(value); }
      else {
        let offset = 1;
        nodes = nodes.filter(node => { const keep = offset < pos || offset >= value; offset += node.nodeSize; return keep; });
      }
    }
  } } };
  const context = vm.createContext({
    taskSkillComposerController: () => controller,
    ensureTaskSkillComposerChips: () => syncs++,
    normalizedThreadId: value => value,
    currentConversationThreadId: () => active,
  });
  for (const name of ['taskComposerSkills', 'addNativeTaskSkill', 'removeNativeTaskSkill']) vm.runInContext(extract(name), context);
  const entry = { name: 'concise', title: '简洁输出', path: 'C:/skills/concise/SKILL.md' };
  assert.equal(context.addNativeTaskSkill(entry), true);
  assert.equal(context.addNativeTaskSkill(entry), true);
  assert.equal(dispatches, 1);
  assert.equal(nodes[0].type.name, 'skillMention');
  assert.equal(nodes[0].attrs.path, entry.path);
  assert.equal(nodes[1], text);
  assert.equal(context.addNativeTaskSkill({ ...entry, path: '', enabled: false }), false);
  active = 'b';
  context.removeNativeTaskSkill(entry.path, 'a');
  assert.equal(dispatches, 1);
  active = 'a';
  context.removeNativeTaskSkill(entry.path, 'a');
  assert.deepEqual(nodes, [text]);
  assert.equal(syncs, 2);
  assert.doesNotMatch(extract('addTaskSkillRequest'), /addTextToComposer|submit|sendMessage/);
  context.taskSkillComposerController = () => null;
  assert.equal(context.addNativeTaskSkill(entry), false);
});

test('clearing skill chips clears selected status without hiding an error', () => {
  let removed = 0;
  const status = { textContent: '已选中技能，随你的下一条消息使用。' };
  const context = vm.createContext({
    document: {
      querySelector: selector => selector === '[data-task-skill-status]' ? status : {},
      getElementById: () => ({ remove: () => removed++ }),
    },
    taskComposerSkills: () => [],
    taskSkillComposerController: () => null,
    isTaskShell: () => true,
  });
  vm.runInContext(extract('ensureTaskSkillComposerChips'), context);
  context.ensureTaskSkillComposerChips();
  assert.equal(status.textContent, '选中后显示在输入框上方，随消息使用。');
  status.textContent = '当前输入框暂不支持技能附件。';
  context.ensureTaskSkillComposerChips();
  assert.equal(status.textContent, '当前输入框暂不支持技能附件。');
  assert.equal(removed, 2);
});
