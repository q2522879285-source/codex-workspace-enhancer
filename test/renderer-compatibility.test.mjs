import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const module of [process.env.RENDERER_PLAYWRIGHT, 'playwright', join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
  try { ({ chromium } = require(module)); break; } catch {}
}
const executablePath = process.env.RENDERER_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const source = process.env.RENDERER_COMPAT_REF ? execFileSync('git', ['show', `${process.env.RENDERER_COMPAT_REF}:inject/conversation-preview.user.js`], { encoding: 'utf8' }) : readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const sentinel = '__codexConversationPreviewInjection__';
async function inject(page, content) {
  const script = await page.addScriptTag({ content });
  await script.evaluate(node => node.remove());
  await script.dispose();
}

async function setup(t, { stale = false, moke = false } = {}) {
  assert.ok(chromium, 'Existing Playwright required; no downloads are performed.');
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const { page, context, errors } = await fixture(browser);
  t.after(() => context.close());
  await page.evaluate(({ stale, moke }) => {
    const nativeStyle = document.createElement('style');
    nativeStyle.textContent = '*,::before,::after{box-sizing:border-box}body{font-family:Arial,sans-serif}main{flex:1;min-width:0}[data-app-shell-thread-edge-divider],#thread-host{width:100%}#thread-host{display:flex;align-items:stretch}.fixture-hidden{display:none}';
    document.head.append(nativeStyle);
    const content = document.createElement('div'); content.style.cssText = 'flex:1;min-width:0';
    const timeline = document.querySelector('[data-app-action-timeline-scroll]');
    timeline.before(content); content.append(timeline, document.querySelector('[data-codex-composer-root]'));
    const sidebar = document.querySelector('#app-shell-sidebar'); sidebar.dataset.fixtureLive = '';
    window.fixtureNativeSidebar = sidebar.outerHTML;
    if (stale) {
      const old = sidebar.cloneNode(true); const wrapper = document.createElement('div');
      wrapper.id = 'fixture-stale'; wrapper.hidden = true; old.removeAttribute('data-fixture-live');
      old.querySelectorAll('[data-app-action-sidebar-thread-row]').forEach(row => row.setAttribute('data-app-action-sidebar-thread-title', 'STALE ROW'));
      wrapper.append(old); document.body.prepend(wrapper);
    }
    window.fixtureOrbitClicks = { live: 0, stale: 0 };
    document.querySelectorAll('[data-sidebar-destination="builtin:orbit"]').forEach(button => {
      const origin = button.closest('#fixture-stale') ? 'stale' : 'live';
      button.addEventListener('click', () => window.fixtureOrbitClicks[origin]++);
    });
    const right = document.createElement('div'); right.id = 'fixture-right'; right.textContent = 'Native right';
    right.style.cssText = 'width:80px;height:500px'; document.body.append(right);
    window.fixtureScans = 0; window.fixtureLongTasks = [];
    for (const prototype of [Document.prototype, Element.prototype]) {
      const query = prototype.querySelectorAll;
      prototype.querySelectorAll = function(selector) {
        if (selector === '[data-app-action-sidebar-thread-row], [data-sidebar-chatgpt-conversation-key] [role="button"]:has([data-thread-title-trigger="true"])') window.fixtureScans++;
        return query.call(this, selector);
      };
    }
    new PerformanceObserver(list => window.fixtureLongTasks.push(...list.getEntries().map(entry => Math.round(entry.duration)))).observe({ type: 'longtask', buffered: true });
    if (moke) {
      window.fixtureMokeHold = false; window.fixtureMokePending = [];
      window.fixtureMokeQueries = [];
      window.electronBridge.sendMessageFromView = async message => {
        if (message?.type !== 'mcp-request') return;
        const { id, method, params } = message.request;
        window.fixtureMcpRequests.push(message.request);
        let result;
        if (method === 'config/read') result = { config: { mcp_servers: { moke: {} } } };
        else if (method === 'mcpServerStatus/list') result = { data: [{ name: 'moke', authStatus: 'authorized' }] };
        else if (method === 'mcpServer/tool/call') {
          const args = params?.arguments || {};
          window.fixtureMokeQueries.push(args);
          const query = args.query || ''; const total = query ? 1 : 3500;
          const offset = Number(args.cursor || args.offset || 0);
          result = { items: Array.from({ length: Math.min(50, total - offset) }, (_, i) => ({ id: `material-${query ? 3499 : offset + i}`, title: `Material ${query ? 3499 : offset + i}`, summary: 'Fixture prompt', type: 'prompt' })), total, next_cursor: offset + 50 < total ? String(offset + 50) : null };
        } else return;
        const respond = () => window.postMessage({ type: 'mcp-response', hostId: 'local', message: { id, result } }, '*');
        if (window.fixtureMokeHold && method === 'mcpServer/tool/call') window.fixtureMokePending.push(respond);
        else respond();
      };
    }
  }, { stale, moke });
  await inject(page, source);
  await page.waitForTimeout(400);
  assert.deepEqual(errors, []);
  return { page, context, errors };
}

