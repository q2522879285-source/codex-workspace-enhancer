import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");

test("global map closes without replacing the conversation, restores inert and focus, and cleans up failed mounts", () => {
  const block = source.slice(source.indexOf("  let globalTaskMap = null;"), source.indexOf("  function nativeShortcutSources()"));
  assert.ok(block.includes("function openGlobalTaskMap"), "global map lifecycle is available");
  const listeners = new Map();
  let bridge, mounts = 0, disposed = 0, focused = 0, fail = false;
  const content = { inert: false, getBoundingClientRect: () => ({ left: 200, top: 48, width: 1000, bottom: 800 }) };
  const opener = { isConnected: true, focus: () => focused++ };
  const document = {
    activeElement: opener,
    querySelector: selector => selector.includes("main-content-layout") ? content : null,
    createElement: () => ({ style: {}, setAttribute() {}, attachShadow: () => ({}), focus() {}, remove() { this.isConnected = false; } }),
    body: { appendChild: node => { node.isConnected = true; } },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
  };
  const window = { __codexGlobalTaskMap: { mount(root, nextBridge) {
    mounts++; bridge = nextBridge;
    if (fail) throw new Error("mount failed");
    return { destroy: () => disposed++, getState: () => ({ edited: true }) };
  } }, addEventListener() {}, removeEventListener() {} };
  const navigated = [];
  const context = vm.createContext({ document, window, innerHeight: 800, ResizeObserver: class { observe() {} disconnect() {} },
    navigateToCodexThread: id => { navigated.push(id); return true; }, ensureShortcutGrid() {} });
  vm.runInContext(`${block}\nthis.api = {openGlobalTaskMap,closeGlobalTaskMap,getGlobalTaskMapState};`, context);
  const api = context.api;
  assert.equal(api.openGlobalTaskMap(), true);
  assert.equal(content.inert, true);
  assert.equal(api.openGlobalTaskMap(), true);
  assert.equal(mounts, 1);
  assert.equal(api.getGlobalTaskMapState().open, true);
  assert.equal(api.getGlobalTaskMapState().state.edited, true);
  bridge.close();
  assert.equal(content.inert, false);
  assert.equal(focused, 1);
  assert.equal(disposed, 1);
  assert.equal(listeners.size, 0);
  assert.equal(navigated.length, 0);
  content.inert = true;
  api.openGlobalTaskMap();
  bridge.openThread("task-id");
  assert.equal(content.inert, true);
  assert.deepEqual(navigated, ["task-id"]);
  content.inert = false;
  fail = true;
  assert.throws(() => api.openGlobalTaskMap(), /mount failed/);
  assert.equal(content.inert, false);
  assert.equal(api.getGlobalTaskMapState().open, false);
});


test("catalog bridge resolves responses and ignores a late response after close", async () => {
  const block = source.slice(source.indexOf("  let globalTaskMap = null;"), source.indexOf("  function nativeShortcutSources()"));
  let bridge, request;
  const content = { inert: false };
  const window = { codexSidebarTaskCatalog: value => { request = JSON.parse(value); },
    __codexGlobalTaskMap: { mount: (root, next) => { bridge = next; return { destroy() {} }; } },
    addEventListener() {}, removeEventListener() {} };
  const document = { querySelector: s => s.includes("main-content-layout") ? content : null,
    createElement: () => ({ style: {}, setAttribute() {}, attachShadow: () => ({}), remove() {} }),
    body: { appendChild() {} } };
  const context = vm.createContext({ document, window, crypto: { randomUUID: () => "catalog-request" },
    setTimeout, clearTimeout, ResizeObserver: class { observe() {} disconnect() {} }, ensureShortcutGrid() {} });
  vm.runInContext(`${block}\nthis.api = {openGlobalTaskMap,closeGlobalTaskMap,setTaskCatalog};`, context);
  context.api.openGlobalTaskMap();
  const result = bridge.listThreads({ query: "find" });
  assert.equal(request.options.query, "find");
  context.api.setTaskCatalog({ requestId: request.requestId, data: { total: 1, threads: [{ id: "one" }], hasMore: false } });
  assert.equal((await result).total, 1);
  const pending = bridge.listThreads();
  const rejection = assert.rejects(pending, /已关闭/);
  context.api.closeGlobalTaskMap();
  await rejection;
  assert.doesNotThrow(() => context.api.setTaskCatalog({ requestId: request.requestId, data: { total: 100 } }));
  await assert.rejects(bridge.listThreads(), /已关闭/);
});

