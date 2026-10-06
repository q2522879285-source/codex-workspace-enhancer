import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  return source.slice(start, source.indexOf('\n  function ', start + 1));
};
const videos = [{ id: 'builtin-a', name: 'A', source: 'builtin' }];
const config = { enabled: false, mode: 'specific', selectedVideo: 'builtin-a', videos, customVideos: [] };

test('built-in video titles are numbered in order without changing IDs or custom settings', async () => {
  const backend = readFileSync(new URL('../scripts/injector.mjs', import.meta.url), 'utf8');
  const start = backend.indexOf('async function readStartupVideoConfig() {');
  const end = backend.indexOf('\nlet startupVideoWriteQueue', start);
  assert.ok(start >= 0 && end > start);
  const settings = {
    enabled: true, mode: 'random', selectedVideo: 'startup-animation-02.mp4',
    customVideos: [{ id: 'custom-1', name: '我的视频', file: 'custom.mp4' }],
  };
  const context = vm.createContext({
    path, root: '/enhancer', startupVideoDir: '/custom',
    startupVideoExtensions: new Set(['.mp4']), existsSync: () => true,
    readStartupSettings: async () => settings,
    readdir: async () => [
      'startup-animation-03.mp4', 'startup-extra.mp4', 'startup-animation-02.mp4',
      'startup-animation.mp4', 'unrelated.mp4', 'startup-poster.png',
    ],
  });
  vm.runInContext(backend.slice(start, end), context);
  const result = JSON.parse(JSON.stringify(await context.readStartupVideoConfig()));
  assert.deepEqual(result, {
    ...settings,
    videos: [
      { id: 'startup-animation.mp4', name: '01 · 霓光汇聚', source: 'builtin' },
      { id: 'startup-animation-02.mp4', name: '02 · 心跳脉冲', source: 'builtin' },
      { id: 'startup-animation-03.mp4', name: '03 · 橙白旋转', source: 'builtin' },
      { id: 'startup-extra.mp4', name: 'startup-extra', source: 'builtin' },
      { id: 'custom-1', name: '我的视频', source: 'custom' },
    ],
  });
});

function harness() {
  const controls = {
    '[data-startup-video-enabled]': {},
    '[data-startup-video-mode]': {},
    '[data-startup-video-selected]': {},
    '[data-startup-video-status]': {},
  };
  const messages = [];
  let panelOpen = false;
  let serial = 0;
  const context = vm.createContext({
    STARTUP_VIDEO_SETTINGS_ID: 'settings',
    document: { getElementById: () => panelOpen ? { querySelector: key => controls[key] || null } : null },
    window: { codexSidebarStartupVideo: payload => messages.push(JSON.parse(payload)) },
    crypto: { randomUUID: () => `request-${++serial}` },
    setTimeout: () => serial,
    clearTimeout: () => {},
  });
  for (const name of ['startupVideoRequests', 'startupVideoConfig', 'startupVideoSettingsDirty']) {
    const declaration = source.match(new RegExp(`^  (?:const|let) ${name} = .*;`, 'm'));
    assert.ok(declaration, `${name} must have a shared declaration`);
    vm.runInContext(declaration[0], context);
  }
  for (const name of ['requestStartupVideo', 'setStartupVideoConfig', 'renderStartupVideoSettings']) {
    vm.runInContext(extract(name), context);
  }
  return {
    context, controls, messages,
    open: () => { panelOpen = true; context.renderStartupVideoSettings(); },
    state: () => JSON.parse(vm.runInContext('JSON.stringify(startupVideoConfig)', context)),
    edit: () => vm.runInContext('startupVideoSettingsDirty = true; startupVideoConfig.enabled = true; startupVideoConfig.mode = "random"; startupVideoConfig.selectedVideo = "builtin-a";', context),
    reply: data => context.setStartupVideoConfig({ requestId: messages.at(-1).requestId, data }),
  };
}

