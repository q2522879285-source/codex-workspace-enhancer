import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizeTaskId, resolveTaskContext, readTaskContext, writeJsonAtomic } from '../lib/task-context-store.mjs';

const root = mkdtempSync(join(tmpdir(), 'task-context-test-'));
const cwd = join(root, 'project'), codexHome = join(root, 'codex');
mkdirSync(cwd); mkdirSync(codexHome);
const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const options = id => ({ threadId: id, cwd, codexHome });
const data = id => ({ threadId: id, updatedAt: new Date().toISOString(), goal: id, progress: '', nextStep: '', agreements: [] });
const script = fileURLToPath(new URL('../scripts/task-context-guard.mjs', import.meta.url));
const run = (id, event, turn = 'one', extra = {}, args = []) => spawnSync(process.execPath, [script, ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, CODEX_HOME: codexHome, CODEX_THREAD_ID: id, LOCALAPPDATA: root },
  input: JSON.stringify({ session_id: id, cwd, hook_event_name: event, turn_id: turn, ...extra })
});
const output = (...args) => { const result = run(...args); assert.equal(result.status, 0, result.stderr); return result.stdout; };
try {
  assert.equal(normalizeTaskId(`local:${a}`), a);
  assert.equal(resolveTaskContext(options('../escape')), null);
  assert.equal(normalizeTaskId('cloud:' + a), null);
  const pa = resolveTaskContext(options(a)), pb = resolveTaskContext(options(b));
  assert.notEqual(pa.summaryPath, pb.summaryPath);
  assert.equal(readTaskContext(options(a)), null);
  assert.match(output(a, 'SessionStart'), /updatedAt/);
  assert.equal(existsSync(pa.summaryPath), false);
  output(a, 'UserPromptSubmit'); output(b, 'UserPromptSubmit');
  assert.match(output(a, null, 'one', {}, ['--ack']), /已登记/);
  assert.equal(output(a, 'Stop'), '');
  assert.equal(JSON.parse(output(b, 'Stop')).decision, 'block');
  assert.equal(output(b, 'Stop'), '');
  output(b, 'UserPromptSubmit', 'two');
  assert.equal(output(b, 'Stop', 'one'), '');
  assert.equal(output(b, 'Stop', 'two', { stop_hook_active: true }), '');
  writeJsonAtomic(pb.summaryPath, data(b));
  assert.equal(output(b, 'Stop', 'two'), '');
  output(b, 'UserPromptSubmit', 'three');
  writeJsonAtomic(pb.summaryPath, { ...data(b), progress: 'updated' });
  utimesSync(pb.summaryPath, new Date(), new Date(Date.now() + 2000));
  assert.equal(output(b, 'Stop', 'three'), '');
  const legacy = join(cwd, 'work', 'task-context.json');
  writeJsonAtomic(legacy, data(a));
  assert.equal(resolveTaskContext(options(a)).summaryPath, legacy);
  assert.equal(readTaskContext(options(a)).data.goal, a);
  assert.equal(resolveTaskContext(options(b)).summaryPath, pb.summaryPath);
  assert.match(output(a, null, 'one', {}, ['--read', '--cwd', cwd]), new RegExp(a));
  assert.equal(output('invalid', 'UserPromptSubmit'), '');
  assert.notEqual(run('invalid', null, 'one', {}, ['--ack']).status, 0);
  assert.equal(JSON.parse(readFileSync(pa.statePath)).threadId, a);
  console.log('global task context checks passed');
} finally { rmSync(root, { recursive: true, force: true }); }