test('visible native sidebar owns tabs, Your dot and cards even when an older hidden sidebar precedes it', { timeout: 30_000 }, async t => {
  const { page } = await setup(t, { stale: true });
  assert.equal(await page.locator('[data-fixture-live] #codex-sidebar-section-tabs').count(), 1, 'tabs attached to stale sidebar');
  assert.equal(await page.locator('[data-fixture-live] [data-codex-your-dot-proxy]').count(), 1, 'Your dot attached to stale sidebar');
  await page.locator('[data-fixture-live] [data-codex-your-dot-proxy]').click();
  assert.deepEqual(await page.evaluate(() => window.fixtureOrbitClicks), { live: 1, stale: 0 }, 'Your dot forwards to hidden source');
  assert.equal(await page.locator('#fixture-stale .codex-conversation-card-content').count(), 0, 'hidden native rows received cards');
  assert.equal(await page.locator('[data-fixture-live] .codex-conversation-card-content').count(), 2);
  await page.locator('[data-codex-sidebar-section-tab="项目"]').click();
  assert.ok(await page.locator('main').isVisible(), 'project selection hides conversation');
  assert.ok(await page.locator('#fixture-right').isVisible(), 'project selection hides native right panel');
});

test('replacing the visible native sidebar relocates controls and preserves conversation/right layout', { timeout: 30_000 }, async t => {
  const { page, errors } = await setup(t, { stale: true });
  await page.evaluate(() => {
    const template = document.createElement('template'); template.innerHTML = window.fixtureNativeSidebar;
    const next = template.content.firstElementChild; next.dataset.fixtureReplacement = '';
    window.fixtureReplacementClicks = { newConversation: 0, orbit: 0 };
    next.querySelector('[data-sidebar-destination="builtin:orbit"]').addEventListener('click', () => window.fixtureReplacementClicks.orbit++);
    Array.from(next.querySelectorAll('button')).find(button => button.textContent === '新对话').addEventListener('click', () => window.fixtureReplacementClicks.newConversation++);
    document.querySelector('[data-fixture-live]').replaceWith(next);
  });
  await page.waitForFunction(() => Boolean(document.querySelector('[data-fixture-replacement] #codex-sidebar-section-tabs')), null, { timeout: 3000 });
  assert.equal(await page.locator('#codex-sidebar-section-tabs').count(), 1);
  assert.equal(await page.locator('[data-fixture-replacement] [data-codex-your-dot-proxy]').count(), 1);
  await page.locator('[data-fixture-replacement] [data-codex-your-dot-proxy]').click();
  await page.locator('[data-fixture-replacement] [data-codex-sidebar-shortcut-name="新对话"]').click();
  assert.deepEqual(await page.evaluate(() => window.fixtureReplacementClicks), { newConversation: 1, orbit: 1 });
  await page.locator('[data-codex-sidebar-section-tab="项目"]').click();
  assert.ok(await page.locator('main').isVisible());
  assert.ok(await page.locator('#fixture-right').isVisible());
  assert.deepEqual(errors, []);
});

