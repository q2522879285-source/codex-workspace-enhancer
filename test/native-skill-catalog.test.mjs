import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

test('native skills use current cwd, ignore unrelated and stale replies, and support refresh', async () => {
  const source = await readFile(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('  function requestTaskSkillCatalog('), source.indexOf('  function createTaskAutoContextSection('));
  const listeners = new Set();
  const requests = [];
  const catalogs = [];
  const timers = new Map();
  let sequence = 0;
  const context = vm.createContext({
    taskSkillCatalogKey: '', taskSkillRequestCleanup: null, destroyed: false,
    threadOverview: { threadId: 'a', cwd: 'C:/project-a' }, currentId: 'a',
    currentConversationThreadId: () => context.currentId,
    normalizedThreadId: value => String(value || '').replace(/^local:/, ''),
    crypto: { randomUUID: () => String(++sequence) },
    setSkillCatalog: value => catalogs.push(value),
    setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    window: {
      addEventListener: (_, fn) => listeners.add(fn),
      removeEventListener: (_, fn) => listeners.delete(fn),
      electronBridge: { sendMessageFromView: message => { requests.push(message); return Promise.resolve(); } },
    },
  });
  vm.runInContext(fn, context);
  const reply = (id, result) => { for (const listener of [...listeners]) listener({ data: { type: 'mcp-response', hostId: 'local', message: { id, result } } }); };
  context.requestTaskSkillCatalog();
  context.requestTaskSkillCatalog();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].request.params.cwds[0], 'C:/project-a');
  const result = { data: [{ skills: [{ name: 'plugin:skill', path: 'C:/skill/SKILL.md', enabled: false, interface: { displayName: 'Skill', shortDescription: 'Use it' } }], errors: [] }] };
  reply('unrelated', result);
  assert.equal(listeners.size, 1);
  reply(requests[0].request.id, result);
  assert.equal(catalogs.at(-1).entries[0].name, 'plugin:skill');
  assert.equal(catalogs.at(-1).entries[0].enabled, false);
  assert.equal(listeners.size, 0);
  context.requestTaskSkillCatalog(true);
  assert.equal(requests[1].request.params.forceReload, true);
  context.currentId = 'b';
  context.threadOverview = { threadId: 'b', cwd: 'C:/project-b' };
  const count = catalogs.length;
  reply(requests[1].request.id, result);
  assert.equal(catalogs.length, count);
  context.requestTaskSkillCatalog();
  assert.equal(requests[2].request.params.cwds[0], 'C:/project-b');
  [...timers.values()][0]();
  assert.match(catalogs.at(-1).error, /超时/);
  assert.equal(listeners.size, 0);
  context.requestTaskSkillCatalog(true);
  context.taskSkillRequestCleanup();
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
});
