import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  function ', start + 1));
}

test('file chips use native atMention nodes without changing text, formatting or other task drafts', () => {
  const text = { type: { name: 'text' }, text: '保留原有草稿', marks: ['bold'], nodeSize: 6 };
  const skill = { type: { name: 'skillMention' }, attrs: { path: 'C:/skills/a/SKILL.md' }, nodeSize: 1 };
  let active = 'a', dispatches = 0;
  const drafts = new Map([['a', [text, skill]], ['b', [text]]]);
  const atMention = { create: attrs => ({ type: { name: 'atMention' }, attrs, nodeSize: 1 }) };
  const controller = { view: { state: {
    schema: { nodes: { atMention } },
    get doc() {
      return { descendants(fn) {
        if (fn({ isTextblock: true, type: { name: 'paragraph', contentMatch: { matchType: () => true } } }, 0) === false) return;
        let pos = 1;
        for (const node of drafts.get(active)) { fn(node, pos); pos += node.nodeSize; }
      } };
    },
    get tr() {
      return {
        ops: [],
        insert(pos, node) { this.ops.push(['insert', pos, node]); return this; },
        delete(from, to) { this.ops.push(['delete', from, to]); return this; },
      };
    },
  }, dispatch(tr) {
    dispatches++;
    for (const [op, pos, arg] of tr.ops) {
      let nodes = drafts.get(active), offset = 1;
      if (op === 'insert') {
        const index = nodes.findIndex(node => { const match = offset === pos; offset += node.nodeSize; return match; });
        nodes.splice(index, 0, arg);
      } else nodes = nodes.filter(node => { const keep = offset < pos || offset >= arg; offset += node.nodeSize; return keep; });
      drafts.set(active, nodes);
    }
  } } };
  const context = vm.createContext({ taskSkillComposerController: () => controller, ensureTaskAssetComposerChips() {},
    currentConversationThreadId: () => active, normalizedThreadId: value => value });
  for (const name of ['isAbsoluteWindowsAssetPath', 'taskAssetReferenceKey', 'taskComposerAssetReferences', 'addAssetReferencesToComposer', 'removeTaskAssetReference']) vm.runInContext(extract(name), context);
  const paths = ['E:\\assets\\例子 图.png', 'E:/assets/movie.mp4'];
  assert.equal(context.addAssetReferencesToComposer(paths), true);
  assert.equal(dispatches, 1, 'one batch is one native transaction');
  assert.deepEqual(drafts.get('a').slice(2), [text, skill]);
  assert.deepEqual(drafts.get('a').slice(0, 2).map(n => [n.type.name, n.attrs.fsPath]), paths.map(path => ['atMention', path]));
  assert.equal(context.addAssetReferencesToComposer(['e:/ASSETS/例子 图.png']), true);
  assert.equal(dispatches, 1, 'Windows slash and case variants deduplicate');
  assert.equal(context.addAssetReferencesToComposer(['relative.png']), false);
  active = 'b';
  context.removeTaskAssetReference(paths[0], 'a');
  assert.equal(dispatches, 1);
  assert.deepEqual(drafts.get('b'), [text]);
  active = 'a';
  context.removeTaskAssetReference(paths[0], 'a');
  assert.equal(drafts.get('a')[0].attrs.fsPath, paths[1]);
  assert.deepEqual(drafts.get('a').slice(1), [text, skill]);
  assert.doesNotMatch(extract('addAssetReferencesToComposer'), /addTextToComposer|setText|focus\(|submit|sendMessage/);
});

test('asset selection keeps frame and task-context validation before adding native references', () => {
  const replies = [], added = [];
  const frame = { contentWindow: { postMessage: message => replies.push(message) }, focus() {} };
  const panel = { hidden: false, dataset: { taskContextKey: 'a\0Task A' } };
  const context = vm.createContext({ ASSET_CONSOLE_FRAME_ID: 'frame', ASSET_CONSOLE_PANEL_ID: 'panel',
    document: { getElementById: id => id === 'frame' ? frame : panel },
    assetConsoleTaskContextKey: () => 'a\0Task A', requestAnimationFrame: fn => fn(),
    addAssetReferencesToComposer: paths => { added.push(paths); return true; } });
  for (const name of ['isAbsoluteWindowsAssetPath', 'handleAssetConsoleMessage']) vm.runInContext(extract(name), context);
  const event = { origin: 'https://web-sandbox.oaiusercontent.com', source: frame.contentWindow,
    data: { source: 'asset-console', action: 'use-in-codex', path: 'E:/assets/a.png' } };
  context.handleAssetConsoleMessage({ ...event, origin: 'https://wrong.example' });
  context.handleAssetConsoleMessage({ ...event, source: {} });
  panel.dataset.taskContextKey = 'b\0Task B';
  context.handleAssetConsoleMessage(event);
  panel.dataset.taskContextKey = 'a\0Task A';
  panel.hidden = true;
  context.handleAssetConsoleMessage(event);
  assert.equal(added.length, 0);
  panel.hidden = false;
  context.handleAssetConsoleMessage(event);
  assert.deepEqual(Array.from(added[0]), ['E:/assets/a.png']);
  assert.equal(replies.at(-1).action, 'asset-added');
  context.handleAssetConsoleMessage({ ...event, data: { ...event.data, action: 'use-many-in-codex', paths: ['E:/assets/b.png', 'E:/assets/c.png'] } });
  assert.equal(replies.at(-1).action, 'assets-added');
  context.handleAssetConsoleMessage({ ...event, data: { ...event.data, path: 'relative.png' } });
  assert.equal(added.length, 2);
  assert.equal(replies.at(-1).action, 'asset-add-failed');
});
