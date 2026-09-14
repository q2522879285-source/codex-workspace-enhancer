import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const key = 'codex-workspace-enhancer:mindmap-layouts-v1';
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0);
  return source.slice(start, end);
}
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.isConnected = true; this.clientWidth = 900; this.clientHeight = 600; this.listeners = {}; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  closest(selector) { if ((selector === '[data-node-id]' && this.dataset.nodeId) || (selector.startsWith('#') && this.tagName === 'aside')) return this; return this.parentElement?.closest(selector) || null; }
  focus() {}
  getBoundingClientRect() { return { x: 0, y: 0, width: 900, height: 600 }; }
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  click() { this.listeners.click?.({ preventDefault() {}, stopPropagation() {} }); this.onclick?.(); }
}
function fixture() {
  const storage = new Map(); const prompts = []; const blobs = [];
  const context = vm.createContext({ destroyed: false, activeId: 'task-a', Date, Map, Set, Number, JSON, Math,
    normalizedThreadId: id => String(id || '').replace(/^(local|cloud):/, ''),
    compactThreadText: (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max),
    currentConversationThreadId: () => context.activeId,
    taskContextForSnapshot: snapshot => snapshot.taskContext?.threadId === snapshot.threadId ? snapshot.taskContext : null,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    document: { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) },
    window: { prompt: () => prompts.shift(), confirm: () => true },
    Blob: class { constructor(parts) { blobs.push(parts.join('')); } }, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    ResizeObserver: class { observe() {} disconnect() {} }, setTimeout: () => 1, clearTimeout() {}, THREAD_OVERVIEW_RAIL_ID: 'rail',
  });
  vm.runInContext(['taskMapModel', 'taskMapDocument', 'syncTaskMapProgress', 'renderTaskMapSection'].map(extract).join('\n'), context);
  const rail = new Element('aside'); const section = new Element('section'); rail.append(section);
  const snapshot = { threadId: 'task-a', title: 'Example task', taskContext: { threadId: 'task-a', updatedAt: '2026-09-01T00:00:00Z', taskMap: { coreTask: { text: 'Stable plan' }, branches: [{ id: 'build', label: 'Build', text: 'Keep this plan', state: 'pending', source: 'confirmed', updatedAt: '2026-09-01T00:00:00Z', children: [{ id: 'test', text: 'Test', state: 'pending' }] }] } } };
  const all = (node = section) => [node, ...node.children.flatMap(child => all(child))];
  const find = predicate => all().find(predicate);
  const render = () => context.renderTaskMapSection(section, snapshot);
  const entry = () => JSON.parse(storage.get(key))['task-a'];
  return { context, section, snapshot, prompts, blobs, render, entry, find, storage };
}

test('map actions persist drag, edit, state, add/delete, zoom, expand and export', () => {
  const f = fixture(); f.render();
  const action = id => f.find(el => el.dataset.mapAction === id).click();
  let branch = f.find(el => el.dataset.nodeId === 'branch:build');
  let canvas = f.find(el => el.tagName === 'svg');
  const event = { button: 0, pointerId: 1, clientX: 20, clientY: 20, target: branch, preventDefault() {}, stopPropagation() {} };
  canvas.onpointerdown(event); canvas.onpointermove({ ...event, clientX: 120 }); canvas.onpointerup(event);
  assert.notEqual(f.entry().nodes['branch:build'].x, -245);
  f.prompts.push('Edited branch', 'Edited summary'); branch.ondblclick(event);
  assert.equal(f.entry().overrides['branch:build'].label, 'Edited branch');
  assert.equal(f.entry().overrides['branch:build'].state, undefined);
  branch = f.find(el => el.dataset.nodeId === 'branch:build'); branch.click();
  const select = f.find(el => el.tagName === 'select'); select.value = 'done'; select.onchange();
  assert.equal(f.entry().overrides['branch:build'].state, 'done');
  f.prompts.push('Local child'); action('add');
  assert.equal(f.entry().customNodes.length, 1);
  f.find(el => el.dataset.nodeId?.startsWith('custom:')).click(); action('delete');
  assert.equal(f.entry().customNodes.length, 0);
  const oldZoom = f.entry().view.k; action('in'); action('fit'); action('reset'); action('expand');
  assert.ok(oldZoom > 0); assert.equal(f.section.parentElement.dataset.mapExpanded, 'true');
  action('export'); const exported = JSON.parse(f.blobs[0]);
  assert.equal(exported.threadId, 'task-a'); assert.equal(exported.nodes.find(n => n.id === 'branch:build').label, 'Edited branch');
  assert.equal(exported.nodes.find(n => n.id === 'branch:build').state, 'done');
});

test('confirmed progress refresh survives cleanup, preserves core/branches and explicit local edits', () => {
  const f = fixture(); f.render();
  f.snapshot.taskContext.taskMap.coreTask.text = 'Unrelated current request';
  const branch = f.snapshot.taskContext.taskMap.branches[0];
  Object.assign(branch, { text: 'Unrelated text', state: 'done', updatedAt: '2026-09-02T00:00:00Z' });
  f.render(); f.section.taskMapCleanup(); delete f.section.taskMapSignature; f.render();
  assert.equal(f.entry().mapDocument.coreTask.text, 'Stable plan');
  assert.equal(f.entry().mapDocument.branches[0].text, 'Keep this plan');
  assert.equal(f.entry().mapDocument.branches[0].state, 'done');
  assert.equal(f.entry().overrides['branch:build'], undefined);
  assert.equal(f.find(el => el.dataset.nodeId === 'branch:build').dataset.state, 'done');
  const revision = f.entry().mapDocument.revision;
  Object.assign(branch, { state: 'blocked', updatedAt: '2026-09-03T00:00:00Z' });
  f.find(el => el.dataset.mapAction === 'sync').click();
  assert.equal(f.entry().mapDocument.branches[0].state, 'blocked');
  assert.ok(f.entry().mapDocument.revision > revision);
  f.find(el => el.dataset.nodeId === 'branch:build').click();
  const select = f.find(el => el.tagName === 'select'); select.value = 'done'; select.onchange();
  Object.assign(branch, { state: 'pending', updatedAt: '2026-09-04T00:00:00Z' });
  f.render();
  assert.equal(f.entry().mapDocument.branches[0].state, 'pending');
  assert.equal(f.find(el => el.dataset.nodeId === 'branch:build').dataset.state, 'done');
});

test('thread switching invalidates old callbacks and ignores reversed snapshots', () => {
  const f = fixture(); f.render(); const oldAdd = f.find(el => el.dataset.mapAction === 'add');
  f.context.activeId = 'task-b';
  f.context.renderTaskMapSection(f.section, { threadId: 'task-b', title: 'Task B' });
  oldAdd.click(); assert.equal(f.entry().customNodes.length, 0);
  assert.equal(f.section.dataset.threadId, 'task-b');
  assert.ok(!f.find(el => el.dataset.nodeId === 'branch:build'));
  f.render(); assert.equal(f.section.children.length, 0); assert.equal(f.section.attributes['aria-busy'], 'true');
  assert.equal(f.entry().mapDocument.coreTask.text, 'Stable plan');
});

test('empty maps remain unknown and map records omit unrelated input fields', () => {
  const f = fixture(); f.snapshot.taskContext.taskMap.secret = 'not a map field'; f.render();
  assert.equal(f.entry().mapDocument.secret, undefined);
  const nodes = f.context.taskMapModel({ threadId: 'empty' });
  assert.equal(nodes[0].state, 'unknown');
  assert.equal(nodes[0].label, '尚未记录核心任务');
});
