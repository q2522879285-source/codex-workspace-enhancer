import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  function ', start + 1));
};

test('right Skills reuses categories and favorites without editing the current draft', () => {
  class Element {
    children = []; nodes = new Map(); attrs = {}; dataset = {}; value = ''; isConnected = true;
    setAttribute(k, v) { this.attrs[k] = v; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    querySelector(k) { if (!this.nodes.has(k)) this.nodes.set(k, new Element()); return this.nodes.get(k); }
    querySelectorAll() { return []; }
  }
  const section = new Element();
  section.skillFilter = '常用';
  const favorites = new Set(['Concise']);
  let active = 'a', draft = '原有草稿', saves = 0, requests = 0;
  const selected = [];
  const context = vm.createContext({
    SKILL_CATEGORIES: [{label:'画面风格',keywords:['视觉','风格']}],
    taskSkillCatalog: { entries: [
      { name: 'concise', title: 'Concise', description: '简短输出', path: 'C:/concise/SKILL.md' },
      { name: 'design', title: 'Design', description: '界面视觉风格设计', path: 'C:/design/SKILL.md', enabled: false },
    ] },
    SKILL_DESCRIPTION_OVERRIDES: new Map(), skillOrganizerRenderSignature: '', skillOrganizerFavorites: favorites,
    document: { createElement: () => new Element(), querySelector: () => ({}) },
    normalizedSkillText: value => value.toLowerCase().trim(),
    loadSkillFavorites: () => favorites, saveSkillFavorites: () => saves++, renderSkillOrganizer() {},
    currentConversationThreadId: () => active,
    addTextToComposer: text => { draft += '\n' + text; return true; },
    addNativeTaskSkill: entry => { selected.push(entry); return true; },
    requestTaskSkillCatalog: () => requests++,
  });
  vm.runInContext(source.slice(source.indexOf('  const SKILL_FILTERS ='), source.indexOf('  function skillCategoryMatches(')), context);
  for (const name of ['skillCategoryMatches', 'groupedSkillEntries', 'normalizedThreadId', 'taskContextForSnapshot', 'taskSkillRequest', 'addTaskSkillRequest', 'renderTaskSkillList', 'renderTaskSkillsSection']) vm.runInContext(extract(name), context);
  const snapshot = { threadId: 'a', taskContext: { threadId: 'a', agreements: ['默认执行 · 少废话：直接给结果。', '保留界面'] } };
  context.renderTaskSkillsSection(section, snapshot);
  const list = section.querySelector('[data-task-skill-list]');
  assert.equal(list.children.length, 1);
  const invoke = list.children[0].children[0];
  invoke.onclick();
  assert.equal(draft, '原有草稿');
  assert.equal(selected[0].path, 'C:/concise/SKILL.md');
  assert.match(section.querySelector('[data-task-skill-status]').textContent, /已选中技能/);
  const defaults = section.querySelector('[data-task-skill-defaults]');
  assert.equal(defaults.children.length, 1);
  assert.equal(defaults.children[0].onclick, undefined);
  assert.equal(draft, '原有草稿');
  list.children[0].children[1].onclick();
  assert.equal(favorites.size, 0);
  assert.equal(saves, 1);
  section.querySelector('[data-task-skill-search]').value = '界面';
  context.renderTaskSkillList(section);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].disabled, true);
  const before = draft;
  active = 'b';
  invoke.onclick();
  assert.equal(selected.length, 1);
  assert.equal(draft, before);
  section.skillFilter = '画面风格';
  section.querySelector('[data-task-skill-search]').value = '';
  context.renderTaskSkillList(section);
  assert.equal(list.children[0].className, 'codex-task-skill-row');
  assert.equal(list.children[0].children[0].disabled, true);
  context.renderTaskSkillsSection(section, { threadId: 'b', taskContext: snapshot.taskContext });
  assert.equal(defaults.children.length, 0);
  assert.equal(requests, 2);
  assert.doesNotMatch(extract('addTaskSkillRequest'), /submit|sendMessage/);
});


test('skill categories are configurable and favorites are empty until opted in', () => {
  const start = source.indexOf('  const skillConfig =');
  const end = source.indexOf('  function loadSkillFavorites(');
  function configure(skills = {}) {
    const context = vm.createContext({window: {__CODEX_ENHANCER_CONFIG__: {skills}}, skillOrganizerFavorites: new Set()});
    vm.runInContext(source.slice(start, end), context);
    return context;
  }
  const catalog = [{title: 'Build', description: '编译项目'}, {title: 'Write', description: '写作'}];
  const defaults = configure();
  assert.equal(defaults.defaultSkillFavorites(catalog).size, 0);
  const custom = configure({categories: [{label:'开发', keywords:['编译']}, {label:'invalid'}], defaultFavorites:['Build','Missing']});
  assert.equal(custom.skillCategoryMatches(catalog[0], '开发'), true);
  assert.equal(custom.skillCategoryMatches(catalog[1], '开发'), false);
  assert.deepEqual([...custom.defaultSkillFavorites(catalog)], ['Build']);
  vm.runInContext(source.slice(source.indexOf('  function escapeSkillLabel('), source.indexOf('  const skillConfig =')), custom);
  assert.equal(custom.escapeSkillLabel('<"&'), '&lt;&quot;&amp;');
});
