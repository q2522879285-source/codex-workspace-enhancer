import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const module of [process.env.RENDERER_PLAYWRIGHT, 'playwright', join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
  try { ({ chromium } = require(module)); break; } catch {}
}
const executablePath = process.env.RENDERER_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const sentinel = '__codexConversationPreviewInjection__';
const cycles = Number(process.env.RENDERER_CYCLES || 100);
async function inject(page, content) {
  const script = await page.addScriptTag({ content });
  await script.evaluate(node => node.remove());
  await script.dispose();
}
const rows = ids.map((id, i) => `<div role="button" tabindex="0" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="${id}" data-app-action-sidebar-thread-title="Task ${i ? 'B' : 'A'}" ${i ? '' : 'data-app-action-sidebar-thread-selected="true"'}><span data-thread-title-trigger="true"><span data-thread-title>Task ${i ? 'B' : 'A'}</span></span></div>`).join('');
const html = `<!doctype html><html data-theme="dark"><head><style>body{margin:0;display:flex;height:900px}#app-shell-sidebar{width:280px}main{width:1100px} [data-app-shell-thread-edge-divider],#thread-host{height:800px;width:1050px}[data-app-action-timeline-scroll]{height:500px} [data-app-action-sidebar-thread-row]{height:60px} [data-response-annotation-conversation]{height:40px}</style></head><body><aside id="app-shell-sidebar"><div data-app-action-sidebar-scroll><nav><div><button>新对话</button></div><div><button>拉取请求</button><button>插件</button><button data-sidebar-destination="builtin:orbit">Your dot</button></div></nav>${['置顶','项目','最近'].map(name => `<section><div class="group/nav-section-title"><button data-app-action-sidebar-section-toggle aria-expanded="true"><span class="min-w-0 truncate">${name}</span></button></div>${name === '最近' ? rows : ''}</section>`).join('')}</div></aside><main data-app-shell-main-content-layout="thread-edge-scroll"><div data-app-shell-thread-edge-divider><div id="thread-host"><div data-app-action-timeline-scroll><div data-thread-find-target="conversation"><div data-turn-key="turn"><div data-local-conversation-user-anchor="true"><div data-user-message-bubble="true">Goal A</div></div><div data-local-conversation-final-assistant="true"><div data-response-annotation-conversation="${ids[0]}" data-response-annotation-target="final"><div data-markdown-text-style="assistant-message">Progress A</div></div></div></div></div></div><div data-codex-composer-root data-composer-placement="thread"><div data-above-composer-portal="true" data-above-composer-conversation-id="${ids[0]}"></div><div contenteditable="true" role="textbox"></div></div></div></div></main></body></html>`;

