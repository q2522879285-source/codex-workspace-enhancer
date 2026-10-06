import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');

test('current task helper prefers the active thread and normalizes snapshot fallback', () => {
  const context = vm.createContext({
    active: 'task-b', snapshot: { threadId: 'local:task-a' },
    readActiveThreadId: () => context.active,
    resolvedCurrentThreadSnapshot: () => context.snapshot,
  });
  for (const name of ['normalizedThreadId', 'currentConversationThreadId']) {
    const start = source.indexOf(`  function ${name}(`);
    if (start !== -1) vm.runInContext(source.slice(start, source.indexOf('\n  function ', start + 1)), context);
  }
  assert.equal(context.currentConversationThreadId(), 'task-b');
  context.active = '';
  assert.equal(context.currentConversationThreadId(), 'task-a');
  context.snapshot = null;
  assert.equal(context.currentConversationThreadId(), '');
});

test('task navigation normalizes valid thread IDs and ignores non-routes', () => {
  const messages = [];
  const context = vm.createContext({ window: { postMessage: (message, origin) => messages.push({ ...message, origin }) } });
  for (const name of ['normalizedThreadId', 'homeProjectRoute', 'navigateToCodexThread']) {
    const start = source.indexOf(`  function ${name}(`);
    if (start !== -1) vm.runInContext(source.slice(start, source.indexOf('\n  function ', start + 1)), context);
  }
  assert.equal(context.navigateToCodexThread('local:11111111-1111-4111-8111-111111111111'), true);
  assert.deepEqual(messages, [{ type: 'navigate-to-route', path: '/local/11111111-1111-4111-8111-111111111111', origin: '*' }]);
  assert.equal(context.navigateToCodexThread('client-new-thread:temporary'), false);
  assert.equal(context.navigateToCodexThread(''), false);
  assert.equal(messages.length, 1);
});
