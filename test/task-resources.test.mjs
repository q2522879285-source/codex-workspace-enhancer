import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  function ', start + 1));
}

test('cold references remain task-scoped and bounded without the former asset resource block', () => {
  const pilot = '44444444-4444-4444-8444-444444444444';
  let active = pilot, writes = 0, sends = 0, pageReads = 0;
  const composed = [];
  class Element {
    dataset = {}; children = []; textContent = ''; hidden = false;
    nodes = new Map();
    elements = { path: { value: '' }, keyword: { value: '' } };
    setAttribute() {}
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    reset() { this.elements.keyword.value = ''; }
    querySelector(selector) {
      if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
      return this.nodes.get(selector);
    }
  }
  const context = vm.createContext({
    document: { createElement: () => new Element(), querySelector: () => { pageReads++; return null; } },
    localStorage: { getItem: () => null, setItem: () => writes++ },
    currentConversationThreadId: () => active,
    assetConsole: { assetAvailable: true },
    addTextToComposer: value => { composed.push(value); return true; },
    sendMessage: () => sends++,
  });
  for (const name of ['normalizedThreadId', 'isAbsoluteWindowsAssetPath', 'readTaskColdArchive', 'taskContextForSnapshot', 'taskResourceReferenceRequest', 'decorateTaskResourceButton', 'renderTaskLinkedResources', 'createTaskColdSection', 'renderTaskColdSection']) vm.runInContext(extract(name), context);
  const references = [
    { kind: 'history', label: '旧任务记录', archivePath: 'E:/cold/old', sourceThreadId: 'old', recordId: 20691 },
    { kind: 'history', label: '旧任务档案', archivePath: 'E:/cold/old', sourceThreadId: 'old' },
    { kind: 'asset', label: '成片', path: 'E:/project/final.mp4', ticketId: 'ticket-1', outputId: 'output-1' },
  ];
  const snapshot = { threadId: pilot, taskContext: { threadId: pilot, references, assetBinding: { projectId: 'project-1', projectName: '现有项目' } } };
  const cold = context.createTaskColdSection();
  context.renderTaskColdSection(cold, snapshot);
  const buttons = cold.querySelector('[data-task-linked-list]').children.map(item => item.children[0]);
  assert.equal(cold.querySelector('[data-task-linked-list]').children.length, 2, 'context contains cold references');
  assert.equal(/function (?:currentTaskFileLinks|createTaskResourcesSection|renderTaskResourcesSection)\(/.test(source), false, 'the former asset resource functions are removed');
  assert.match(extract('createThreadOverviewRail'), /assets\.append\(assetHost\)/);
  assert.doesNotMatch(extract('createThreadOverviewRail'), /createTaskResourcesSection|data-task-files|任务关联与页面文件/);
  assert.doesNotMatch(extract('renderThreadOverviewRail'), /renderTaskResourcesSection/);
  assert.match(extract('createThreadOverviewRail'), /context-extras[^\n]+createTaskColdSection/);
  assert.deepEqual(buttons.map(button => button.children[0].textContent), ['记录', '记录']);
  for (const button of buttons) { assert.equal(button.type, 'button'); button.onclick(); }
  assert.match(composed[0], /E:\/cold\/old.*只查看记录 20691/);
  assert.match(composed[1], /1–2 个关键词.*先向我确认关键词/);
  for (const request of composed) assert.match(request, /不加载全部历史/);
  assert.match(cold.querySelector('[data-task-linked-status]').textContent, /尚未发送/);
  active = 'another-task';
  buttons[0].onclick();
  assert.equal(composed.length, 2);
  context.renderTaskColdSection(cold, { threadId: active, taskContext: { ...snapshot.taskContext, threadId: 'wrong' } });
  assert.equal(cold.querySelector('[data-task-linked-resources]').hidden, true);
  active = pilot;
  buttons[0].onclick();
  assert.equal(composed.length, 2);
  context.renderTaskColdSection(cold, { ...snapshot, taskContext: { ...snapshot.taskContext, threadId: 'wrong' } });
  assert.equal(cold.querySelector('[data-task-linked-resources]').hidden, true);
  context.renderTaskColdSection(cold, { ...snapshot, taskContext: { ...snapshot.taskContext, references: [] } });
  buttons[0].onclick();
  assert.equal(composed.length, 2, 'stale references cannot be added');
  assert.equal(pageReads, 0);
  assert.equal(writes, 0);
  assert.equal(sends, 0);
});

test('cold entries are task-scoped and create bounded requests without reading archives', () => {
  const data = new Map();
  const context = vm.createContext({ localStorage: { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v) } });
  for (const name of ['isAbsoluteWindowsAssetPath', 'readTaskColdArchive', 'saveTaskColdArchive', 'coldHistoryRequest']) vm.runInContext(extract(name), context);
  context.saveTaskColdArchive('a', 'E:/cold/a');
  context.saveTaskColdArchive('b', 'E:/cold/b');
  assert.equal(context.readTaskColdArchive('a'), 'E:/cold/a');
  assert.equal(context.readTaskColdArchive('c'), '');
  context.saveTaskColdArchive('a', '');
  assert.equal(context.readTaskColdArchive('b'), 'E:/cold/b');
  assert.throws(() => context.saveTaskColdArchive('a', 'relative/path'));
  assert.throws(() => context.saveTaskColdArchive('a', 'E:/cold\nwrong'));
  assert.equal(context.coldHistoryRequest('E:/cold', '  '), '');
  const request = context.coldHistoryRequest('E:/cold', '界面'.repeat(100));
  assert.ok(request.includes('不加载全部历史，不修改档案'));
  assert.ok(!request.includes('界面'.repeat(81)));
});

