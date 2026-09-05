import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PreviewRepository } from '../lib/preview-data.mjs';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const valid = {
  threadId: firstId, updatedAt: '2026-09-05T12:00:00.000Z',
  goal: '明确目标', progress: '完成读取', nextStep: '验证界面', agreements: ['保持原布局'],
};

test('default repository and guard share CODEX_HOME', () => {
  const previous = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = path.join(os.tmpdir(), 'custom-codex-home');
    assert.equal(new PreviewRepository().codexHome, process.env.CODEX_HOME);
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'project');
  const codexHome = path.join(root, 'codex');
  await mkdir(path.join(codexHome, 'sessions'), { recursive: true });
  await mkdir(path.join(cwd, 'work'), { recursive: true });
  for (const id of [firstId, secondId]) {
    await writeFile(path.join(codexHome, 'sessions', `${id}.jsonl`), [
      { type: 'session_meta', payload: { id, cwd } },
      { type: 'event_msg', timestamp: '2026-09-05T10:00:00Z', payload: { type: 'user_message', message: '原始目标' } },
    ].map(JSON.stringify).join('\n'));
  }
  await writeFile(path.join(codexHome, 'session_index.jsonl'), JSON.stringify({ id: firstId, thread_name: '同名任务' }));
  return { cwd, codexHome, repository: new PreviewRepository({ codexHome }), file: path.join(cwd, 'work', 'task-context.json') };
}

test('reads only matched context and refreshes it while session stays unchanged', async (t) => {
  const { repository, file, cwd } = await fixture(t);
  await writeFile(file, JSON.stringify({ ...valid, threadId: `local:${firstId}`, cwd }));
  const first = await repository.readOverview(`cloud:${firstId}`);
  assert.deepEqual(first.taskContext, { ...valid, references: [], assetBinding: null, referenceStatus: '' });
  assert.equal(first.goal, '原始目标');
  assert.equal(first.cwd, cwd);
  assert.equal(Object.hasOwn(first.taskContext, 'cwd'), false);
  await writeFile(file, JSON.stringify({ ...valid, progress: '已更新' }));
  const second = await repository.readOverview(firstId);
  assert.equal(second.taskContext.progress, '已更新');
  assert.equal(first.taskContext.progress, '完成读取');
});

test('global summaries keep tasks with the same working directory separate', async (t) => {
  const { repository, file, codexHome } = await fixture(t);
  await writeFile(file, JSON.stringify(valid));
  const globalDir = path.join(codexHome, 'task-context');
  await mkdir(globalDir);
  await writeFile(path.join(globalDir, `${secondId}.json`), JSON.stringify({ ...valid, threadId: secondId, goal: '第二个任务' }));
  assert.equal((await repository.readOverview(firstId)).taskContext.goal, valid.goal);
  assert.equal((await repository.readOverview(secondId)).taskContext.goal, '第二个任务');
});

test('different tasks sharing cwd and title fallback cannot borrow context', async (t) => {
  const { repository, file } = await fixture(t);
  await writeFile(file, JSON.stringify(valid));
  assert.equal((await repository.readOverview(secondId)).taskContext, null);
  assert.equal((await repository.readOverview('33333333-3333-4333-8333-333333333333', '同名任务')).taskContext, null);
});

test('missing, malformed and invalid context leave the base overview available', async (t) => {
  const { repository, file } = await fixture(t);
  const baseline = await repository.readOverview(firstId);
  assert.equal(baseline.taskContext, null);
  const invalid = [
    '{', 'null', '[]', '{}',
    ...['threadId', 'updatedAt', 'goal', 'progress', 'nextStep', 'agreements'].map((key) => JSON.stringify({ ...valid, [key]: undefined })),
    ...[{ goal: 4 }, { progress: {} }, { nextStep: [] }, { agreements: ['ok', 2] },
      { updatedAt: 42 }, { updatedAt: 'not-a-date' }, { threadId: `extra-${firstId}` }].map((patch) => JSON.stringify({ ...valid, ...patch })),
  ];
  for (const content of invalid) {
    await writeFile(file, content);
    assert.deepEqual(await repository.readOverview(firstId), baseline, content);
  }
  await writeFile(file, JSON.stringify(valid));
  assert.ok((await repository.readOverview(firstId)).taskContext);
  await rm(file);
  assert.deepEqual(await repository.readOverview(firstId), baseline);
});