async function fixture(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
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

function snapshot(page) {
  return page.evaluate(() => {
    const rail = document.querySelector('#codex-thread-overview-rail');
    return { nodes: document.querySelectorAll('*').length, rails: document.querySelectorAll('#codex-thread-overview-rail').length, styles: document.querySelectorAll('#codex-conversation-preview-style').length, cards: document.querySelectorAll('.codex-conversation-card-content').length, rows: document.querySelectorAll('[data-app-action-sidebar-thread-row]').length, tabs: document.querySelectorAll('#codex-sidebar-section-tabs').length, threadId: window.__codexConversationPreviewInjection__?.getActiveThreadContext().threadId, railThreadId: rail?.dataset.threadId, title: rail?.querySelector('[data-codex-thread-overview-title]')?.textContent, text: rail?.textContent, rejections: window.fixtureRejections };
  });
}

test('complete renderer initializes and survives task/refresh/reinjection pressure in isolated Chromium', { timeout: 180_000 }, async t => {
  if (!chromium) return t.skip('Existing Playwright unavailable; set RENDERER_PLAYWRIGHT. No browser validation performed.');
  const server = createServer((request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const started = performance.now();
  if (process.env.RENDERER_BASELINE_REF) {
    const baseline = execFileSync('git', ['show', `${process.env.RENDERER_BASELINE_REF}:inject/conversation-preview.user.js`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    const old = await fixture(browser, url);
    await inject(old.page, baseline);
    await old.page.waitForTimeout(150);
    assert.ok(old.errors.some(error => /currentConversationThreadId is not defined/.test(error)), JSON.stringify(old.errors));
    t.diagnostic(`Baseline ${process.env.RENDERER_BASELINE_REF}: missing-helper ReferenceError reproduced by complete script.`);
    await old.context.close();
  }
  const { page, context, errors } = await fixture(browser, url);
  t.after(() => context.close());
  await inject(page, source);
  await page.waitForTimeout(200);
  assert.deepEqual(errors, []);
  const first = await snapshot(page);
  assert.equal(first.rails, 1); assert.equal(first.styles, 1); assert.equal(first.cards, 2); assert.equal(first.tabs, 1);
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const beforeHeap = await cdp.send('Runtime.getHeapUsage');
  let maxNodes = first.nodes;
  for (let i = 0; i < cycles; i++) {
    const index = i % 2; const id = ids[index]; const label = index ? 'B' : 'A';
    await page.evaluate(({ id, label, sentinel, other }) => {
      for (const row of document.querySelectorAll('[data-app-action-sidebar-thread-row]')) row.setAttribute('data-app-action-sidebar-thread-selected', String(row.getAttribute('data-app-action-sidebar-thread-id') === id));
      document.querySelector('[data-response-annotation-conversation]').setAttribute('data-response-annotation-conversation', id);
      document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id', id);
      document.querySelector('[data-user-message-bubble]').textContent = `Goal ${label}`;
      document.querySelector('[data-markdown-text-style="assistant-message"]').textContent = `Progress ${label}`;
      const api = window[sentinel];
      api.setThreadOverview({ threadId: id, cwd: 'C:/fixture', title: `Task ${label}`, goal: `Goal ${label}`, currentRequest: `Goal ${label}`, progress: `Progress ${label}`, nextStep: `Next ${label}` });
      api.setThreadOverview({ threadId: other, title: 'STALE TASK', goal: 'STALE GOAL' });
      api.setColdHistory({ threadId: other, available: true });
      api.setSkillCatalog({ threadId: id, entries: [{ name: `fixture-${label}`, title: `Skill ${label}`, enabled: true }] });
      api.setSkillCatalog({ threadId: other, entries: [{ name: 'stale', title: 'STALE SKILL' }] });
      for (let n = 0; n < 10; n++) api.refresh();
      if (api.getColdHistoryThreadId() !== id || api.getDefaultSkillsTask().threadId !== id || api.getDefaultSkillsTask().entries[0]?.title !== `Skill ${label}`) throw new Error('task-scoped API leaked: ' + JSON.stringify({id, cold: api.getColdHistoryThreadId(), skills: api.getDefaultSkillsTask()}));
    }, { id, label, sentinel, other: ids[1-index] });
    await page.waitForTimeout(100);
    const current = await snapshot(page);
    assert.equal(current.threadId, id); assert.equal(current.title, `Task ${label}`);
    assert.ok(!current.text.includes('STALE GOAL'));
    assert.equal(current.rails, 1); assert.equal(current.styles, 1); assert.equal(current.cards, 2); assert.equal(current.tabs, 1);
    assert.ok(current.nodes <= first.nodes + 5, `DOM accumulation: ${first.nodes} -> ${current.nodes}`);
    maxNodes = Math.max(maxNodes, current.nodes);
  }
  await page.evaluate(async sentinel => {
    const api = window[sentinel];
    await Promise.all(Array.from({length: 20}, () => api.refreshNativeSidebar()));
    for (let i = 0; i < 20; i++) await api.refreshNativeSidebar();
  }, sentinel);
  assert.equal(await page.evaluate(() => window.fixtureRefetches), 2);
  for (let i = 0; i < 20; i++) {
    await inject(page, source);
    await page.waitForTimeout(100);
    const current = await snapshot(page);
    assert.equal(current.rails, 1); assert.equal(current.styles, 1); assert.equal(current.cards, 2); assert.equal(current.tabs, 1);
  }
  await page.evaluate(() => {
    const container = document.createElement('div'); container.id = 'fixture-skills';
    container.innerHTML = '<div class="overflow-y-auto"><div class="sticky"><input placeholder="搜索技能"></div><section id="skills-installed"><div role="button" tabindex="0"><div class="font-medium">Fixture Skill</div><div class="text-token-text-secondary text-sm">Fixture description</div></div></section></div>';
    document.body.append(container);
    window.__codexConversationPreviewInjection__.refresh();
  });
  assert.equal(await page.locator('#codex-skill-organizer').count(), 1);
  await page.locator('[data-codex-skill-filter="全部"]').click();
  assert.match(await page.locator('#codex-skill-organizer').textContent(), /Fixture Skill/);
  for (let i = 0; i < 10; i++) { await inject(page, source); await page.waitForTimeout(100); assert.equal(await page.locator('#codex-skill-organizer').count(), 1); }
  await page.evaluate(({ sentinel, ids }) => {
    window[sentinel].setSearchCatalog([{ projectId: 'fixture', title: 'Search Fixture Task', threadId: ids[1] }]);
  }, { sentinel, ids });
  await page.keyboard.press('Control+k');
  await page.locator('[data-codex-global-search-input]').fill('Search Fixture');
  await page.locator('[data-codex-global-search-result]').click();
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => window.fixtureNavigations), [`/local/${ids[1]}`]);
  await inject(page, readFileSync(new URL('../inject/global-task-map.js', import.meta.url), 'utf8'));
  await page.evaluate(({ sentinel, id }) => {
    localStorage.setItem('workspace-enhancer-global-map-v1', JSON.stringify({ version: 1, directions: [], items: [{ id: 'fixture-item', title: 'Fixture Item', next: 'Next', note: '', status: 'todo', focus: false, x: 0, y: 0, directionId: null, threadIds: [id] }], catalog: [{ id, title: 'Task A' }], view: { x: 0, y: 0, scale: 1 } }));
    localStorage.setItem('workspace-enhancer-global-map-ui-v1', 'map');
    window[sentinel].openGlobalTaskMap();
  }, { sentinel, id: ids[0] });
  await page.locator('#codex-global-task-map .node[data-id="fixture-item"]').click();
  await page.locator('#codex-global-task-map').getByRole('button', { name: '打开任务', exact: true }).click();
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => window.fixtureNavigations), [`/local/${ids[1]}`, `/local/${ids[0]}`]);
  assert.equal(await page.locator('#codex-global-task-map').count(), 0);
  await page.evaluate(sentinel => window[sentinel].destroy(), sentinel);
  await page.waitForTimeout(500);
  const clean = await snapshot(page);
  assert.equal(clean.rails, 0); assert.equal(clean.styles, 0); assert.equal(clean.cards, 0); assert.equal(clean.tabs, 0);
  assert.equal(await page.locator('#codex-skill-organizer').count(), 0);
  assert.equal(await page.evaluate(sentinel => Boolean(window[sentinel]), sentinel), false);
  const stableNodes = clean.nodes;
  await page.waitForTimeout(500);
  assert.equal((await snapshot(page)).nodes, stableNodes, 'destroyed observer/timers re-created DOM');
  assert.deepEqual(errors, []); assert.deepEqual(clean.rejections, []);
  await cdp.send('HeapProfiler.collectGarbage');
  const afterHeap = await cdp.send('Runtime.getHeapUsage');
  t.diagnostic(JSON.stringify({ browser: browser.version(), cycles, explicitRefreshes: cycles * 10, nativeRefreshCalls: 40, nativeRefetches: 2, reinjections: 30, elapsedMs: Math.round(performance.now()-started), pageErrors: errors.length, unhandledRejections: clean.rejections.length, firstNodes: first.nodes, maxNodes, destroyedNodes: clean.nodes, beforeHeapBytes: beforeHeap.usedSize, afterHeapBytes: afterHeap.usedSize, limitation: 'Synthetic native DOM; no live Codex, backend, login, or visual acceptance. Heap is diagnostic, not a proof of zero memory leaks.' }));
});

test('renderer heap and listener growth after warm-up in isolated Chromium', { timeout: 120_000 }, async t => {
  if (!chromium) return t.skip('Existing Playwright unavailable; no browser validation performed.');
  const server = createServer((request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const { page, context, errors } = await fixture(browser, `http://127.0.0.1:${server.address().port}`);
  t.after(() => context.close());
  const cdp = await context.newCDPSession(page);
  const measurements = [];
  for (let batch = 0; batch < 6; batch++) {
    for (let i = 0; i < 10; i++) { await inject(page, source); await page.waitForTimeout(100); }
    await page.evaluate(sentinel => window[sentinel].destroy(), sentinel);
    await page.waitForTimeout(300);
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const dom = await cdp.send('Memory.getDOMCounters');
    const listeners = {};
    for (const expression of ['window', 'document']) {
      const { result } = await cdp.send('Runtime.evaluate', { expression });
      listeners[expression] = (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.length;
      await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
    }
    measurements.push({ injections: (batch+1)*10, usedHeapBytes: heap.usedSize, domNodes: dom.nodes, jsEventListeners: dom.jsEventListeners, ...listeners });
  }
  t.diagnostic(JSON.stringify({ reinjections: 60, measurements, limitation: 'Post-GC sampled renderer heap and DOM/listeners; not an exhaustive timer or application memory-leak proof.' }));
  const warm = measurements[1];
  for (const current of measurements.slice(2)) {
    assert.ok(current.usedHeapBytes <= warm.usedHeapBytes + 256 * 1024, 'post-GC heap growth exceeds warm-up tolerance');
    assert.equal(current.domNodes, warm.domNodes, 'detached DOM growth after warm-up');
    assert.equal(current.jsEventListeners, warm.jsEventListeners, 'event listener growth after warm-up');
    assert.equal(current.window, warm.window); assert.equal(current.document, warm.document);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.fixtureRejections), []);
});


test('destroy prevents retries from a delayed MCP failure in isolated Chromium', { timeout: 30_000 }, async t => {
  if (!chromium) return t.skip('Existing Playwright unavailable; no browser validation performed.');
  const server = createServer((request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  for (const phase of ['config/read', 'mcpServerStatus/list']) {
    const { page, context, errors } = await fixture(browser, `http://127.0.0.1:${server.address().port}`);
    t.after(() => context.close());
    await page.evaluate(() => { window.fixtureDeferMcp = true; });
    await inject(page, source);
    await page.waitForFunction(() => window.fixtureMcpRequests.some(request => request.method === 'config/read'));
    if (phase === 'mcpServerStatus/list') {
      await page.evaluate(() => {
        const request = window.fixtureMcpRequests.find(request => request.method === 'config/read');
        window.postMessage({ type: 'mcp-response', hostId: 'local', message: { id: request.id, result: { config: { mcp_servers: { moke: {} } } } } }, '*');
      });
      await page.waitForFunction(() => window.fixtureMcpRequests.some(request => request.method === 'mcpServerStatus/list'));
    }
    const statusAtDestroy = await page.evaluate(sentinel => {
      window.fixtureRetainedStatus = document.querySelector('.codex-task-library-status');
      const status = { text: window.fixtureRetainedStatus.textContent, state: window.fixtureRetainedStatus.dataset.state };
      window[sentinel].destroy();
      for (const request of window.fixtureMcpRequests) {
        window.postMessage({ type: 'mcp-response', hostId: 'local', message: { id: request.id, error: { message: 'Fixture host unavailable' } } }, '*');
      }
      return status;
    }, sentinel);
    const requestsAtDestroy = await page.evaluate(() => window.fixtureMcpRequests.length);
    await page.waitForTimeout(1300);
    const requestsAfterDestroy = await page.evaluate(() => window.fixtureMcpRequests.length);
    const statusAfterDestroy = await page.evaluate(() => ({ text: window.fixtureRetainedStatus.textContent, state: window.fixtureRetainedStatus.dataset.state }));
    t.diagnostic(JSON.stringify({ phase, requestsAtDestroy, requestsAfterDestroy, statusAtDestroy, statusAfterDestroy, errors }));
    assert.equal(requestsAfterDestroy, requestsAtDestroy, 'destroyed renderer issued a new MCP request');
    assert.deepEqual(statusAfterDestroy, statusAtDestroy, `${phase}: late MCP failure updated destroyed library status`);
    assert.equal((await snapshot(page)).rails, 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.fixtureRejections), []);
    await context.close();
  }
});