test('asset context uses actual conversation rather than stale sidebar selection', () => {
  let conversationId = 'cloud:active';
  const selected = { getAttribute: name => name.endsWith('id') ? 'local:previous' : 'Previous title' };
  const context = vm.createContext({ document: { querySelector: selector => selector.includes('data-above-composer')
    ? conversationId ? { getAttribute: () => conversationId } : null : selected }, currentThreadHeaderTitle: () => 'Current title' });
  vm.runInContext(extract('currentCodexTaskContext'), context);
  assert.equal(context.currentCodexTaskContext().threadId, 'active');
  assert.equal(context.currentCodexTaskContext().threadTitle, 'Current title');
  conversationId = '';
  assert.equal(context.currentCodexTaskContext().threadId, 'previous');
  assert.equal(context.currentCodexTaskContext().threadTitle, 'Previous title');
});

test('ordinary asset close preserves the frame and proxy; hidden assets do not follow tasks or consume Escape', () => {
  let removed = false, closed = 0, prevented = false;
  const panel = { dataset: { consoleKind: 'asset', docked: 'false' }, hidden:false, remove:()=>removed=true, closest:()=>null };
  const context = vm.createContext({ ASSET_CONSOLE_PANEL_ID:'asset', COMPANY_WORKBENCH_MODE_ATTR:'company', assetConsoleReturnFocus:null,
    document:{getElementById:()=>panel, documentElement:{getAttribute:()=>null}}, isTaskShell:()=>true,
    notifyAssetConsole:()=>closed++, scheduleSync:()=>{}, requestAnimationFrame:()=>{} });
  for (const name of ['closeAssetConsolePanel', 'syncAssetConsoleTaskContext', 'handleAssetConsoleKeydown']) vm.runInContext(extract(name), context);
  context.closeAssetConsolePanel();
  assert.ok(panel.hidden);
  assert.equal(removed,false);
  assert.equal(closed,0);
  assert.equal(context.syncAssetConsoleTaskContext(),false);
  context.handleAssetConsoleKeydown({key:'Escape',preventDefault:()=>prevented=true});
  assert.equal(prevented,false);
  context.closeAssetConsolePanel({destroy:true});
  assert.ok(removed);
  assert.equal(closed,1);
});

