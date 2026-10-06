import { readFileSync, statSync, mkdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, resolve, relative } from 'node:path';
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

export function globalSkillDefaultsPath(codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')) {
  return join(codexHome, 'skill-defaults.json');
}

export function readGlobalSkillDefaults(codexHome) {
  const path = globalSkillDefaultsPath(codexHome);
  if (!existsSync(path)) return [];
  const data = readJson(path);
  if (!Array.isArray(data?.defaults) || !data.defaults.every(item =>
    typeof item === 'string' && item.startsWith(TASK_SKILL_DEFAULT_PREFIX) && !/[\r\n]/u.test(item))) {
    throw Error('全局默认执行配置无效，未修改');
  }
  return data.defaults;
}

export function updateGlobalSkillDefaults({ codexHome, action, entry, value } = {}) {
  if (action !== 'add' && action !== 'remove') throw Error('未知默认技能操作');
  const text = action === 'add' ? taskSkillDefaultText(entry) : value;
  if (typeof text !== 'string' || !text.startsWith(TASK_SKILL_DEFAULT_PREFIX)) {
    throw Error('只能修改默认执行项');
  }
  const defaults = readGlobalSkillDefaults(codexHome);
  const index = defaults.indexOf(text);
  if ((action === 'add' && defaults.some(item =>
      (item === text || item.includes(`（${entry.name.trim()}）`)))) ||
      (action === 'remove' && index < 0)) return defaults;
  if (action === 'add') defaults.push(text);
  else defaults.splice(index, 1);
  writeJsonAtomic(globalSkillDefaultsPath(codexHome), { ...readJson(globalSkillDefaultsPath(codexHome)), updatedAt: new Date().toISOString(), defaults });
  return defaults;
}

function resolveSkillDefaultsProject({ codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'), threadId, cwd } = {}) {
  const state = readJson(join(codexHome, '.codex-global-state.json')) || {};
  const projects = state['local-projects'] || {};
  const id = normalizeTaskId(threadId);
  const assignment = id && state['thread-project-assignments']?.[id];
  const projectless = state['projectless-thread-ids'] || [];
  if (id && projectless.includes(id)) return null;
  let projectId = null;
  if (id && Object.hasOwn(state['thread-project-assignments'] || {}, id)) {
    if (assignment?.projectKind !== 'local' || !projects[assignment.projectId]) return null;
    projectId = assignment.projectId;
  } else if (typeof cwd === 'string' && cwd) {
    let longest = -1;
    for (const [key, project] of Object.entries(projects)) {
      for (const root of project.rootPaths || []) {
        if (typeof root !== 'string' || !isAbsolute(root)) continue;
        const delta = relative(resolve(root), resolve(cwd));
        if ((delta === '' || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith('..\\') && !delta.startsWith('../'))) && root.length > longest) {
          projectId = key; longest = root.length;
        }
      }
    }
  }
  return projectId ? { projectId, name: projects[projectId].name || projectId } : null;
}

export function readSkillDefaults(options = {}) {
  const globalSkillDefaults = readGlobalSkillDefaults(options.codexHome);
  const skillDefaultsProject = resolveSkillDefaultsProject(options);
  const config = readJson(globalSkillDefaultsPath(options.codexHome));
  const projectSkillDefaults = skillDefaultsProject ? config?.projects?.[skillDefaultsProject.projectId]?.defaults || [] : [];
  if (!Array.isArray(projectSkillDefaults) || !projectSkillDefaults.every(item =>
    typeof item === 'string' && item.startsWith(TASK_SKILL_DEFAULT_PREFIX) && !/[\r\n]/u.test(item))) throw Error('项目默认执行配置无效，未修改');
  return { globalSkillDefaults, projectSkillDefaults, skillDefaultsProject };
}

export function updateSkillDefaults({ scope, projectId, action, entry, value, ...options } = {}) {
  if (scope === 'global') {
    updateGlobalSkillDefaults({ ...options, action, entry, value });
    return readSkillDefaults(options);
  }
  if (scope !== 'project') throw Error('未知默认技能作用域');
  const current = readSkillDefaults(options);
  if (!current.skillDefaultsProject || current.skillDefaultsProject.projectId !== projectId) throw Error('当前项目已变化，请刷新后重试');
  if (action !== 'add' && action !== 'remove') throw Error('未知默认技能操作');
  const text = action === 'add' ? taskSkillDefaultText(entry) : value;
  if (typeof text !== 'string' || !text.startsWith(TASK_SKILL_DEFAULT_PREFIX)) throw Error('只能修改默认执行项');
  const defaults = current.projectSkillDefaults;
  const index = defaults.indexOf(text);
  if ((action === 'add' && defaults.some(item => item === text || item.includes(`（${entry.name.trim()}）`))) || (action === 'remove' && index < 0)) return current;
  if (action === 'add') defaults.push(text); else defaults.splice(index, 1);
  const file = globalSkillDefaultsPath(options.codexHome);
  const config = readJson(file) || { defaults: [] };
  writeJsonAtomic(file, { ...config, updatedAt: new Date().toISOString(), projects: {
    ...config.projects, [projectId]: { ...config.projects?.[projectId], defaults }
  } });
  return readSkillDefaults(options);
}
