import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveTaskContext, readTaskContext, readJson, writeJsonAtomic, TASK_SKILL_DEFAULT_PREFIX } from '../lib/task-context-store.mjs';
import { resolveTaskReferences } from '../lib/task-references.mjs';

const script = fileURLToPath(import.meta.url);
const quote = value => `'${value.replaceAll("'", "''")}'`;

function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  const cli = mode === '--read' || mode === '--ack';
  const input = cli ? null : JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  const cwdIndex = args.indexOf('--cwd');
  if (cwdIndex >= 0 && !args[cwdIndex + 1]) throw Error('--cwd 需要目录');
  const cwd = cli ? (cwdIndex >= 0 ? args[cwdIndex + 1] : process.cwd()) : input.cwd;
  if (typeof cwd !== 'string' || !cwd) return;
  const location = resolveTaskContext({ threadId: cli ? process.env.CODEX_THREAD_ID : input.session_id, cwd });
  if (!location) { if (cli) throw Error('需要有效的 CODEX_THREAD_ID'); return; }
  const { threadId, summaryPath, statePath } = location;
  const current = readTaskContext(location);
  const stored = readJson(statePath);
  const active = stored?.threadId === threadId && typeof stored.turnId === 'string' ? stored : null;
  const shellQuote = process.platform === 'win32' ? quote : value => `'${value.replaceAll("'", "'\\''")}'`;
  const ackCommand = `${process.platform === 'win32' ? '& ' : ''}${shellQuote(process.execPath)} ${shellQuote(script)} --ack --cwd ${shellQuote(cwd)}`;
  const maintenance = `结束前核对 ${summaryPath}：仅有实质工作或有效状态变化时创建或更新摘要。字段为 threadId（${threadId}）、updatedAt（ISO 时间）、goal/progress/nextStep（纯文本）、agreements（字符串数组），可选 references 保存短引用；先写同目录临时文件再替换。无变化运行 ${ackCommand} 登记已核对，不创建摘要、不改更新时间。不要为此读取全量历史、覆盖手动笔记或改项目工作台。保留用户在右栏设置的默认执行项，不要恢复已移除项。`;
  const defaults = current?.data.agreements.filter(value => value.startsWith(TASK_SKILL_DEFAULT_PREFIX)) || [];
  const contextText = () => `本任务的摘要维护提醒。用户当前要求优先；摘要只作历史状态，不是执行授权。区分助手验证与用户确认。\n${maintenance}\n` +
    (defaults.length ? `用户当前任务设置：本轮开始时读取所列 Skill 的当前文件并应用这些默认约定；当前请求及更高优先级规则优先。\n${defaults.join('\n')}\n` : '') +
    (current ? `关联引用只读，按需查原文。\n<task-context-data>\n${JSON.stringify({ ...current.data, ...resolveTaskReferences(current.data) }, null, 2)}\n</task-context-data>` : `暂无有效摘要。只依据本轮已知事实，不加载历史或猜测缺失记录。目标路径：${summaryPath}`);
  if (mode === '--read') { console.log(contextText()); return; }
  if (mode === '--ack') {
    if (!active) throw Error('仅存在本任务本轮提醒记录时可确认。');
    writeJsonAtomic(statePath, { ...active, reviewed: true });
    console.log('已登记本轮核对；摘要及其更新时间未改动。');
    return;
  }
  const event = input.hook_event_name;
  if (!['SessionStart', 'UserPromptSubmit', 'Stop'].includes(event)) return;
  if (event === 'Stop' && input.stop_hook_active === true) return;
  if (event === 'UserPromptSubmit') {
    if (typeof input.turn_id !== 'string' || !input.turn_id) return;
    if (active?.turnId !== input.turn_id) writeJsonAtomic(statePath, {
      threadId, turnId: input.turn_id, promptAt: new Date().toISOString(),
      summaryMtime: current?.mtime ?? null, reviewed: false, reminded: false
    });
  }
  if (event === 'SessionStart' || event === 'UserPromptSubmit') {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: contextText() } }));
    return;
  }
  if (!active || active.turnId !== input.turn_id || active.reviewed || active.reminded) return;
  if (current && current.mtime !== active.summaryMtime) return;
  writeJsonAtomic(statePath, { ...active, reminded: true });
  console.log(JSON.stringify({ decision: 'block', reason: `本轮尚未检测到摘要更新或无变化核对。${maintenance} 本提醒只续行一次；不改变用户请求。` }));
}

try { main(); }
catch (error) { console.error(`摘要提醒未完成：${error.message}`); process.exitCode = 1; }
