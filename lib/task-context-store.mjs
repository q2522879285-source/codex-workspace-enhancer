import { readFileSync, statSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export function normalizeTaskId(value) {
  const id = typeof value === 'string' ? value.trim().replace(/^local:/i, '').toLowerCase() : '';
  return /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(id) ? id : null;
}

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return null; }
}

export function resolveTaskContext({ threadId, cwd = process.cwd(), codexHome = process.env.CODEX_HOME || join(homedir(), '.codex') } = {}) {
  const id = normalizeTaskId(threadId);
  if (!id) return null;
  const legacy = typeof cwd === 'string' && cwd ? join(cwd, 'work', 'task-context.json') : null;
  const root = join(codexHome, 'task-context');
  return { threadId: id,
    summaryPath: legacy && normalizeTaskId(readJson(legacy)?.threadId) === id ? legacy : join(root, `${id}.json`),
    statePath: join(root, `${id}.state.json`) };
}

export function readTaskContext(options) {
  const location = options?.summaryPath ? options : resolveTaskContext(options);
  if (!location) return null;
  const data = readJson(location.summaryPath);
  if (normalizeTaskId(data?.threadId) !== location.threadId ||
      typeof data?.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt)) ||
      !['goal', 'progress', 'nextStep'].every(key => typeof data[key] === 'string') ||
      !Array.isArray(data.agreements) || !data.agreements.every(item => typeof item === 'string')) return null;
  try { return { data: { ...data, threadId: location.threadId }, mtime: statSync(location.summaryPath).mtimeMs, path: location.summaryPath }; }
  catch { return null; }
}

export function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}