test('an unedited read loads saved startup-video settings', async () => {
  const h = harness();
  const pending = h.context.requestStartupVideo('read');
  assert.equal(h.messages[0].action, 'read');
  h.reply(config);
  assert.deepEqual(await pending, config);
  assert.deepEqual(h.state(), config);
  h.open();
  assert.equal(h.controls['[data-startup-video-enabled]'].checked, false);
  assert.equal(h.controls['[data-startup-video-mode]'].value, 'specific');
  assert.equal(h.controls['[data-startup-video-selected]'].value, 'builtin-a');
});

test('late reads and periodic pushes hydrate videos without resetting edits', async () => {
  const h = harness();
  h.open();
  const pending = h.context.requestStartupVideo('read');
  h.edit();
  h.reply(config);
  await pending;
  assert.equal(h.state().enabled, true);
  assert.equal(h.state().mode, 'random');
  assert.equal(h.controls['[data-startup-video-enabled]'].checked, true);
  assert.equal(h.controls['[data-startup-video-mode]'].value, 'random');
  const pushedVideos = [...videos, { id: 'custom-b', name: 'B', source: 'custom' }];
  h.context.setStartupVideoConfig({ data: { ...config, videos: pushedVideos } });
  assert.equal(h.state().enabled, true);
  assert.equal(h.state().mode, 'random');
  assert.deepEqual(h.state().videos, pushedVideos);
  for (const action of ['add', 'remove']) {
    const pendingMutation = h.context.requestStartupVideo(action, { id: 'custom-b' });
    const nextVideos = action === 'add' ? pushedVideos : videos;
    h.reply({ ...config, videos: nextVideos });
    await pendingMutation;
    assert.equal(h.state().enabled, true, `${action} must preserve enabled edits`);
    assert.equal(h.state().mode, 'random', `${action} must preserve mode edits`);
    assert.deepEqual(h.state().videos, nextVideos);
  }
});

test('an unedited open panel applies its initial read', async () => {
  const h = harness();
  h.open();
  const pending = h.context.requestStartupVideo('read');
  h.reply(config);
  await pending;
  assert.deepEqual(h.state(), config);
  assert.equal(h.controls['[data-startup-video-enabled]'].checked, false);
  assert.equal(h.controls['[data-startup-video-mode]'].value, 'specific');
  assert.equal(h.controls['[data-startup-video-selected]'].value, 'builtin-a');
});

test('a save response applies returned settings even while the panel is dirty', async () => {
  const h = harness();
  h.open();
  h.edit();
  const pending = h.context.requestStartupVideo('update', { settings: h.state() });
  assert.equal(h.messages[0].action, 'update');
  assert.equal(h.messages[0].settings.enabled, true);
  h.reply(config);
  await pending;
  assert.deepEqual(h.state(), config);
  assert.equal(h.controls['[data-startup-video-enabled]'].checked, false);
  assert.equal(h.controls['[data-startup-video-mode]'].value, 'specific');
});

test('specific mode synchronizes its saved selection with an available video', () => {
  const h = harness();
  h.context.setStartupVideoConfig({ data: { ...config, selectedVideo: 'missing' } });
  h.open();
  assert.equal(h.state().selectedVideo, 'builtin-a');
  assert.equal(h.controls['[data-startup-video-selected]'].value, 'builtin-a');
  assert.equal(h.controls['[data-startup-video-selected]'].disabled, false);
  vm.runInContext('startupVideoConfig.videos = []; renderStartupVideoSettings();', h.context);
  assert.equal(h.state().selectedVideo, '');
  assert.equal(h.controls['[data-startup-video-selected]'].disabled, true);
});

test('destroy cleanup can reject and clear the shared OAuth request table', () => {
  const declaration = source.match(/^  const mokeOAuthRequests = new Map\(\);/m);
  assert.ok(declaration, 'OAuth requests must be declared in the shared injection scope');
  const start = source.indexOf('    mokeOAuthRequests.forEach', source.indexOf('  function destroy()'));
  const end = source.indexOf('    mokeOAuthRequests.clear();', start);
  assert.ok(start >= 0 && end > start, 'destroy must clean up OAuth requests');
  const timers = [];
  const errors = [];
  const context = vm.createContext({ clearTimeout: timer => timers.push(timer), reject: error => errors.push(error.message) });
  vm.runInContext(`${declaration[0]}
    mokeOAuthRequests.set('oauth', { urlTimer: 1, completionTimer: 2, rejectUrl: reject, rejectCompletion: reject });
    ${source.slice(start, end + '    mokeOAuthRequests.clear();'.length)}
    globalThis.remaining = mokeOAuthRequests.size;`, context);
  assert.deepEqual(timers, [1, 2]);
  assert.equal(errors.length, 2);
  assert.ok(errors.every(message => message.includes('MOKE')));
  assert.equal(context.remaining, 0);
});

