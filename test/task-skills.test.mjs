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
    window: { __CODEX_ENHANCER_CONFIG__: { skills: { categories: [{ label: "画面风格", keywords: ["界面", "视觉"] }] } }, codexSidebarDefaultSkills: payload => defaultRequests.push(JSON.parse(payload)) },
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
  vm.runInContext(source.slice(source.indexOf('  const skillConfig ='), source.indexOf('  function skillCategoryMatches(')), context);
  for (const name of ['skillCategoryMatches', 'groupedSkillEntries', 'normalizedThreadId', 'taskContextForSnapshot', 'taskSkillRequest', 'addTaskSkillRequest', 'changeTaskSkillDefault', 'setSkillDefaults', 'renderTaskSkillList', 'renderTaskSkillsSection']) vm.runInContext(extract(name), context);
  const snapshot = { threadId: 'a', globalSkillDefaults: ['默认执行 · 少废话：直接给结果。'], taskContext: { threadId: 'a', agreements: ['默认执行 · 旧设置：不恢复', '保留界面'] } };
  const originalContext = JSON.stringify(snapshot.taskContext);
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
  context.renderTaskSkillsSection(section, { threadId: 'b', globalSkillDefaults: snapshot.globalSkillDefaults, taskContext: snapshot.taskContext });
  assert.equal(defaults.children.length, 1);
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
  const configured = [...snapshot.globalSkillDefaults, '默认执行 · Concise（concise）：每轮读取 C:/concise/SKILL.md'];
  context.setSkillDefaults({threadId:'a',requestId:'request-1',globalSkillDefaults:configured,projectSkillDefaults:[]});
  assert.equal(defaults.children.length, 2);
  assert.match(section.querySelector('[data-task-skill-status]').textContent, /已保存/);
  assert.equal(list.children[0].children[0].disabled, true);
  const remove = defaults.children[1].children[1];
  assert.equal(remove.textContent, '删除');
  assert.equal(remove.title, '移出通用默认，不卸载技能');
  remove.onclick();
  assert.equal(defaultRequests[1].action, 'remove');
  assert.equal(defaultRequests[1].value, configured[1]);
  context.setSkillDefaults({threadId:'a',requestId:'request-1',error:'保存失败'});
  assert.equal(defaults.children.length, 2);
  assert.match(section.querySelector('[data-task-skill-status]').textContent, /保存失败/);
  remove.onclick();
  context.setSkillDefaults({threadId:'a',requestId:'request-1',globalSkillDefaults:['默认执行 · 少废话：直接给结果。'],projectSkillDefaults:[]});
  assert.equal(defaults.children.length, 1);
  assert.equal(list.children[0].children[0].disabled, false);
  const project = {projectId:'project-a',name:'项目 A'};
  const projectSnapshot = {...snapshot,projectSkillDefaults:['默认执行 · 项目技能：只在项目'],skillDefaultsProject:project};
  context.renderTaskSkillsSection(section, projectSnapshot);
  assert.equal(section.querySelector('[data-task-skill-project-block]').hidden, false);
  assert.match(section.querySelector('[data-task-skill-project-hint]').textContent, /项目 A/);
  section.pickingDefaults = true;
  section.defaultsScope = 'project';
  context.renderTaskSkillsSection(section, projectSnapshot);
  assert.equal(defaults.children[0].children.length, 1);
  const projectDefaults = section.querySelector('[data-task-skill-project-defaults]');
  projectDefaults.children[0].children[1].onclick();
  assert.equal(defaultRequests.at(-1).scope, 'project');
  assert.equal(defaultRequests.at(-1).projectId, 'project-a');
  context.setSkillDefaults({threadId:'a',requestId:'request-1',scope:'project',globalSkillDefaults:snapshot.globalSkillDefaults,projectSkillDefaults:[],skillDefaultsProject:project});
  assert.equal(projectDefaults.children.length, 0);
  assert.equal(defaults.children.length, 1);
  assert.match(section.querySelector('[data-task-skill-status]').textContent, /仅本项目/);
  list.children[0].children[0].onclick();
  assert.equal(defaultRequests.at(-1).scope, 'project');
  context.renderTaskSkillsSection(section, snapshot);
  assert.equal(section.querySelector('[data-task-skill-project-block]').hidden, true);
  assert.equal(section.defaultsPending, null);
  context.setSkillDefaults({threadId:'a',requestId:'request-1',scope:'project',globalSkillDefaults:snapshot.globalSkillDefaults,projectSkillDefaults:projectSnapshot.projectSkillDefaults,skillDefaultsProject:project});
  assert.equal(section.querySelector('[data-task-skill-project-block]').hidden, true);
  const requestCount = defaultRequests.length;
  active = 'b';
  remove.onclick();
  assert.equal(defaultRequests.length, requestCount);
  context.renderTaskSkillsSection(section, {threadId:'b'});
  assert.equal(section.pickingDefaults, false);
  assert.equal(defaults.children.length, 0);
  assert.equal(JSON.stringify(snapshot.taskContext), originalContext);
  assert.equal(draft, '原有草稿');
  assert.match(source, /通用默认 · 所有任务从下一条消息生效/);
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
    repository: {codexHome:'C:/codex',readOverview:async () => ({cwd:'C:/actual'})},
    updateSkillDefaults: options => {writes.push(options);return {globalSkillDefaults:[],projectSkillDefaults:[]};},
  });
  vm.runInContext(injector.slice(start, end), context);
  const send = extra => context.handleDefaultSkillsBinding(JSON.stringify({threadId:id,requestId:'r',action:'add',entry,...extra}));
  await send({cwd:'C:/wrong',entry:{...entry,title:'伪造标题'}});
  assert.equal(writes.length, 1);
  assert.equal(writes[0].cwd, 'C:/actual');
  assert.equal(writes[0].scope, 'global');
  assert.equal(writes[0].codexHome, 'C:/codex');
  assert.equal(writes[0].entry.title, '简洁');
  assert.match(replies[0], /setSkillDefaults/);
  assert.match(replies[0], /globalSkillDefaults/);
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
  await send({scope:'project',projectId:'project-a',action:'remove',value:'默认执行 · 项目'});
  assert.equal(writes[2].scope, 'project');
  assert.equal(writes[2].projectId, 'project-a');
});