test("CortexDB bridge sends snapshots and queries, reports errors, and cancels closed maps", async () => {
  const block = source.slice(source.indexOf("  let globalTaskMap = null;"), source.indexOf("  function nativeShortcutSources()"));
  let bridge, request, sequence = 0;
  const content = { inert: false };
  const window = { codexSidebarTaskMapIndex: value => { request = JSON.parse(value); },
    __codexGlobalTaskMap: { mount: (root, next) => { bridge = next; return { destroy() {} }; } },
    addEventListener() {}, removeEventListener() {} };
  const document = { querySelector: s => s.includes("main-content-layout") ? content : null,
    createElement: () => ({ style: {}, setAttribute() {}, attachShadow: () => ({}), remove() {} }),
    body: { appendChild() {} } };
  const context = vm.createContext({ document, window, crypto: { randomUUID: () => `index-${++sequence}` },
    setTimeout, clearTimeout, ResizeObserver: class { observe() {} disconnect() {} }, ensureShortcutGrid() {} });
  vm.runInContext(`${block}\nthis.api = {openGlobalTaskMap,closeGlobalTaskMap,setTaskCatalog};`, context);
  context.api.openGlobalTaskMap();
  const snapshot = { version: 1, items: [{ id: "stable" }], directions: [], catalog: [] };
  const syncing = bridge.syncIndex(snapshot);
  assert.deepEqual(request.data, snapshot);
  assert.equal(request.action, "sync");
  context.api.setTaskCatalog({ requestId: request.requestId, data: { itemCount: 1 } });
  assert.equal((await syncing).itemCount, 1);
  const graphing = bridge.graphMemory();
  assert.equal(request.action, "graph");
  const graph = { nodes: [{ id: "iri:stable", entityId: "stable", kind: "item", title: "事项" }], edges: [] };
  context.api.setTaskCatalog({ requestId: request.requestId, data: graph });
  assert.deepEqual(await graphing, graph);
  const searching = bridge.searchMemory({ query: "red monkey" });
  assert.equal(request.action, "search");
  assert.equal(request.options.query, "red monkey");
  const failure = assert.rejects(searching, /offline/);
  context.api.setTaskCatalog({ requestId: request.requestId, error: "offline" });
  await failure;
  const pending = bridge.graphMemory();
  const rejection = assert.rejects(pending, /已关闭/);
  context.api.closeGlobalTaskMap();
  await rejection;
  assert.doesNotThrow(() => context.api.setTaskCatalog({ requestId: request.requestId, data: { results: [] } }));
  await assert.rejects(bridge.syncIndex(snapshot), /已关闭/);
});

test("injector graph action queries CortexDB and returns through the existing response channel", async () => {
  const injector = await readFile(new URL("../scripts/injector.mjs", import.meta.url), "utf8");
  const block = injector.slice(injector.indexOf("async function handleTaskMapIndexBinding("), injector.indexOf("async function handleAccountProfilesBinding("));
  const graph = { nodes: [{ id: "iri:one", kind: "item", entityId: "one", title: "事项" }], edges: [] };
  const responses = [];
  let calls = 0;
  const context = vm.createContext({ taskMapIndex: { graph: async () => { calls++; return graph; } }, client: { evaluate: async expression => responses.push(expression) } });
  vm.runInContext(block, context);
  await context.handleTaskMapIndexBinding(JSON.stringify({ requestId: "graph-1", action: "graph" }));
  assert.equal(calls, 1);
  assert.ok(responses[0].includes(JSON.stringify({ requestId: "graph-1", data: graph })));
  await context.handleTaskMapIndexBinding(JSON.stringify({ requestId: "bad", action: "delete" }));
  assert.equal(calls, 1);
  context.taskMapIndex.graph = async () => { throw Error("offline"); };
  await context.handleTaskMapIndexBinding(JSON.stringify({ requestId: "graph-2", action: "graph" }));
  assert.match(responses[1], /offline/);
});
