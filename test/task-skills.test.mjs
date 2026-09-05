import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { normalizeTaskId } from '../lib/task-context-store.mjs';

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
  const selected = [], defaultRequests = [];
  const context = vm.createContext({
    SKILL_CATEGORIES: [{label:'画面风格',keywords:['视觉','风格']}],
    window: { codexSidebarDefaultSkills: payload => defaultRequests.push(JSON.parse(payload)) },
    crypto: { randomUUID: () => 'request-1' }, setTimeout: () => 1, clearTimeout() {}, threadOverview: null,
    taskSkillCatalog: { entries: [
      { name: 'concise', title: 'Concise', description: '简短输出', path: 'C:/concise/SKILL.md' },
      { name: 'design', title: 'Design', description: '界面视觉风格设计', path: 'C:/design/SKILL.md', enabled: false },
    ] },
    SKILL_DESCRIPTION_OVERRIDES: new Map(), skillOrganizerRenderSignature: '', skillOrganizerFavorites: favorites,
    document: { createElement: () => new Element(), querySelector: () => section },
    normalizedSkillText: value => value.toLowerCase().trim(),
    loadSkillFavorites: () => favorites, saveSkillFavorites: () => saves++, renderSkillOrganizer() {},
    currentConversationThreadId: () => active,
    addTextToComposer: text => { draft += '\n' + text; return true; },
    addNativeTaskSkill: entry => { selected.push(entry); return true; },
    requestTaskSkillCatalog: () => requests++,
  });
  vm.runInContext(source.slice(source.indexOf('  const SKILL_FILTERS ='), source.indexOf('  function skillCategoryMatches(')), context);
  for (const name of ['skillCategoryMatches', 'groupedSkillEntries', 'normalizedThreadId', 'taskContextForSnapshot', 'taskSkillRequest', 'addTaskSkillRequest', 'changeTaskSkillDefault', 'setSkillDefaults', 'renderTaskSkillList', 'renderTaskSkillsSection']) vm.runInContext(extract(name), context);
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
  const manageDefaults = section.querySelector('[data-task-skill-default-add]');
  assert.equal(defaults.children.length, 1);
  assert.equal(manageDefaults.textContent, '添加/删除');
  assert.equal(defaults.children[0].children.length, 1);
  assert.equal(defaults.children[0].children[0].textContent, '少废话');
  section.pickingDefaults = true;
  context.renderTaskSkillsSection(section, snapshot);
  assert.equal(manageDefaults.textContent, '完成');
  assert.equal(defaults.children[0].children[1].textContent, '删除');
  assert.equal(defaults.children[0].children[1].attrs['aria-label'], '移除默认：少废话');
  section.pickingDefaults = false;
  context.renderTaskSkillsSection(section, snapshot);
  assert.equal(manageDefaults.textContent, '添加/删除');
  assert.equal(defaults.children[0].children.length, 1);
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
  assert.equal(requests, 4);
  active = 'a';
  section.skillFilter = '全部';
  context.renderTaskSkillsSection(section, snapshot);
  section.pickingDefaults = true;
  section.querySelector('[data-task-skill-search]').value = 'concise';
  context.renderTaskSkillsSection(section, snapshot);
  list.children[0].children[0].onclick();
  assert.equal(defaultRequests.length, 1);
  assert.equal(defaultRequests[0].action, 'add');
  assert.equal(defaultRequests[0].entry.name, 'concise');
  assert.equal(list.children[0].children[0].disabled, true);
  assert.equal(draft, '原有草稿');
  assert.equal(selected.length, 1);
  context.setSkillDefaults({threadId:'a',requestId:'stale',error:'过期'});
  assert.equal(section.defaultsPending, 'request-1');
  const configured = {...snapshot.taskContext,agreements:[...snapshot.taskContext.agreements,'默认执行 · Concise（concise）：每轮读取 C:/concise/SKILL.md']};
  context.setSkillDefaults({threadId:'a',requestId:'request-1',data:configured});
  assert.equal(defaults.children.length, 2);
  assert.match(section.querySelector('[data-task-skill-status]').textContent, /已保存；启用摘要提醒后/);
  assert.match(source, /data-task-skill-default-hint>仅此任务 · 启用摘要提醒后/);
  assert.equal(list.children[0].children[0].disabled, true);
  const remove = defaults.children[1].children[1];
  assert.equal(remove.textContent, '删除');
  remove.onclick();
  assert.equal(defaultRequests[1].action, 'remove');
  assert.equal(defaultRequests[1].value, configured.agreements[2]);
  context.setSkillDefaults({threadId:'a',requestId:'request-1',error:'保存失败'});
  assert.equal(defaults.children.length, 2);
  assert.match(section.querySelector('[data-task-skill-status]').textContent, /保存失败/);
  remove.onclick();
  context.setSkillDefaults({threadId:'a',requestId:'request-1',data:snapshot.taskContext});
  assert.equal(defaults.children.length, 1);
  assert.equal(list.children[0].children[0].disabled, false);
  active = 'b';
  remove.onclick();
  assert.equal(defaultRequests.length, 3);
  context.renderTaskSkillsSection(section, {threadId:'b'});
  assert.equal(section.pickingDefaults, false);
  assert.equal(defaults.children.length, 0);
  assert.doesNotMatch(extract('addTaskSkillRequest'), /submit|sendMessage/);
  assert.doesNotMatch(extract('changeTaskSkillDefault'), /addTextToComposer|addNativeTaskSkill|submit|sendMessage/);
});

test('default settings bridge admits only the active task and its enabled native catalog entries', async () => {
  const injector = readFileSync(new URL('../scripts/injector.mjs', import.meta.url), 'utf8');
  const start = injector.indexOf('async function handleDefaultSkillsBinding(');
  const end = injector.indexOf('\nasync function ', start + 1);
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const entry = {name:'concise',title:'简洁',path:'C:/skills/concise/SKILL.md',enabled:true};
  let active = {threadId:id,entries:[entry]};
  const writes = [], replies = [];
  const context = vm.createContext({
    normalizeTaskId,
    client: {evaluate: async expression => {
      if (expression.includes('getDefaultSkillsTask')) return active;
      replies.push(expression);
    }},
    repository: {codexHome:'C:/codex',overviewCache:new Map([[id,{cwd:'C:/project'}]])},
    updateTaskSkillDefaults: options => {writes.push(options);return {threadId:id,agreements:[]};},
  });
  vm.runInContext(injector.slice(start, end), context);
  const send = extra => context.handleDefaultSkillsBinding(JSON.stringify({threadId:id,requestId:'r',action:'add',entry,...extra}));
  await send({cwd:'C:/wrong',entry:{...entry,title:'伪造标题'}});
  assert.equal(writes.length, 1);
  assert.equal(writes[0].cwd, 'C:/project');
  assert.equal(writes[0].entry.title, '简洁');
  assert.match(replies[0], /setSkillDefaults/);
  await send({entry:{...entry,path:'C:/not-a-skill'}});
  assert.equal(writes.length, 1);
  assert.match(replies[1], /error/);
  active = {threadId:id,entries:[{...entry,enabled:false}]};
  await send({});
  assert.equal(writes.length, 1);
  active = {threadId:other,entries:[entry]};
  const count = replies.length;
  await send({});
  assert.equal(writes.length, 1);
  assert.equal(replies.length, count);
  active = {threadId:id,entries:[]};
  await send({action:'remove',value:'默认执行 · 简洁'});
  assert.equal(writes.length, 2);
  assert.equal(writes[1].action, 'remove');
  assert.equal(writes[1].entry, null);
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
