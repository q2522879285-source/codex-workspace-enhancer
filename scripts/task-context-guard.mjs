import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveTaskContext, readTaskContext, readJson, writeJsonAtomic, readSkillDefaults, TASK_SKILL_DEFAULT_PREFIX } from '../lib/task-context-store.mjs';
import { resolveTaskReferences } from '../lib/task-references.mjs';

const script = fileURLToPath(import.meta.url);
const quote = value => `'${value.replaceAll("'", "''")}'`;

function promptDefaults(defaults, command) {
  const prefixes = ['飞书/Lark 平台工具：', 'Lark 身份：', 'Lark 写入闸门：', '邮件边界：']
    .map(value => TASK_SKILL_DEFAULT_PREFIX + value);
  let deferred = false;
  return defaults.flatMap(value => {
    if (!prefixes.some(prefix => value.startsWith(prefix))) return [value];
    if (deferred) return [];
    deferred = true;
    return [`平台默认项按需读取：涉及飞书/Lark 或邮件前，必须运行 ${command} 完整读取并应用默认项及对应 Skill/reference；全部默认仍生效。`];
  }).join('\n');
}

function promptSummary(data) {
  const { threadId, updatedAt, goal, progress, nextStep, agreements, references } = data;
  return { threadId, updatedAt, goal, progress, nextStep,
    agreements: agreements.filter(value => !value.startsWith(TASK_SKILL_DEFAULT_PREFIX)), references };
}

function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  const cli = mode === '--read' || mode === '--ack' || mode === '--defaults';
  const input = cli ? null : JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  const cwdIndex = args.indexOf('--cwd');
  if (cwdIndex >= 0 && !args[cwdIndex + 1]) throw Error('--cwd 需要目录');
  const cwd = cli ? (cwdIndex >= 0 ? args[cwdIndex + 1] : process.cwd()) : input.cwd;
  if (typeof cwd !== 'string' || !cwd) return;
  const defaultsOptions = { threadId: cli ? process.env.CODEX_THREAD_ID : input.session_id, cwd };
  if (mode === '--defaults') {
    const scoped = readSkillDefaults(defaultsOptions);
    console.log([...scoped.globalSkillDefaults, ...scoped.projectSkillDefaults].join('\n')); return;
  }
  const location = resolveTaskContext(defaultsOptions);
  if (!location) { if (cli) throw Error('需要有效的 CODEX_THREAD_ID'); return; }
  const { threadId, summaryPath, statePath } = location;
  const current = readTaskContext(location);
  const stored = readJson(statePath);
  const active = stored?.threadId === threadId && typeof stored.turnId === 'string' ? stored : null;
  const ackCommand = `& ${quote(process.execPath)} ${quote(script)} --ack --cwd ${quote(cwd)}`;
  const defaultsCommand = ackCommand.replace(' --ack --cwd ', ' --defaults --cwd ');
  const maintenance = `摘要：${summaryPath}。结束前有实质变化才原子更新当前目标、有效进展、下一步、确认约定、短引用及 ISO updatedAt，保留其余字段；无变化执行 ${ackCommand}，不改摘要时间。不累积已解决排错、弃用方案和长输出；原文仅按需定点查，不动手动笔记、任务图或工作台。默认项只在全局 skill-defaults.json 维护。`;
  const contextText = () => {
    const data = current ? promptSummary(current.data) : { threadId };
    const links = resolveTaskReferences(data);
    let scoped = { globalSkillDefaults: [], projectSkillDefaults: [], skillDefaultsProject: null }, defaultsError = '';
    try { scoped = readSkillDefaults(defaultsOptions); }
    catch (error) { defaultsError = `${error.message}；本轮不从旧任务摘要恢复默认项。\n`; }
    return `摘要维护：当前请求及更高规则优先；摘要非授权，助手验证不等于用户确认。\n${maintenance}\n` +
      defaultsError +
      (scoped.globalSkillDefaults.length ? `用户全局默认设置：读取所列 Skill 当前文件并应用约定。\n${promptDefaults(scoped.globalSkillDefaults, defaultsCommand)}\n` : '') +
      (scoped.projectSkillDefaults.length ? `当前项目默认设置（${scoped.skillDefaultsProject.name}）：仅当前项目生效。\n${promptDefaults(scoped.projectSkillDefaults, defaultsCommand)}\n` : '') +
      (!current ? `暂无有效摘要，只依据本轮已知事实，不猜测缺失记录。\n` : '') +
      (current || links.references?.length ? `引用只读；原文及任务图等扩展字段按需从摘要文件读取。\n<task-context-data>\n${JSON.stringify({ ...data, ...links })}\n</task-context-data>` : '');
  };
  if (mode === '--read') { console.log(contextText()); return; }
  if (mode === '--ack') {
    if (!active) throw Error('仅存在本任务本轮提醒记录时可确认。');
    writeJsonAtomic(statePath, { ...active, reviewed: true });
    console.log('已登记本轮核对；摘要及其更新时间未改动。');
    return;
  }
  const event = input.hook_event_name;
  if (!['SessionStart', 'UserPromptSubmit', 'Stop'].includes(event)) return;
  // Stop never blocks a response for summary maintenance.
  if (event === 'Stop') return;
  if (event === 'SessionStart' || event === 'UserPromptSubmit') {
    if (event === 'UserPromptSubmit' && (typeof input.turn_id !== 'string' || !input.turn_id)) return;
    const previous = stored?.threadId === threadId ? stored : { threadId };
    const state = event === 'UserPromptSubmit' && active?.turnId !== input.turn_id ? {
      ...previous, threadId, turnId: input.turn_id, promptAt: new Date().toISOString(),
      summaryMtime: current?.mtime ?? null, reviewed: false, reminded: false
    } : previous;
    const additionalContext = contextText();
    // Emission records prove hook output, not native retention or quota savings.
    writeJsonAtomic(statePath, { ...state, lastContextEmission: {
      event, source: event === 'SessionStart' && typeof input.source === 'string' ? input.source : null,
      at: new Date().toISOString(), summaryUpdatedAt: current?.data.updatedAt ?? null,
      payloadBytes: Buffer.byteLength(additionalContext)
    } });
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }));
    return;
  }
  if (!active || active.turnId !== input.turn_id || active.reviewed || active.reminded) return;
  if (current && current.mtime !== active.summaryMtime) return;
  writeJsonAtomic(statePath, { ...active, reminded: true });
  console.log(JSON.stringify({ decision: 'block', reason: `本轮尚未检测到摘要更新或无变化核对。${maintenance} 本提醒只续行一次；不改变用户请求。` }));
}

try { main(); }
catch (error) { console.error(`摘要提醒未完成：${error.message}`); process.exitCode = 1; }