test('hidden/style/class-only sidebar visibility changes transfer controls and card ownership', { timeout: 35_000 }, async t => {
  for (const mode of ['hidden', 'style', 'class']) await t.test(mode, { timeout: 10_000 }, async t => {
    const { page, errors } = await setup(t, { stale: true });
    await page.evaluate(mode => {
      const stale = document.querySelector('#fixture-stale');
      if (mode === 'style') { stale.style.display = 'none'; stale.hidden = false; }
      if (mode === 'class') { stale.classList.add('fixture-hidden'); stale.hidden = false; }
    }, mode);
    await page.waitForTimeout(300);
    await page.evaluate(mode => {
      const stale = document.querySelector('#fixture-stale'); const live = document.querySelector('[data-fixture-live]');
      if (mode === 'hidden') { live.hidden = true; stale.hidden = false; }
      if (mode === 'style') { live.style.display = 'none'; stale.style.display = ''; }
      if (mode === 'class') { live.classList.add('fixture-hidden'); stale.classList.remove('fixture-hidden'); }
    }, mode);
    await page.waitForFunction(() => Boolean(document.querySelector('#fixture-stale #codex-sidebar-section-tabs')), null, { timeout: 3000 });
    assert.equal(await page.locator('#codex-sidebar-section-tabs').count(), 1);
    assert.equal(await page.locator('#fixture-stale [data-codex-your-dot-proxy]').count(), 1);
    assert.equal(await page.locator('[data-fixture-live] .codex-conversation-card-content').count(), 0);
    assert.equal(await page.locator('#fixture-stale .codex-conversation-card-content').count(), 2);
    await page.locator('#fixture-stale [data-codex-your-dot-proxy]').click();
    assert.deepEqual(await page.evaluate(() => window.fixtureOrbitClicks), { live: 0, stale: 1 });
    await page.locator('[data-codex-sidebar-section-tab="项目"]').click();
    assert.ok(await page.locator('main').isVisible());
    assert.ok(await page.locator('#fixture-right').isVisible());
    assert.deepEqual(errors, []);
  });
});

test('idle, pointerover storms and conversation child updates do not trigger full sidebar scans', { timeout: 30_000 }, async t => {
  const { page, errors } = await setup(t);
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => window.fixtureScans);
  await page.waitForTimeout(1200);
  const idle = (await page.evaluate(() => window.fixtureScans)) - before;
  t.diagnostic(JSON.stringify({ idleSidebarScans: idle }));
  await page.evaluate(async () => {
    const target = document.querySelector('[data-markdown-text-style]');
    window.fixtureScans = 0;
    for (let i = 0; i < 20; i++) {
      for (let n = 0; n < 100; n++) target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  });
  await page.waitForTimeout(500);
  const pointerScans = await page.evaluate(() => window.fixtureScans);
  await page.evaluate(async () => {
    window.fixtureScans = 0;
    const target = document.querySelector('[data-markdown-text-style]');
    for (let i = 0; i < 20; i++) {
      target.replaceChildren(document.createTextNode(`Streaming chunk ${i}`));
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  });
  await page.waitForTimeout(500);
  const metrics = await page.evaluate(() => ({ bodySidebarScans: window.fixtureScans, pointerovers: 2000, bodyUpdates: 20, longTasks: window.fixtureLongTasks }));
  metrics.pointerSidebarScans = pointerScans;
  t.diagnostic(JSON.stringify(metrics));
  assert.equal(idle, 0, 'runtime mutations trigger its own full sync loop');
  assert.equal(metrics.pointerSidebarScans, 0, 'unrelated pointer changes perform full sidebar sync');
  assert.equal(metrics.bodySidebarScans, 0, 'unrelated conversation child changes perform full sidebar sync');
  assert.deepEqual(errors, []);
});

test('rail tabs are clickable and keyboard accessible at 300px and narrow widths while idle or running', { timeout: 30_000 }, async t => {
  const { page, errors } = await setup(t);
  const outputDir = new URL('../../../outputs/', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:');
  mkdirSync(outputDir, { recursive: true });
  for (const width of [1440, 1200, 1120]) {
    await page.setViewportSize({ width, height: 900 });
    for (const running of [false, true]) {
      await page.evaluate(({ id, sentinel, running }) => window[sentinel].setThreadOverview({ threadId: id, title: 'Task A', goal: 'Goal A', running }), { id: ids[0], sentinel, running });
      await page.waitForFunction(running => document.querySelector('[data-codex-thread-overview-status]')?.dataset.running === String(running), running);
      await page.locator('[data-task-rail-tab="library"]').click();
      assert.equal(await page.locator('#codex-thread-overview-rail').getAttribute('data-task-pane'), 'library');
      await page.locator('[data-task-rail-tab="context"]').click();
      await page.locator('[data-task-rail-tab="context"]').focus();
      for (let n = 0; n < 4; n++) await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.taskRailTab), 'library');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#codex-thread-overview-rail').getAttribute('data-task-pane'), 'library');
      const metrics = await page.evaluate(() => {
        const rail = document.querySelector('#codex-thread-overview-rail');
        const tab = rail.querySelector('[data-task-rail-tab="library"]');
        const status = rail.querySelector('[data-codex-thread-overview-status]');
        const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        return { rail: rect(rail), library: rect(tab), status: rect(status), focusedTab: document.activeElement?.dataset.taskRailTab };
      });
      assert.ok(Math.abs(metrics.rail.width - Math.max(248, Math.min(300, width * 0.22))) < 1);
      t.diagnostic(JSON.stringify({ viewport: width, running, ...metrics }));
      await page.screenshot({ path: join(outputDir, `renderer-rail-${width}-${running ? 'running' : 'idle'}.png`) });
      await page.locator('[data-task-rail-tab="context"]').click();
    }
  }
  assert.deepEqual(errors, []);
});

