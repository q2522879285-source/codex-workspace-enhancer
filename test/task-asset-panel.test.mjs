import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
function load(context, ...names) {
  for (const name of names) {
    const start = source.indexOf(`  function ${name}(`);
    assert.ok(start >= 0, name);
    vm.runInContext(source.slice(start, source.indexOf('\n  function ', start + 1)), context);
  }
}

test('asset pane opens lazily and reuses its panel across tabs and collapse', () => {
  let panel = null, opens = 0, syncs = 0;
  const host = { querySelector: () => panel };
  const rail = { querySelector: () => host };
  const context = vm.createContext({
    ASSET_CONSOLE_PANEL_ID: 'panel', taskRailTab: 'context', overviewCollapsed: false,
    isTaskShell: () => true,
    openAssetConsolePanel: (kind, options) => {
      assert.equal(kind, 'asset'); assert.equal(options.docked, true);
      opens++; panel ||= {}; panel.hidden = false;
    },
    syncAssetConsoleTaskContext: () => syncs++,
  });
  load(context, 'syncTaskAssetPanel');
  const sync = () => context.syncTaskAssetPanel(rail);
  sync(); assert.equal(opens, 0);
  context.taskRailTab = 'assets'; sync();
  const original = panel;
  sync(); assert.equal(opens, 1); assert.equal(syncs, 1);
  context.taskRailTab = 'context'; sync(); assert.equal(panel.hidden, true);
  context.taskRailTab = 'assets'; sync(); assert.equal(panel.hidden, false);
  assert.equal(panel, original);
  context.overviewCollapsed = true; sync(); assert.equal(panel.hidden, true);
  context.overviewCollapsed = false; sync(); assert.equal(panel.hidden, false);
  assert.equal(panel, original); assert.equal(opens, 3);
});

test('expand retains iframe ownership, task switches refresh, and close returns to context', () => {
  let moves = 0, removed = 0, threadId = 'task-a', notifications = [];
  const button = { setAttribute(name, value) { this[name] = value; } };
  const frame = { remove() { removed++; } };
  const host = { appendChild() { moves++; }, querySelector: () => panel };
  const rail = { querySelector: selector => selector === '[data-task-asset-console-host]' ? host : null };
  const panel = {
    dataset: { consoleKind: 'asset', docked: 'true', taskContextKey: 'task-a' },
    parentElement: host, hidden: false,
    style: { removeProperty() {} }, setAttribute() {},
    querySelector: selector => selector === '#frame' ? frame : button,
    closest: () => host, remove() { throw new Error('asset panel was destroyed'); },
  };
  const context = vm.createContext({
    ASSET_CONSOLE_PANEL_ID: 'panel', ASSET_CONSOLE_FRAME_ID: 'frame', THREAD_OVERVIEW_RAIL_ID: 'rail',
    COMPANY_WORKBENCH_MODE_ATTR: 'company', OVERVIEW_COLLAPSED_KEY: 'collapsed',
    taskRailTab: 'assets', overviewCollapsed: false, assetConsoleReturnFocus: null,
    HTMLElement: class {}, localStorage: { setItem() {} },
    document: {
      activeElement: null, body: { appendChild() { moves++; } },
      documentElement: { getAttribute: () => 'false' },
      getElementById: id => id === 'rail' ? rail : panel,
    },
    isTaskShell: () => true, scheduleSync() {}, positionAssetConsolePanel() {},
    requestAnimationFrame: fn => fn(), currentComposer: () => null,
    currentCodexTaskContext: () => ({ threadId }),
    assetConsoleTaskContextKey: value => value.threadId,
    setAssetConsolePanelState() {},
    notifyAssetConsole: (action, kind) => { notifications.push([action, kind]); return true; },
  });
  load(context, 'openAssetConsolePanel', 'updateAssetConsoleExpandButton',
    'syncAssetConsoleTaskContext', 'closeAssetConsolePanel', 'applyCompanyRailLayout');
  context.openAssetConsolePanel('asset', { docked: false });
  assert.equal(panel.dataset.docked, 'false'); assert.equal(button.title, '收回右栏');
  context.openAssetConsolePanel('asset', { docked: true });
  assert.equal(panel.dataset.docked, 'true'); assert.equal(button.title, '展开资产工作区');
  assert.equal(moves, 0); assert.equal(removed, 0); assert.equal(panel.querySelector('#frame'), frame);
  context.applyCompanyRailLayout(rail);
  assert.equal(panel.hidden, false); assert.equal(notifications.length, 0);
  threadId = 'task-b';
  assert.equal(context.syncAssetConsoleTaskContext(), true);
  assert.equal(panel.dataset.taskContextKey, 'task-b'); assert.equal(removed, 1);
  assert.deepEqual(notifications, [['open', 'asset']]);
  assert.equal(context.syncAssetConsoleTaskContext(), false);
  context.closeAssetConsolePanel({ focusTarget: 'none' });
  assert.equal(panel.hidden, true); assert.equal(context.taskRailTab, 'context');
  assert.equal(notifications.length, 1); assert.equal(moves, 0);
});
