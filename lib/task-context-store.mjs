import { readFileSync, statSync, mkdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
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

export const TASK_SKILL_DEFAULT_PREFIX = '默认执行 · ';

export function taskSkillDefaultText(entry) {
  if (!entry || !['name', 'title', 'path'].every(key =>
    typeof entry[key] === 'string' && entry[key].trim() && !/[\r\n]/u.test(entry[key]))) {
    throw Error('需要技能名称、标题和文件路径');
  }
  const path = normalize(entry.path.trim());
  if (!isAbsolute(path) || basename(path) !== 'SKILL.md' || !statSync(path).isFile()) {
    throw Error('技能路径必须是已存在的绝对 SKILL.md 文件');
  }
  return `${TASK_SKILL_DEFAULT_PREFIX}${entry.title.trim()}（${entry.name.trim()}）：每轮读取 ${path}`;
}

export function updateTaskSkillDefaults({ threadId, cwd, codexHome, action, entry, value } = {}) {
  const location = resolveTaskContext({ threadId, cwd, codexHome });
  if (!location) throw Error('需要有效任务 ID');
  if (action !== 'add' && action !== 'remove') throw Error('未知默认技能操作');
  const text = action === 'add' ? taskSkillDefaultText(entry) : value;
  if (typeof text !== 'string' || !text.startsWith(TASK_SKILL_DEFAULT_PREFIX)) {
    throw Error('只能修改默认执行项');
  }
  const current = readTaskContext(location);
  if (!current && existsSync(location.summaryPath)) throw Error('现有摘要无效，未修改');
  const data = current?.data || {
    threadId: location.threadId, updatedAt: new Date().toISOString(),
    goal: '', progress: '', nextStep: '', agreements: []
  };
  const index = data.agreements.indexOf(text);
  if ((action === 'add' && data.agreements.some(item => item.startsWith(TASK_SKILL_DEFAULT_PREFIX) &&
      (item === text || item.includes(`（${entry.name.trim()}）`)))) ||
      (action === 'remove' && index < 0)) return data;
  const agreements = [...data.agreements];
  if (action === 'add') agreements.push(text);
  else agreements.splice(index, 1);
  const updated = { ...data, agreements, updatedAt: new Date().toISOString() };
  writeJsonAtomic(location.summaryPath, updated);
  return updated;
}
