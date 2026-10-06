import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import vm from 'node:vm';
import { PreviewRepository } from '../lib/preview-data.mjs';
import { TaskMapIndex } from '../lib/cortexdb-task-map.mjs';
import { assetConsoleLocalRequestHeaders } from '../lib/asset-console-embed.mjs';

const injector = await readFile(new URL('../scripts/injector.mjs', import.meta.url), 'utf8');
const between = (start, end) => {
  const offset = injector.indexOf(start);
  assert.ok(offset >= 0, start);
  const stop = injector.indexOf(end, offset + start.length);
  assert.ok(stop > offset, end);
  return injector.slice(offset, stop);
};
const idFor = i => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`;

test('isolated catalog and context pressure retains task identity and bounds overview cache', { timeout: 20000 }, async t => {
  const started = performance.now();
  const root = await mkdtemp(path.join(tmpdir(), 'enhancer-runtime-pressure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'codex');
  const cwd = path.join(root, 'shared-project');
  await Promise.all([mkdir(path.join(home, 'sessions'), { recursive: true }), mkdir(path.join(home, 'task-context'), { recursive: true }), mkdir(path.join(cwd, 'work'), { recursive: true })]);
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  try {
    db.exec('CREATE TABLE threads (id TEXT, title TEXT, name TEXT, cwd TEXT, updated_at INTEGER, archived INTEGER, thread_source TEXT, rollout_path TEXT)');
    const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, 0, ?, ?)');
    for (let i = 0; i < 80; i++) {
      const id = idFor(i);
      const session = path.join(home, 'sessions', `${id}.jsonl`);
      insert.run(id, `Task ${i}`, '', cwd, i + 1, '', session);
      await writeFile(session, [
        { type: 'session_meta', payload: { id, cwd } },
        { type: 'event_msg', payload: { type: 'user_message', message: `history:${id}` } },
      ].map(JSON.stringify).join('\n'));
      await writeFile(path.join(home, 'task-context', `${id}.json`), JSON.stringify({ threadId: id, updatedAt: '2026-10-06T00:00:00Z', goal: `context:${id}`, progress: '', nextStep: '', agreements: [] }));
    }
  } finally { db.close(); }
  const repo = new PreviewRepository({ codexHome: home });
  for (let round = 0; round < 8; round++) {
    await Promise.all(Array.from({ length: 24 }, async (_, n) => {
      const i = (round * 24 + n) % 80;
      const id = idFor(i);
      const overview = await repo.readOverview(`${n % 2 ? 'local' : 'cloud'}:${id}`);
      assert.equal(overview.threadId, id);
      assert.equal(overview.goal, `history:${id}`);
      assert.equal(overview.taskContext.goal, `context:${id}`);
      assert.equal(overview.cwd, cwd);
      const catalog = repo.listThreads({ query: `Task ${i}`, limit: 200 });
      assert.ok(catalog.threads.some(row => row.id === id));
      assert.ok(catalog.threads.every(row => row.title.includes(`Task ${i}`)));
    }));
    assert.ok(repo.overviewCache.size <= 64);
    assert.equal(repo.indexRefresh, null);
  }
  assert.equal(repo.listThreads().total, 80);
  const original = await repo.readOverview(idFor(0));
  await writeFile(path.join(home, 'task-context', `${idFor(0)}.json`), '{');
  assert.equal((await repo.readOverview(idFor(0))).taskContext, null);
  assert.equal(original.taskContext.goal, `context:${idFor(0)}`);
  const emptyHome = path.join(root, 'empty');
  await mkdir(emptyHome);
  const empty = new PreviewRepository({ codexHome: emptyHome });
  assert.equal(await empty.readOverview(idFor(0)), null);
  assert.throws(() => empty.listThreads());
  const emptyDb = new DatabaseSync(path.join(emptyHome, 'state_5.sqlite'));
  emptyDb.exec('CREATE TABLE threads (id TEXT, title TEXT, name TEXT, cwd TEXT, updated_at INTEGER, archived INTEGER, thread_source TEXT)');
  emptyDb.close();
  assert.deepEqual(empty.listThreads(), { threads: [], total: 0, hasMore: false });
  t.diagnostic(`192 overview + 192 catalog reads; concurrency 24; 80 same-cwd tasks; cache ${repo.overviewCache.size}/64; ${Math.round(performance.now() - started)}ms`);
});

test('catalog/map binding replies remain correlated when reordered, disconnected or unconfigured', { timeout: 10000 }, async t => {
  const responses = [];
  const delayed = [];
  const receiver = vm.createContext({ window: { __codexConversationPreviewInjection__: { setTaskCatalog: result => responses.push(result) } } });
  const client = { evaluate: async expression => vm.runInContext(expression, receiver) };
  const context = vm.createContext({ client,
    repository: { listThreads: options => ({ threads: [{ id: options.query }], total: 1, hasMore: false }) },
    taskMapIndex: { graph: () => new Promise(resolve => delayed.push(resolve)) },
  });
  vm.runInContext(between('async function handleTaskCatalogBinding(', 'async function handleAccountProfilesBinding('), context);
  const reads = Array.from({ length: 96 }, (_, i) => context.handleTaskMapIndexBinding(JSON.stringify({ requestId: `map-${i}`, action: 'graph' })));
  for (let i = 95; i >= 0; i--) {
    delayed[i]({ nodes: [{ id: `node-${i}` }], edges: [] });
    await new Promise(resolve => setImmediate(resolve));
  }
  await Promise.all(reads);
  assert.equal(responses.length, 96);
  responses.forEach((result, i) => {
    assert.equal(result.requestId, `map-${95 - i}`);
    assert.equal(result.data.nodes[0].id, `node-${95 - i}`);
  });
  await Promise.all(Array.from({ length: 96 }, (_, i) => context.handleTaskCatalogBinding(JSON.stringify({ requestId: `catalog-${i}`, options: { query: `task-${i}` } }))));
  responses.slice(96).forEach((result, i) => assert.equal(result.data.threads[0].id, `task-${i}`));
  assert.equal(new Set(responses.map(result => result.requestId)).size, 192);
  const stale = context.handleTaskMapIndexBinding(JSON.stringify({ requestId: 'stale-client', action: 'graph' }));
  context.client = { evaluate: async () => { throw Error('stale result reached replacement client'); } };
  delayed.at(-1)({ nodes: [], edges: [] });
  await stale;
  assert.equal(responses.length, 192);
  context.client = client;
  const root = await mkdtemp(path.join(tmpdir(), 'enhancer-index-disabled-'));
  const index = new TaskMapIndex({ executable: '', databasePath: path.join(root, 'test.db') });
  t.after(async () => { index.close(); await rm(root, { recursive: true, force: true }); });
  context.taskMapIndex = index;
  for (let i = 0; i < 16; i++) await context.handleTaskMapIndexBinding(JSON.stringify({ requestId: `disabled-${i}`, action: 'graph' }));
  assert.ok(responses.slice(192).every(result => /not configured/.test(result.error) && !Object.hasOwn(result, 'data')));
  assert.equal(index.pending.size, 0);
  assert.equal(index.child, undefined);
  context.taskMapIndex = { graph: async () => { throw Error('synthetic backend disconnected'); } };
  await context.handleTaskMapIndexBinding(JSON.stringify({ requestId: 'offline', action: 'graph' }));
  assert.match(responses.at(-1).error, /disconnected/);
  const count = responses.length;
  for (const payload of ['{', 'null', '{}', JSON.stringify({ requestId: 'x'.repeat(101), action: 'graph' }), JSON.stringify({ requestId: 'wrong', action: 'delete' })]) await context.handleTaskMapIndexBinding(payload);
  assert.equal(responses.length, count);
  t.diagnostic('96 reversed map + 96 catalog replies; 1 stale-client suppressed; 16 disabled-index failures; 1 backend failure; 5 invalid messages ignored; pending 0');
});

test('local HTTP pressure settles aborted, oversized, timed-out and refused requests without retained sockets', { timeout: 15000 }, async t => {
  const started = performance.now();
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    if (request.url === '/abort') { response.writeHead(200, { 'content-length': 100 }); response.write('short'); response.destroy(); }
    else if (request.url === '/large') { response.writeHead(200, { 'content-length': 2048 }); response.end('x'.repeat(2048)); }
    else if (request.url === '/chunked') { response.write('x'.repeat(1024)); response.end('x'.repeat(1024)); }
    else if (request.url !== '/stall') response.end(JSON.stringify({ route: request.url, token: request.headers['x-asset-console-token'] }));
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const agent = new http.Agent({ keepAlive: false, maxSockets: 16 });
  t.after(async () => { agent.destroy(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  // Production uses a fixed installed port; route only this test's transport to its isolated listener.
  const context = vm.createContext({ Buffer, URL, assetConsoleUrl: `http://127.0.0.1:${port}`, assetConsoleLocalRequestHeaders,
    MAX_BUFFERED_ASSET_CONSOLE_RESPONSE_BYTES: 1024, MAX_ASSET_CONSOLE_MEDIA_RANGE_BYTES: 1024,
    http: { request: (options, callback) => http.request({ ...options, port, agent }, callback) },
  });
  vm.runInContext(between('function requestAssetConsole(', 'async function assetConsoleIsReady('), context);
  for (let round = 0; round < 4; round++) await Promise.all(Array.from({ length: 16 }, async (_, n) => {
    const route = `/read-${round * 16 + n}`;
    const result = await context.requestAssetConsole({ route, apiToken: 'test-only' });
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { route, token: 'test-only' });
  }));
  for (const [route, message] of [['/abort', /aborted|socket hang up/], ['/large', /exceeds|aborted/], ['/chunked', /exceeds|aborted/], ['/stall', /timed out/]]) {
    await Promise.all(Array.from({ length: 8 }, () => assert.rejects(context.requestAssetConsole({ route, timeoutMs: 50 }), message)));
  }
  const closed = [...sockets].map(socket => new Promise(resolve => socket.once('close', resolve)));
  server.closeAllConnections();
  await Promise.all([new Promise(resolve => server.close(resolve)), ...closed]);
  await Promise.all(Array.from({ length: 8 }, () => assert.rejects(context.requestAssetConsole({ timeoutMs: 100 }), error => error.code === 'ECONNREFUSED')));
  agent.destroy();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sockets.size, 0);
  assert.equal(Object.keys(agent.requests).length, 0);
  t.diagnostic(`64 successful reads; concurrency/socket cap 16; 8 each abort/declared oversize/chunked oversize/timeout/refusal; 1024-byte cap; retained sockets 0; ${Math.round(performance.now() - started)}ms`);
});