test('MOKE cards survive provider round trips without rebuilding unchanged content', { timeout: 30_000 }, async t => {
  const { page, errors } = await setup(t, { moke: true });
  await page.waitForFunction(() => document.querySelector('[data-library-loaded-count]')?.textContent === '3500');
  await page.locator('[data-task-rail-tab="library"]').click();
  const cards = page.locator('[data-library-items] > button[data-library-item]');
  assert.equal(await cards.count(), 50);
  assert.equal(await page.evaluate(() => {
    window.fixtureFirstMokeCard = document.querySelector('[data-library-items] > button[data-library-item]');
    return window.codexSidebarRegisterLibraryProvider({ id: 'fixture-other', name: 'Fixture Other', url: 'https://example.invalid' });
  }), true);
  assert.ok(await page.evaluate(() => window.fixtureFirstMokeCard === document.querySelector('[data-library-items] > button[data-library-item]')), 'unchanged MOKE content was rebuilt');
  const queries = await page.evaluate(() => window.fixtureMokeQueries.length);
  for (let round = 0; round < 2; round++) {
    await page.locator('[data-library-provider="fixture-other"]').click();
    assert.equal(await cards.count(), 0);
    assert.match(await page.locator('[data-library-items]').textContent(), /接口待接入/);
    await page.locator('[data-library-provider="moke"]').click();
    assert.equal(await cards.count(), 50, 'cached MOKE content did not return after provider switch');
    assert.match(await cards.first().textContent(), /Material 0/);
    assert.equal(await page.evaluate(() => window.fixtureMokeQueries.length), queries, 'provider switch refetched cached content');
  }
  assert.deepEqual(errors, []);
});