test('ordinary notes replace the duplicate action and excerpt without altering project or company summaries', () => {
  const element = () => ({ dataset: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, append() {}, replaceChildren() {} });
  const nodes = new Map();
  const tabs = ['context', 'skills', 'assets'].map(taskRailTab => Object.assign(element(), { dataset: { taskRailTab } }));
  const rail = { dataset: {}, querySelector: selector => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  }, querySelectorAll: selector => {
    assert.equal(selector, '[data-task-rail-tab]');
    return tabs;
  } };
  let taskShell = true, company = false, notesRenders = 0, resourceRenders = 0, excerptRenders = 0, autoRenders = 0, skillsRenders = 0;
  const context = vm.createContext({
    COMPANY_WORKBENCH_MODE_ATTR: 'company',
    taskRailTab: 'context',
    document: { documentElement: { getAttribute: () => company ? 'true' : null }, createElement: element, createTextNode: value => value },
    isTaskShell: () => taskShell, applyOverviewVisibility() {}, syncTaskAssetPanel() {},
    renderTaskAutoContextSection: () => autoRenders++,
    renderTaskNotesSection: () => notesRenders++, renderTaskResourcesSection: () => resourceRenders++, renderTaskColdSection() {}, renderTaskExcerptSection: () => excerptRenders++,
    renderTaskSkillsSection: () => skillsRenders++,
    threadOverviewTimeItems: () => [], compactThreadText: value => value || '',
  });
  for (const name of ['cleanTaskPreviewText', 'taskOverviewPresentation', 'taskContextForSnapshot', 'renderThreadOverviewRail']) vm.runInContext(extract(name), context);
  const snapshot = { threadId: 'a', title: '任务', summary: '原总结', latestAnswer: '最新答复', nextStep: '原下一步', status: '待继续' };
  context.renderThreadOverviewRail(rail, snapshot);
  assert.equal(rail.querySelector('[data-codex-thread-add-memo]').hidden, true);
  assert.equal(rail.querySelector('[data-codex-thread-default-summary]').hidden, true);
  assert.equal(rail.querySelector('[data-codex-task-context-extras]').hidden, false);
  assert.deepEqual([notesRenders, resourceRenders, excerptRenders], [1, 0, 1]);
  const panes = {
    context: '[data-codex-task-context-extras]',
    skills: '[data-codex-task-skills]',
    assets: '[data-codex-task-assets]',
  };
  const assertPane = selected => {
    for (const [name, selector] of Object.entries(panes)) assert.equal(rail.querySelector(selector).hidden, name !== selected, name);
    if (selected) {
      assert.equal(rail.dataset.taskPane, selected);
      assert.equal(rail.querySelector('[data-codex-task-rail-tabs]').hidden, false);
      for (const tab of tabs) assert.equal(tab.attributes['aria-pressed'], String(tab.dataset.taskRailTab === selected));
    } else {
      assert.equal(rail.dataset.taskPane, 'context');
      assert.equal(rail.querySelector('[data-codex-task-rail-tabs]').hidden, true);
    }
  };
  assertPane('context');
  const signature = rail.dataset.signature;
  const title = rail.querySelector('[data-codex-thread-overview-title]');
  title.textContent = 'unchanged-render-marker';
  for (const pane of ['skills', 'assets', 'context']) {
    context.taskRailTab = pane;
    context.renderThreadOverviewRail(rail, snapshot);
    assertPane(pane);
    assert.equal(rail.dataset.signature, signature);
    assert.equal(title.textContent, 'unchanged-render-marker', 'pane switching precedes the unchanged-summary early return');
  }
  assert.equal(skillsRenders, 1);
  context.taskRailTab = 'skills';
  taskShell = false;
  context.renderThreadOverviewRail(rail, snapshot);
  assertPane(null);
  assert.equal(rail.querySelector('[data-codex-thread-add-memo]').hidden, true);
  assert.equal(rail.querySelector('[data-codex-thread-add-memo]').textContent, '加入未完成工作');
  assert.equal(rail.querySelector('[data-codex-thread-default-summary]').hidden, false);
  assert.equal(rail.querySelector('[data-codex-task-context-extras]').hidden, true);
  assert.equal(rail.querySelector('[data-codex-thread-overview-summary]').textContent, '原总结');
  assert.equal(rail.querySelector('[data-codex-thread-overview-next]').textContent, '原下一步');
  company = true;
  context.taskRailTab = 'assets';
  context.renderThreadOverviewRail(rail, snapshot);
  assertPane(null);
  assert.equal(rail.querySelector('[data-codex-thread-add-memo]').hidden, true);
  assert.equal(rail.querySelector('[data-codex-thread-add-memo]').textContent, '同步到未完成工作');
  assert.equal(rail.querySelector('[data-codex-thread-overview-heading]').textContent, '主控态势');
  assert.equal(autoRenders, 4);
  assert.equal(skillsRenders, 1);
  assert.deepEqual([notesRenders, resourceRenders, excerptRenders], [4, 0, 4]);
});
