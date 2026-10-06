import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { AccountProfileStore } from '../lib/account-profiles.mjs';

test('account profiles keep tokens off renderer lists and switch through verified native login before isolated persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'enhancer-account-'));
  try {
    const authPath = join(dir, 'auth.json');
    const store = new AccountProfileStore({ root: dir, authPath });
    const jwt = payload => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
    await writeFile(authPath, JSON.stringify({ tokens: { account_id: 'old', access_token: 'old-access', id_token: jwt({ email: 'old@example.com' }) } }));
    store.upsert({ id: 'new', email: 'new@example.com', tokens: { account_id: 'new', access_token: 'new-access', id_token: jwt({ email: 'new@example.com' }) } });
    assert.ok(store.list().profiles.every(profile => !('tokens' in profile)));
    const source = await readFile(new URL('../scripts/injector.mjs', import.meta.url), 'utf8');
    const begin = source.indexOf('async function handleAccountProfilesBinding(');
    const end = source.indexOf('\nasync function ', begin + 1);
    const calls = [], replies = [], listeners = new Set();
    let rejectLogin = false;
    const window = {
      addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn),
      electronBridge: { sendMessageFromView: async ({ request }) => {
        calls.push(request.method);
        const message = rejectLogin ? { id: request.id, error: { message: 'native rejected' } } : { id: request.id, result: request.method === 'account/read' ? { account: { type: 'chatgpt', email: 'new@example.com' } } : {} };
        for (const listener of [...listeners]) listener({ data: { type: 'mcp-response', hostId: 'local', message } });
      } },
    };
    const native = vm.createContext({ window, crypto: { randomUUID: () => String(calls.length) }, setTimeout, clearTimeout });
    const context = vm.createContext({ accountProfileStore: store, client: { evaluate: async script => {
      if (script.startsWith('(async ()')) return vm.runInContext(script, native);
      replies.push(script);
    } } });
    vm.runInContext(source.slice(begin, end), context);
    await context.handleAccountProfilesBinding(JSON.stringify({ action: 'switch', id: 'new', requestId: 'switch-1' }));
    assert.deepEqual(calls, ['account/login/start', 'account/read']);
    assert.equal(JSON.parse(await readFile(authPath, 'utf8')).tokens.account_id, 'new');
    assert.ok(!replies[0].includes('new-access'));
    rejectLogin = true;
    await context.handleAccountProfilesBinding(JSON.stringify({ action: 'switch', id: 'old', requestId: 'switch-2' }));
    assert.match(replies[1], /native rejected/);
    assert.equal(JSON.parse(await readFile(authPath, 'utf8')).tokens.account_id, 'new');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