test('3500 authorized MOKE records stay off hidden DOM, visible window loads/searches and closing releases cards', { timeout: 60_000 }, async t => {
  const { page, context, errors } = await setup(t, { moke: true });
  await page.waitForFunction(() => document.querySelector('[data-library-loaded-count]')?.textContent === '3500');
  const hiddenCards = await page.locator('[data-library-items] > *').count();
  t.diagnostic(JSON.stringify({ records: 3500, hiddenCards, pages: await page.evaluate(() => window.fixtureMokeQueries.length) }));
  assert.equal(hiddenCards, 0, 'hidden library retains thousands of cards');
  if (process.env.RENDERER_DEBUG_SCREENSHOT) {
    t.diagnostic(JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('[data-task-rail-tab], [data-codex-thread-overview-status], #codex-thread-overview-rail')).map(node => {
      const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
      return { text: node.textContent.slice(0, 60), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, display: style.display, position: style.position, boxSizing: style.boxSizing, zIndex: style.zIndex, overflow: style.overflow };
    }))));
    await page.screenshot({ path: process.env.RENDERER_DEBUG_SCREENSHOT });
  }
  await page.locator('[data-task-rail-tab="library"]').click();
  const firstCards = await page.locator('[data-library-items] > [data-library-item]').count();
  assert.ok(firstCards > 0 && firstCards <= 200, `visible card window is unbounded: ${firstCards}`);
  const list = page.locator('[data-library-items]');
  await page.locator('[data-library-load-more]').click();
  await page.waitForTimeout(200);
  const afterLoad = await list.locator('[data-library-item]').count();
  assert.ok(afterLoad > firstCards && afterLoad <= 400, `cannot continue loading bounded cards: ${firstCards} -> ${afterLoad}`);
  await page.evaluate(() => { window.fixtureMokeHold = true; });
  await page.locator('[data-library-search-input]').fill('Material 3499');
  await page.waitForFunction(() => window.fixtureMokePending.length > 0);
  await page.locator('[data-task-rail-tab="context"]').click();
  assert.equal(await list.locator(':scope > *').count(), 0, 'closing pane retains material cards');
  await page.evaluate(() => { window.fixtureMokeHold = false; window.fixtureMokePending.splice(0).forEach(respond => respond()); });
  await page.waitForFunction(() => document.querySelector('[data-library-loaded-count]')?.textContent === '1');
  assert.equal(await list.locator(':scope > *').count(), 0, 'background response repopulates hidden card DOM');
  await page.locator('[data-task-rail-tab="library"]').click();
  assert.equal(await list.locator('[data-library-item]').count(), 1);
  assert.match(await list.textContent(), /Material 3499/);
  await page.locator('[data-task-rail-tab="context"]').click();
  await page.evaluate(id => {
    for (const row of document.querySelectorAll('[data-app-action-sidebar-thread-row]')) row.setAttribute('data-app-action-sidebar-thread-selected', String(row.getAttribute('data-app-action-sidebar-thread-id') === id));
    document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id', id);
  }, ids[1]);
  await page.waitForFunction(({ id, sentinel }) => document.querySelector('#codex-thread-overview-rail')?.dataset.threadId === id && window[sentinel].getActiveThreadContext().threadId === id, { id: ids[1], sentinel }, { timeout: 3000 });
  await page.evaluate(({ id, sentinel }) => window[sentinel].setThreadOverview({ threadId: id, title: 'Task B native', currentRequest: 'Background goal B', progress: 'Background summary B', summary: 'Background summary B', tokenUsage: { total_token_usage: { total_tokens: 12345, input_tokens: 12000, output_tokens: 345 }, model_context_window: 200000 } }), { id: ids[1], sentinel });
  assert.equal(await page.locator('[data-codex-thread-overview-title]').textContent(), 'Task B native');
  assert.match(await page.locator('[data-codex-thread-overview-details-request]').textContent(), /Background goal B/);
  assert.match(await page.locator('[data-codex-thread-master-summary]').textContent(), /Background summary B/);
  assert.match(await page.locator('[data-codex-thread-token-value]').getAttribute('title'), /12,345/);
  assert.equal(await list.locator(':scope > *').count(), 0, 'native thread change or overview setter repopulates hidden library');
  t.diagnostic(JSON.stringify({ nativeSwitchWithoutRefresh: ids[1], backgroundSummary: await page.locator('[data-codex-thread-master-summary]').textContent(), backgroundToken: await page.locator('[data-codex-thread-token-value]').textContent(), hiddenCardsAfterSetter: 0 }));
  const cdp = await context.newCDPSession(page);
  const counts = [];
  for (let batch = 0; batch < 3; batch++) {
    for (let n = 0; n < 10; n++) {
      await page.evaluate(({ id, sentinel }) => {
        for (const row of document.querySelectorAll('[data-app-action-sidebar-thread-row]')) row.setAttribute('data-app-action-sidebar-thread-selected', String(row.getAttribute('data-app-action-sidebar-thread-id') === id));
        document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id', id);
        window[sentinel].refresh();
        if (window[sentinel].getActiveThreadContext().threadId !== id) throw new Error('A/B context stale');
      }, { id: ids[n % 2], sentinel });
      await inject(page, source);
    }
    await page.evaluate(sentinel => window[sentinel].destroy(), sentinel);
    await page.waitForTimeout(400);
    await cdp.send('HeapProfiler.collectGarbage');
    counts.push(await cdp.send('Memory.getDOMCounters'));
    if (batch < 2) await inject(page, source);
  }
  t.diagnostic(JSON.stringify({ firstCards, afterLoad, reinjections: 30, switches: 30, postDestroyCounters: counts, longTasks: await page.evaluate(() => window.fixtureLongTasks) }));
  assert.equal(counts[2].jsEventListeners, counts[1].jsEventListeners, 'listeners accumulate after reinjection');
  assert.ok(counts[2].nodes <= counts[1].nodes + 5, 'detached nodes accumulate after reinjection');
  assert.equal(await page.locator('#codex-thread-overview-rail, #codex-sidebar-section-tabs').count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.fixtureRejections), []);
});
const rows = ids.map((id, i) => `<div role="button" tabindex="0" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="${id}" data-app-action-sidebar-thread-title="Task ${i ? 'B' : 'A'}" ${i ? '' : 'data-app-action-sidebar-thread-selected="true"'}><span data-thread-title-trigger="true"><span data-thread-title>Task ${i ? 'B' : 'A'}</span></span></div>`).join('');
const html = `<!doctype html><html data-theme="dark"><head><style>body{margin:0;display:flex;height:900px}#app-shell-sidebar{width:280px}main{width:1100px} [data-app-shell-thread-edge-divider],#thread-host{height:800px;width:1050px}[data-app-action-timeline-scroll]{height:500px} [data-app-action-sidebar-thread-row]{height:60px} [data-response-annotation-conversation]{height:40px}</style></head><body><aside id="app-shell-sidebar"><div data-app-action-sidebar-scroll><nav><div><button>新对话</button></div><div><button>拉取请求</button><button>插件</button><button data-sidebar-destination="builtin:orbit">Your dot</button></div></nav>${['置顶','项目','最近'].map(name => `<section><div class="group/nav-section-title"><button data-app-action-sidebar-section-toggle aria-expanded="true"><span class="min-w-0 truncate">${name}</span></button></div>${name === '最近' ? rows : ''}</section>`).join('')}</div></aside><main data-app-shell-main-content-layout="thread-edge-scroll"><div data-app-shell-thread-edge-divider><div id="thread-host"><div data-app-action-timeline-scroll><div data-thread-find-target="conversation"><div data-turn-key="turn"><div data-local-conversation-user-anchor="true"><div data-user-message-bubble="true">Goal A</div></div><div data-local-conversation-final-assistant="true"><div data-response-annotation-conversation="${ids[0]}" data-response-annotation-target="final"><div data-markdown-text-style="assistant-message">Progress A</div></div></div></div></div></div><div data-codex-composer-root data-composer-placement="thread"><div data-above-composer-portal="true" data-above-composer-conversation-id="${ids[0]}"></div><div contenteditable="true" role="textbox"></div></div></div></div></main></body></html>`;

