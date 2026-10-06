import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { PreviewRepository } from "../lib/preview-data.mjs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";

const home = mkdtempSync(path.join(tmpdir(), "codex-catalog-"));
try {
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec("CREATE TABLE threads (id TEXT, title TEXT, cwd TEXT, updated_at INTEGER, archived INTEGER, first_user_message TEXT, name TEXT, thread_source TEXT)");
  const insert = db.prepare("INSERT INTO threads (id, title, cwd, updated_at, archived, first_user_message) VALUES (?, ?, ?, ?, ?, ?)");
  for (let i = 0; i < 123; i++) insert.run(`task-${i}`, `Task ${i}`, "C:\\work\\项目甲", i + 1, i < 3 ? 1 : 0, "private prompt");
  db.close();
  const repo = new PreviewRepository({ codexHome: home });
  const page = repo.listThreads();
  assert.equal(page.total, 120);
  assert.equal(page.threads.length, 50);
  assert.equal(page.hasMore, true);
  assert.equal(page.threads[0].id, "task-122");
  assert.equal(page.threads[0].projectName, "项目甲");
  assert.equal(JSON.stringify(page).includes("private prompt"), false);
  assert.equal(repo.listThreads({ offset: 100 }).threads.length, 20);
  assert.equal(repo.listThreads({ offset: 100 }).hasMore, false);
  assert.equal(repo.listThreads({ archived: true }).total, 123);
  assert.equal(repo.listThreads({ query: "tAsK 122" }).total, 1);
  assert.equal(repo.listThreads({ query: "项目甲" }).total, 120);
  assert.equal(repo.listThreads({ query: "%" }).total, 0);
  assert.equal(repo.listThreads({ offset: 999 }).hasMore, false);
  assert.throws(() => repo.listThreads({ limit: 201 }), /Invalid/);
  assert.throws(() => new PreviewRepository({ codexHome: path.join(home, "missing") }).listThreads());
  const update = new DatabaseSync(path.join(home, "state_5.sqlite"));
  update.prepare("UPDATE threads SET title = '' WHERE id = ?").run("task-122");
  update.exec("INSERT INTO threads (id, title, name, cwd, updated_at, archived, thread_source) VALUES ('internal', 'Internal', '', '', 999, 0, 'subagent'), ('internal-archived', 'Internal archive', '', '', 999, 1, 'subagent')");
  update.close();
  const unnamed = repo.listThreads().threads[0];
  assert.equal(unnamed.title, "未命名任务");
  assert.ok(repo.listThreads({ query: unnamed.title }).threads.some(thread => thread.id === unnamed.id));
  assert.equal(repo.listThreads().total, 120);
  assert.equal(repo.listThreads({ archived: true }).total, 123);
  assert.equal(repo.listThreads({ query: "Internal", archived: true }).total, 0);
  const rename = new DatabaseSync(path.join(home, "state_5.sqlite"));
  rename.exec("UPDATE threads SET name = 'Visible name', title = 'Stale title', thread_source = 'agent_created_thread' WHERE id = 'task-122'");
  rename.close();
  assert.equal(repo.listThreads().threads[0].title, "Visible name");
  assert.equal(repo.listThreads({ query: "Visible name" }).threads[0].id, "task-122");
  assert.equal(repo.listThreads({ query: "Stale title" }).total, 0);
  console.log("task catalog: pagination, search, archive, metadata-only and failure checks passed");
} finally { rmSync(home, { recursive: true, force: true }); }

const injector = readFileSync(new URL("../scripts/injector.mjs", import.meta.url), "utf8");
const handler = injector.slice(injector.indexOf("async function handleTaskCatalogBinding("), injector.indexOf("async function handleDefaultSkillsBinding("));
let delivered;
const scope = vm.createContext({ repository: { listThreads: options => ({ threads: [], total: options.query === "empty" ? 0 : 1, hasMore: false }) },
  client: { evaluate: async expression => { delivered = expression; } } });
