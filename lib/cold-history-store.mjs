import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdir, open, readFile, rename, rm, stat, statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTaskId, writeJsonAtomic } from './task-context-store.mjs';

const execute = promisify(execFile);
const DAY = 86400000;
const sameStat = (a, b) => a.size === b.size && a.mtimeMs === b.mtimeMs;
const timestamp = value => typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);

async function equalFiles(first, second) {
  const a = await open(first, 'r');
  let b;
  try {
    b = await open(second, 'r');
    if ((await a.stat()).size !== (await b.stat()).size) return false;
    const left = Buffer.alloc(1024 * 1024), right = Buffer.alloc(left.length);
    while (true) {
      const x = await a.read(left), y = await b.read(right);
      if (x.bytesRead !== y.bytesRead || !left.subarray(0, x.bytesRead).equals(right.subarray(0, y.bytesRead))) return false;
      if (!x.bytesRead) return true;
    }
  } finally { await a.close(); await b?.close(); }
}

export class ColdHistoryStore {
  constructor({ codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex'), archiveRoot = path.join(codexHome, 'cold-history'), statePath = path.join(codexHome, 'cold-history-state.json'), pythonPath = 'python', indexScript = fileURLToPath(new URL('../scripts/cold_history.py', import.meta.url)), now = Date.now } = {}) {
    Object.assign(this, { codexHome, archiveRoot, statePath, pythonPath, indexScript, now });
    this.ready = this.load().catch(error => { this.loadError = error; this.state = { enabled: false, tasks: {} }; });
  }
  async load() {
    try { this.state = JSON.parse(await readFile(this.statePath, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = { enabled: false, enabledAt: null, tasks: {} };
      this.persist();
    }
    for (const task of Object.values(this.state.tasks)) if (task.state === 'saving') task.state = 'queued';
  }
  persist() { writeJsonAtomic(this.statePath, this.state); }
  async setEnabled(enabled) {
    await this.ready;
    if (Boolean(enabled) && !this.state.enabled) this.state.enabledAt = new Date(this.now()).toISOString();
    if (this.loadError) throw this.loadError;
    this.state.enabled = Boolean(enabled);
    if (!this.state.enabled) for (const task of Object.values(this.state.tasks)) {
      if (task.state === 'queued' && !task.manual) { task.state = 'idle'; task.message = '自动冷存已关闭，可手动保存'; }
    }
    this.persist();
    return { enabled: this.state.enabled, enabledAt: this.state.enabledAt };
  }
  async getStatus(threadId) {
    await this.ready;
    const id = normalizeTaskId(threadId), task = this.state.tasks[id];
    return { threadId: id || threadId, enabled: this.state.enabled, manual: Boolean(task?.manual), state: this.loadError || !id ? 'unavailable' : task?.state || 'idle', message: this.loadError?.message || (id ? task?.message || (this.state.enabled ? '已启用，将归档启用后有新活动的任务' : '自动冷存已关闭，可手动保存') : '无效任务 ID'), archiveFolder: task?.archiveFolder || (task?.latest?.archivePath ? path.dirname(task.latest.archivePath) : null), lastArchive: task?.latest || null };
  }
  async request(threadId) {
    await this.ready;
    const id = normalizeTaskId(threadId);
    if (this.loadError) throw this.loadError;
    if (!id) throw Error('无效任务 ID');
    const archiveFolder = path.join(this.archiveRoot, id);
    await mkdir(archiveFolder, { recursive: true });
    const task = this.state.tasks[id] ||= {};
    task.archiveFolder = archiveFolder;
    task.manual = true;
    if (task.state !== 'saving') task.state = 'queued';
    task.message = '等待任务结束和文件稳定'; this.persist();
    return this.getStatus(id);
  }
  metadata() {
    const db = new DatabaseSync(path.join(this.codexHome, 'state_5.sqlite'), { readOnly: true });
    try {
      const columns = db.prepare('PRAGMA table_info(threads)').all().map(row => row.name);
      const parent = ['parent_thread_id', 'agent_path'].filter(name => columns.includes(name)).map(name => `, ${name}`).join('');
      return db.prepare(`SELECT id, rollout_path, updated_at, source${parent} FROM threads`).all();
    } finally { db.close(); }
  }
  projection(id) {
    let db;
    try {
      db = new DatabaseSync(path.join(this.codexHome, 'thread_history_1.sqlite'), { readOnly: true });
      return db.prepare('SELECT status FROM thread_turns WHERE thread_id = ? ORDER BY rollout_ordinal DESC LIMIT 1').get(id)?.status || null;
    } catch { return null; } finally { db?.close(); }
  }
  async settled(row, seconds) {
    const info = await stat(row.rollout_path);
    if (!info.size || this.now() - info.mtimeMs < seconds * 1000) return null;
    const status = this.projection(row.id);
    if (status && !['completed', 'interrupted', 'failed'].includes(status)) return null;
    const file = await open(row.rollout_path, 'r');
    try {
      const size = Math.min(info.size, 256 * 1024), buffer = Buffer.alloc(size);
      await file.read(buffer, 0, size, info.size - size);
      if (buffer[size - 1] !== 10) return null;
      {
        let event;
        for (const line of buffer.toString('utf8').split('\n')) {
          try { const obj = JSON.parse(line); if (obj.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(obj.payload?.type)) event = obj.payload.type; } catch {}
        }
        if (!['task_complete', 'turn_aborted'].includes(event)) return null;
      }
    } finally { await file.close(); }
    return info;
  }
  async tick() {
    await this.ready;
    if (this.loadError) return;
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  async run() {
    let rows;
    try { rows = this.metadata(); }
    catch (error) {
      for (const task of Object.values(this.state.tasks)) if (task.manual) { task.state = 'unavailable'; task.message = error.message; }
      this.persist(); return;
    }
    const byId = new Map(rows.map(row => [row.id, row]));
    for (const [id, task] of Object.entries(this.state.tasks)) if (task.manual && !byId.has(id)) { task.state = 'unavailable'; task.message = '本机任务记录不可用'; }
    for (const row of rows) {
      if (!normalizeTaskId(row.id) || row.parent_thread_id || String(row.source).includes('subagent') || (row.agent_path && row.agent_path !== '/root')) {
        if (this.state.tasks[row.id]?.manual) { this.state.tasks[row.id].state = 'unavailable'; this.state.tasks[row.id].message = '仅支持主任务冷存'; this.state.tasks[row.id].manual = false; }
        continue;
      }
      const task = this.state.tasks[row.id] || {};
      if (!task.manual && (!this.state.enabled || (task.latest && this.now() - Date.parse(task.latest.createdAt) < DAY))) continue;
      try {
        const info = await stat(row.rollout_path);
        const activeAt = Math.max(timestamp(row.updated_at) || 0, info.mtimeMs);
        if (!task.manual && (!this.state.enabled || activeAt <= Date.parse(this.state.enabledAt) || (task.latest && this.now() - Date.parse(task.latest.createdAt) < DAY))) continue;
        if (!task.manual && task.checked && sameStat(info, task.checked)) continue;
        this.state.tasks[row.id] = task;
        const before = await this.settled(row, task.manual ? 10 : 300);
        if (!before) { task.state = 'queued'; task.message = '等待任务结束和文件稳定'; continue; }
        if (task.latest && await equalFiles(row.rollout_path, path.join(task.latest.archivePath, 'original.jsonl'))) {
          const unchanged = await this.settled(row, task.manual ? 10 : 300);
          if (!unchanged || !sameStat(before, unchanged)) continue;
          task.state = 'saved'; task.manual = false; task.checked = { size: before.size, mtimeMs: before.mtimeMs }; task.message = '原文未变化，已保留现有快照'; continue;
        }
        task.state = 'saving'; task.message = '正在保存原文与索引'; this.persist();
        await this.save(row, task, before);
      } catch (error) {
        this.state.tasks[row.id] = task;
        task.state = error.code === 'COLD_SOURCE_CHANGED' ? 'queued' : 'error';
        task.message = error.message;
        if (error.code !== 'COLD_SOURCE_CHANGED') task.manual = false;
      }
    }
    this.persist();
  }
  async save(row, task, before) {
    await mkdir(this.archiveRoot, { recursive: true });
    const space = await statfs(this.archiveRoot);
    if (space.bavail * space.bsize < before.size * 3 + 64 * 1024 * 1024) throw Error('冷存磁盘空间不足');
    const parent = path.join(this.archiveRoot, row.id);
    await mkdir(parent, { recursive: true });
    const name = `${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const partial = path.join(parent, `${name}.partial`), destination = path.join(parent, name);
    await mkdir(partial);
    try {
      const copy = path.join(partial, 'original.jsonl');
      await copyFile(row.rollout_path, copy);
      if (!await equalFiles(row.rollout_path, copy) || !sameStat(before, await stat(row.rollout_path))) throw Object.assign(Error('原文保存期间发生变化，等待下一次冷存'), { code: 'COLD_SOURCE_CHANGED' });
      const { stdout } = await execute(this.pythonPath, ['-X', 'utf8', this.indexScript, '--archive', partial, 'index'], { windowsHide: true, timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 });
      const indexed = JSON.parse(stdout);
      const after = await this.settled(row, task.manual ? 10 : 300);
      if (!after || !sameStat(before, after)) throw Object.assign(Error('索引期间任务或原文发生变化，等待下一次冷存'), { code: 'COLD_SOURCE_CHANGED' });
      const latest = { archivePath: destination, createdAt: new Date(this.now()).toISOString(), bytes: indexed.bytes, records: indexed.records, messages: indexed.messages };
      writeJsonAtomic(path.join(partial, 'manifest.json'), { schemaVersion: 1, threadId: row.id, sourcePath: row.rollout_path, sourceModifiedAt: new Date(before.mtimeMs).toISOString(), ...latest });
      await rename(partial, destination);
      task.latest = latest; task.archiveFolder = parent; task.manual = false; task.state = 'saved'; task.message = '原文与索引已保存'; task.checked = { size: before.size, mtimeMs: before.mtimeMs };
      this.persist();
    } catch (error) { await rm(partial, { recursive: true, force: true }); throw error; }
  }
}