async function fixture(browser, url = 'http://127.0.0.1') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === url ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => {
    window.fixtureRejections = [];
    window.addEventListener('unhandledrejection', event => window.fixtureRejections.push(String(event.reason)));
    window.fixtureRefetches = 0;
    window.fixtureNavigations = [];
    window.addEventListener('message', event => { if (event.data?.type === 'navigate-to-route') window.fixtureNavigations.push(event.data.path); });
    localStorage.setItem('codex-conversation-preview:overview-collapsed', 'false');
    const refetch = async () => { window.fixtureRefetches++; };
    window.__codexRoot = { _internalRoot: { current: { memoizedState: { memoizedState: { data: [{ conversationId: 'fixture' }], refetch }, next: { memoizedState: { data: { threadIds: ['fixture'] }, refetch: async () => { window.fixtureRefetches++; } } } } } } };
    window.fixtureMcpRequests = [];
    window.fixtureDeferMcp = false;
    window.electronBridge = { sendMessageFromView: async message => {
      if (message?.type !== 'mcp-request') return;
      window.fixtureMcpRequests.push(message.request);
      if (window.fixtureDeferMcp) return;
      const { id, method } = message.request;
      if (method === 'config/read' || method === 'mcpServerStatus/list') {
        window.postMessage({ type: 'mcp-response', hostId: 'local', message: { id, result: method === 'config/read' ? { config: {} } : { data: [] } } }, '*');
      }
    } };
  });
  await page.goto(url);
  return { page, context, errors };
}