test('startup-video settings follow the active native general settings container', () => {
  const mounted = [];
  let closed = 0;
  let removed = 0;
  let generalActive = false;
  let heading = 'Appearance';
  const container = {};
  const parentElement = { querySelector: selector => { assert.equal(selector, 'h1'); return { textContent: heading }; } };
  let groups = [{ offsetParent: null, firstElementChild: {} }, { offsetParent: {}, firstElementChild: container, parentElement }];
  const context = vm.createContext({
    NATIVE_STARTUP_VIDEO_SETTING_ATTR: 'data-native-startup',
    document: {
      querySelector: selector => {
        assert.equal(selector, 'button[data-settings-panel-slug="general-settings"][aria-current="page"]');
        return generalActive ? {} : null;
      },
      querySelectorAll: selector => {
        if (selector === '[class~="group/settings"]') return groups;
        assert.equal(selector, '[data-native-startup="true"], [data-codex-startup-video-settings="true"]');
        return [{ remove: () => { removed++; } }];
      },
    },
    mountStartupVideoSettings: target => mounted.push(target),
    closeStartupVideoSettings: () => { closed++; },
  });
  vm.runInContext(extract('ensureNativeStartupVideoSetting'), context);
  context.ensureNativeStartupVideoSetting();
  assert.equal(mounted.length, 0);
  assert.equal(closed, 1);
  generalActive = true;
  context.ensureNativeStartupVideoSetting();
  assert.deepEqual(mounted, [container]);
  generalActive = false;
  context.ensureNativeStartupVideoSetting();
  assert.equal(closed, 2);
  for (heading of ['常规', 'General']) {
    context.ensureNativeStartupVideoSetting();
  }
  assert.deepEqual(mounted, [container, container, container]);
  assert.equal(closed, 2);
  generalActive = true;
  groups = [{ offsetParent: null, firstElementChild: container }];
  context.ensureNativeStartupVideoSetting();
  assert.equal(closed, 3);
  assert.equal(mounted.length, 3);
  assert.equal(removed, 6);
});

test('native startup-video settings mount once without recreating a floating panel', () => {
  const mountSource = extract('mountStartupVideoSettings');
  assert.doesNotMatch(mountSource, /\bdialog\b|\bfixed\b|document\.body\.(?:append|prepend)/i);
  assert.equal(source.includes('  function openStartupVideoSettings('), false);
  let panel;
  let created = 0;
  let prepended = 0;
  let rendered = 0;
  let reads = 0;
  const controls = {};
  const context = vm.createContext({
    STARTUP_VIDEO_SETTINGS_ID: 'settings',
    RUNTIME_TOKEN: 'runtime',
    startupVideoSettingsDirty: false,
    startupVideoConfig: {},
    document: {
      getElementById: () => panel || null,
      createElement: tag => {
        assert.equal(tag, 'section');
        created++;
        return {
          dataset: {}, setAttribute: () => {},
          querySelectorAll: () => [],
          querySelector: selector => controls[selector] ||= {},
        };
      },
    },
    renderStartupVideoSettings: () => { rendered++; },
    requestStartupVideo: action => { assert.equal(action, 'read'); reads++; return Promise.resolve(); },
  });
  const container = { prepend: node => { panel = node; prepended++; } };
  vm.runInContext(mountSource, context);
  context.mountStartupVideoSettings(container);
  const markup = panel.innerHTML;
  context.startupVideoSettingsDirty = true;
  context.mountStartupVideoSettings(container);
  assert.equal(created, 1);
  assert.equal(prepended, 1);
  assert.equal(rendered, 1);
  assert.equal(reads, 1);
  assert.equal(panel.innerHTML, markup);
  assert.equal(context.startupVideoSettingsDirty, true);
});