vm.runInContext(`${handler}\nthis.handle = handleTaskCatalogBinding;`, scope);
await scope.handle(JSON.stringify({ requestId: "first", options: { query: "empty" } }));
assert.match(delivered, /"total":0/);
scope.repository.listThreads = () => { throw new Error("unavailable"); };
await scope.handle(JSON.stringify({ requestId: "second", options: {} }));
assert.match(delivered, /"error":/);
assert.doesNotMatch(delivered, /"total":0/);
console.log("task catalog host: empty result and read failure remain distinct");

test("usage stats stay bounded while covering every indexed session", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "codex-usage-bounded-"));
  const originalStat = fsPromises.stat;
  let active = 0, peak = 0;
  const visited = new Set();
  try {
    const repo = new PreviewRepository({ codexHome: home });
    await repo.ensureIndex();
    for (let i = 0; i < 81; i++) {
      const file = path.join(home, `${i}.jsonl`);
      if (i !== 40) await fsPromises.writeFile(file, JSON.stringify({ timestamp: "2026-09-14T00:00:00Z", type: "event_msg", payload: { type: "token_count", rate_limits: { limit_id: "codex", primary: { used_percent: i === 80 ? 37 : 20, window_minutes: 10080 } } } }) + "\n");
      if (i !== 40) await fsPromises.utimes(file, 1789344000 + i, 1789344000 + i);
      repo.filesById.set(String(i), file);
    }
    fsPromises.stat = async (...args) => {
      visited.add(args[0]);
      peak = Math.max(peak, ++active);
      try { return await originalStat(...args); } finally { active--; }
    };
    syncBuiltinESMExports();
    const usage = await repo.readUsage();
    assert.equal(usage.remainingPercent, 63);
    assert.equal(visited.size, 81, "missing files must not stop the remaining scan");
    assert.ok(peak <= 16, `stat concurrency was ${peak}`);
  } finally {
    fsPromises.stat = originalStat;
    syncBuiltinESMExports();
    rmSync(home, { recursive: true, force: true });
  }
});

test("simultaneous refreshes share a scan but later refreshes discover new sessions", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "codex-index-shared-"));
  const originalReaddir = fsPromises.readdir;
  let scans = 0;
  try {
    const repo = new PreviewRepository({ codexHome: home });
    await fsPromises.mkdir(repo.sessionsRoot);
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    fsPromises.readdir = async (...args) => { scans++; return originalReaddir(...args); };
    syncBuiltinESMExports();
    await Promise.all([repo.refreshIndex(), repo.ensureIndex(), repo.refreshIndex()]);
    assert.equal(scans, 1);
    await fsPromises.writeFile(path.join(repo.sessionsRoot, `${id}.jsonl`), "");
    await repo.refreshIndex();
    assert.equal(scans, 2);
    assert.equal(repo.resolveThreadId(id), id);
  } finally {
    fsPromises.readdir = originalReaddir;
    syncBuiltinESMExports();
    rmSync(home, { recursive: true, force: true });
  }
});

test("overview cache retains recent tasks and rebuilds evicted summaries without changing history", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "codex-overview-bounded-"));
  try {
    const repo = new PreviewRepository({ codexHome: home });
    const ids = Array.from({ length: 65 }, (_, i) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, "0")}`);
    await fsPromises.mkdir(repo.sessionsRoot);
    const history = JSON.stringify({ timestamp: "2026-09-14T00:00:00Z", type: "event_msg", payload: { type: "user_message", message: "Keep the original task goal" } }) + "\n";
    for (const id of ids) await fsPromises.writeFile(path.join(repo.sessionsRoot, `${id}.jsonl`), history);
    const first = await repo.readOverview(ids[0], "Task");
    const second = await repo.readOverview(ids[1], "Task");
    for (const id of ids.slice(2, 64)) await repo.readOverview(id, "Task");
    assert.deepEqual(await repo.readOverview(ids[0], "Task"), first);
    await repo.readOverview(ids[64], "Task");
    assert.equal(repo.overviewCache.size, 64);
    assert.ok(repo.overviewCache.has(ids[0]), "cache hits must retain recently used tasks");
    assert.ok(!repo.overviewCache.has(ids[1]), "oldest task is evicted");
    assert.deepEqual(await repo.readOverview(ids[1], "Task"), second);
    assert.equal(await fsPromises.readFile(path.join(repo.sessionsRoot, `${ids[1]}.jsonl`), "utf8"), history);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
