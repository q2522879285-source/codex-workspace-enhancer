import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`  function ${name}(`);
  return source.slice(start, source.indexOf('\n  function ', start + 1));
};

test('switching tasks cannot reuse an old overview while the new conversation loads', () => {
  const context = vm.createContext({
    active: 'a', dom: null, threadOverview: { threadId: 'a', goal: 'A', historyComplete: true },
    readCurrentThreadSnapshot: () => context.dom,
    currentCodexTaskContext: () => ({ threadId: context.active }),
    compactThreadText: value => String(value || ''),
    sync: () => {},
  });
  for (const name of ['normalizedThreadId', 'resolvedCurrentThreadSnapshot', 'setThreadOverview']) {
    vm.runInContext(extract(name), context);
  }
  assert.equal(context.resolvedCurrentThreadSnapshot().threadId, 'a');
  context.active = 'b';
  assert.equal(context.resolvedCurrentThreadSnapshot(), null);
  context.setThreadOverview({ threadId: 'b', goal: 'B', historyComplete: false,
    globalSkillDefaults: ['默认执行 · 测试'], projectSkillDefaults: ['默认执行 · 项目'],
    skillDefaultsProject: {projectId:'p',name:'项目'}, skillDefaultsError: '' });
  context.setThreadOverview({ threadId: 'a', goal: 'late A' });
  const current = context.resolvedCurrentThreadSnapshot();
  assert.equal(current.threadId, 'b');
  assert.equal(current.goal, 'B');
  assert.equal(current.historyComplete, false);
  assert.deepEqual(Array.from(current.globalSkillDefaults), ['默认执行 · 测试']);
  assert.deepEqual(Array.from(current.projectSkillDefaults), ['默认执行 · 项目']);
  assert.equal(current.skillDefaultsProject.projectId, 'p');
  assert.equal(current.skillDefaultsError, '');
  assert.match(source, /attributeFilter:\s*\[[\s\S]*?"data-above-composer-conversation-id"/);
  assert.match(source, /"data-app-action-sidebar-thread-id"/);
  assert.match(source, /refreshNativeSidebar/);
});

test('native sidebar refresh finds the conversation query and throttles repeats', async () => {
  const start = source.indexOf('  async function refreshNativeSidebar(');
  const end = source.indexOf('\n  function scheduleSync(', start);
  const firstRefresh = async () => { context.calls += 1; };
  const secondRefresh = async () => { context.calls += 1; };
  const context = vm.createContext({
    Date,
    Promise,
    Set,
    setTimeout,
    window: { __codexRoot: { _internalRoot: { current: {
      memoizedState: {
        memoizedState: { data: [{ conversationId: 'new' }], refetch: firstRefresh },
        next: { memoizedState: { data: { threadIds: ['new'], serverOrderedThreadIds: ['new'] }, refetch: secondRefresh }, next: null },
      },
      child: null,
      sibling: null,
    } } } },
    calls: 0,
    nativeSidebarRefreshAt: 0,
    nativeSidebarRefreshPromise: null,
  });
  vm.runInContext(`let nativeSidebarRefreshAt = 0; let nativeSidebarRefreshPromise = null; ${source.slice(start, end)}; globalThis.refreshNativeSidebar = refreshNativeSidebar;`, context);
  assert.equal(await vm.runInContext('refreshNativeSidebar()', context), true);
  assert.equal(context.calls, 2);
  assert.equal(await vm.runInContext('refreshNativeSidebar()', context), false);
  assert.equal(context.calls, 2);
});
