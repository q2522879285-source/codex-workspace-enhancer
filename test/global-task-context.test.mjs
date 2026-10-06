import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, utimesSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizeTaskId, resolveTaskContext, readTaskContext, writeJsonAtomic, taskSkillDefaultText, readGlobalSkillDefaults, updateGlobalSkillDefaults } from '../lib/task-context-store.mjs';

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
  assert.equal(output(b, 'Stop'), '');
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
  const skillPath = join(root, 'SKILL.md');
  writeFileSync(skillPath, '# Test skill');
  const entry = { name: 'test-skill', title: '测试技能', path: skillPath };
  const text = taskSkillDefaultText(entry);
  const legacyDefault = '默认执行 · 旧技能（test-skill）：保持简短';
  const preserved = { ...data(a), goal: '原目标', progress: '原进展', nextStep: '原下一步',
    agreements: ['保留布局', legacyDefault], references: [{ kind: 'asset', path: skillPath, label: '参考' }] };
  writeJsonAtomic(legacy, preserved);
  const summaryBefore = readFileSync(legacy, 'utf8'), summaryTime = statSync(legacy).mtimeMs;
  const globalFile = join(codexHome, 'skill-defaults.json');
  assert.deepEqual(readGlobalSkillDefaults(codexHome), []);
  const added = updateGlobalSkillDefaults({ codexHome, action: 'add', entry });
  assert.deepEqual(added, [text]);
  assert.deepEqual(readGlobalSkillDefaults(codexHome), [text]);
  const saved = JSON.parse(readFileSync(globalFile, 'utf8'));
  assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
  assert.deepEqual(saved.defaults, [text]);
  const c = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const pc = resolveTaskContext(options(c));
  for (const id of [a, b, c]) {
    const injected = JSON.parse(output(id, 'UserPromptSubmit', 'skills-added')).hookSpecificOutput.additionalContext;
    assert.match(injected, /用户全局默认设置/);
    assert.ok(injected.includes(text));
    assert.ok(!injected.includes(legacyDefault));
    if (injected.includes('<task-context-data>')) {
      assert.ok(injected.indexOf(text) < injected.indexOf('<task-context-data>'));
      assert.ok(!injected.split('<task-context-data>')[1].includes(text));
    }
  }
  assert.equal(existsSync(pc.summaryPath), false);
  assert.equal(output(c, 'Stop', 'skills-added'), '');
  output(a, 'UserPromptSubmit', 'global-write-only');
  const stateBefore = readFileSync(pa.statePath, 'utf8');
  const unchanged = readFileSync(globalFile, 'utf8'), unchangedTime = statSync(globalFile).mtimeMs;
  assert.deepEqual(updateGlobalSkillDefaults({ codexHome, action: 'add', entry }), [text]);
  assert.deepEqual(updateGlobalSkillDefaults({ codexHome, action: 'add', entry: { ...entry, title: '新标题' } }), [text]);
  assert.equal(readFileSync(globalFile, 'utf8'), unchanged);
  assert.equal(statSync(globalFile).mtimeMs, unchangedTime);
  assert.deepEqual(updateGlobalSkillDefaults({ codexHome, action: 'remove', value: text }), []);
  assert.equal(readFileSync(pa.statePath, 'utf8'), stateBefore);
  assert.equal(readFileSync(legacy, 'utf8'), summaryBefore);
  assert.equal(statSync(legacy).mtimeMs, summaryTime);
  assert.equal(output(a, 'Stop', 'global-write-only'), '');
  for (const id of [a, b, c]) {
    const injected = output(id, 'UserPromptSubmit', 'skills-removed');
    assert.ok(!injected.includes(text));
    assert.ok(!injected.includes(legacyDefault));
  }
  const removedTime = statSync(globalFile).mtimeMs;
  assert.deepEqual(updateGlobalSkillDefaults({ codexHome, action: 'remove', value: text }), []);
  assert.equal(statSync(globalFile).mtimeMs, removedTime);
  assert.throws(() => updateGlobalSkillDefaults({ codexHome, action: 'remove', value: '保留布局' }));
  assert.throws(() => updateGlobalSkillDefaults({ codexHome, action: 'add', entry: { ...entry, path: join(root, 'missing', 'SKILL.md') } }));
  assert.throws(() => taskSkillDefaultText({ ...entry, path: 'SKILL.md' }));
  for (const content of ['{broken', 'null', '[]', '{}', JSON.stringify({ defaults: [42] })]) {
    writeFileSync(globalFile, content);
    assert.throws(() => readGlobalSkillDefaults(codexHome));
    assert.throws(() => updateGlobalSkillDefaults({ codexHome, action: 'add', entry }));
    assert.throws(() => updateGlobalSkillDefaults({ codexHome, action: 'remove', value: text }));
    assert.equal(readFileSync(globalFile, 'utf8'), content);
  }
  console.log('global task context checks passed');
} finally { rmSync(root, { recursive: true, force: true }); }
