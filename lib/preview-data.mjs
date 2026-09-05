import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { extractPreviewTags } from "./card-view.mjs";
import { parseRateLimitLines, parseRateLimitSnapshot } from "./usage-data.mjs";
import { resolveTaskReferences } from "./task-references.mjs";
import { readTaskContext as readStoredTaskContext } from "./task-context-store.mjs";

const THREAD_ID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const DEFAULT_MAX_TAIL_BYTES = 8 * 1024 * 1024;

function timestampValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && (item.type === "input_text" || item.type === "output_text"))
    .map((item) => item.text || "")
    .filter(Boolean)
    .join("\n");
}

export function cleanPreviewText(value, { user = false } = {}) {
  let text = String(value || "")
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi, " ")
    .replace(/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/gi, " ")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, " ")
    .replace(/<(automationid|decision|heartbeat)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(?:automationid|decision|heartbeat)\b[^>]*>/gi, " ")
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, " ")
    .replace(/```[\s\S]*?```/g, " [代码] ");

  if (user) {
    const requestMarker = text.match(/(?:^|\n)##?\s*My request:\s*\n?/i);
    if (requestMarker?.index != null) {
      text = text.slice(requestMarker.index + requestMarker[0].length);
    }
    text = text.replace(/(?:^|\n)#\s*Files mentioned by the user:[\s\S]*?(?=\n#|$)/gi, " ");
  }

  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[图片]")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateText(value, maxLength = 360) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function coreSummary(value, fallback = "暂无可用总结") {
  const text = cleanPreviewText(value);
  if (!text) return fallback;
  const sentence = text.match(/^.{12,90}?[。！？!?]/)?.[0] || text;
  return truncateText(sentence, 96);
}

function eventCandidate(entry) {
  const time = timestampValue(entry.timestamp);
  if (entry.type === "event_msg") {
    if (entry.payload?.type === "user_message") {
      return { kind: "user", time, text: entry.payload.message || "" };
    }
    if (entry.payload?.type === "agent_message") {
      return { kind: "assistant", time, text: entry.payload.message || "" };
    }
    if (entry.payload?.type === "task_complete") {
      return { kind: "complete", time, text: entry.payload.last_agent_message || "" };
    }
  }
  if (entry.type === "response_item" && entry.payload?.type === "message") {
    const text = contentText(entry.payload.content);
    if (entry.payload.role === "user") return { kind: "user-fallback", time, text };
    if (entry.payload.role === "assistant") return { kind: "assistant-fallback", time, text };
  }
  return null;
}

export function parsePreviewLines(lines, { title = "" } = {}) {
  const latest = new Map();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line || (!line.includes('"event_msg"') && !line.includes('"response_item"'))) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const candidate = eventCandidate(entry);
    if (!candidate || !candidate.text) continue;
    if (!latest.has(candidate.kind)) latest.set(candidate.kind, candidate);
    if (latest.has("user") && latest.has("assistant") && latest.has("complete")) break;
  }

  const user = latest.get("user") || latest.get("user-fallback");
  const assistant = latest.get("assistant") || latest.get("assistant-fallback");
  const complete = latest.get("complete");
  const summarySource = complete && (!user || complete.time >= user.time)
    ? complete.text
    : assistant?.text || user?.text || title;

  return {
    summary: coreSummary(summarySource, title ? `围绕“${title}”的对话` : "暂无可用总结"),
    recentInput: truncateText(cleanPreviewText(user?.text, { user: true }), 520),
    recentOutput: truncateText(cleanPreviewText(assistant?.text || complete?.text), 520),
  };
}

function explicitNextStep(value) {
  return String(value || "")
    .split(/[。！？；\n]+/u)
    .map((part) => cleanPreviewText(part))
    .find((part) => /下一步|接下来|待办|请确认|需要你/u.test(part)) || "";
}

function overviewClause(value) {
  return coreSummary(value, "")
    .replace(/^(?:已经|已)?(?:做好|加好|修好|改好|升级好|处理好|完成)(?:了|啦)?[：:,，\s-]*/u, "")
    .replace(/[。！？!?；;]+$/u, "")
    .trim();
}

function overviewSummary(title, completedMessages, currentRequest, running) {
  const seen = new Set();
  const completed = completedMessages.slice(-3).map(overviewClause).filter((clause) => {
    const key = clause.replace(/[\s，。！？；、,.!?;:：]/gu, "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const subject = truncateText(title || "当前任务", 48);
  let summary = completed.length
    ? `围绕「${subject}」，目前已完成：${completed.join("；")}。`
    : `这是关于「${subject}」的任务，尚未形成已完成结果。`;
  if (running) summary += ` 当前正在处理：${overviewClause(currentRequest) || "最新要求"}。`;
  return truncateText(summary, 280);
}

export function parseOverviewLines(lines, options = {}) {
  return parseSessionOverview(lines, options).overview;
}

function parseSessionOverview(lines, { threadId = null, title = "", updatedAt = null } = {}) {
  const users = [];
  const fallbackUsers = [];
  const fallbackAssistants = [];
  const turns = new Map();
  let lastTimestamp = null;
  let cwd = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type === "session_meta" && typeof entry.payload?.cwd === "string" && path.isAbsolute(entry.payload.cwd)) {
      cwd = entry.payload.cwd;
    }
    if (timestampValue(entry.timestamp) >= timestampValue(lastTimestamp)) lastTimestamp = entry.timestamp || lastTimestamp;

    if (entry.type === "response_item" && entry.payload?.type === "message") {
      const text = contentText(entry.payload.content);
      if (entry.payload.role === "user" && text) fallbackUsers.push(text);
      if (entry.payload.role === "assistant" && text) fallbackAssistants.push(text);
      continue;
    }
    if (entry.type !== "event_msg") continue;
    const payload = entry.payload || {};
    if (payload.type === "user_message" && payload.message) {
      users.push(payload.message);
    } else if (payload.type === "task_started" && payload.turn_id) {
      const turnId = String(payload.turn_id);
      if (!turns.has(turnId)) turns.set(turnId, { complete: false, text: "" });
    } else if (payload.type === "task_complete") {
      const turnId = String(payload.turn_id || `complete-${turns.size}`);
      const turn = turns.get(turnId) || { complete: false, text: "" };
      turn.complete = true;
      turn.text = payload.last_agent_message || fallbackAssistants.at(-1) || "";
      turns.set(turnId, turn);
    }
  }

  const userMessages = (users.length ? users : fallbackUsers)
    .map((text) => cleanPreviewText(text, { user: true }))
    .filter(Boolean);
  const completedMessages = Array.from(turns.values())
    .filter((turn) => turn.complete && turn.text)
    .map((turn) => cleanPreviewText(turn.text))
    .filter(Boolean);
  const latestTurn = Array.from(turns.values()).at(-1);
  const running = Boolean(latestTurn && !latestTurn.complete);
  const completed = Boolean(latestTurn?.complete);
  const currentRequest = truncateText(userMessages.at(-1) || title || "当前要求", 520);
  const finalAnswer = completedMessages.at(-1)
    || fallbackAssistants.map((text) => cleanPreviewText(text)).filter(Boolean).at(-1)
    || "";
  const progress = completedMessages.length
    ? truncateText(completedMessages.slice(-3).map((text) => coreSummary(text)).join("；"), 520)
    : running ? `正在处理：${truncateText(currentRequest, 240)}` : "尚无已完成进展";
  const nextStep = running
    ? `完成当前要求：${overviewClause(currentRequest) || "最新要求"}`
    : explicitNextStep(finalAnswer) || (completed ? "等待你的下一条要求" : `完成当前要求：${truncateText(currentRequest, 220)}`);

  return { cwd, overview: {
    threadId,
    title: truncateText(title || "当前 Codex 任务", 120),
    goal: truncateText(userMessages[0] || title || "当前要求", 520),
    currentRequest,
    progress,
    summary: overviewSummary(title, completedMessages, currentRequest, running),
    nextStep: truncateText(nextStep, 240),
    status: running ? "进行中" : completed ? "已同步" : "待处理",
    running,
    turnCount: turns.size || userMessages.length,
    updatedAt: lastTimestamp || updatedAt,
  } };
}

function normalizeThreadId(value) {
  return typeof value === "string" ? value.replace(/^(?:local|cloud):/i, "").toLowerCase() : "";
}

async function readTaskContext(cwd, threadId, codexHome) {
  try {
    const value = readStoredTaskContext({ cwd, threadId, codexHome })?.data;
    if (!value) return null;
    return {
      threadId, updatedAt: value.updatedAt, goal: value.goal, progress: value.progress,
      nextStep: value.nextStep, agreements: value.agreements,
      ...resolveTaskReferences(value),
    };
  } catch {
    return null;
  }
}

async function tailLines(filePath, maxBytes = DEFAULT_MAX_TAIL_BYTES) {
  const fileStat = await stat(filePath);
  const length = Math.min(fileStat.size, maxBytes);
  const start = fileStat.size - length;
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return { lines: text.split("\n"), fileStat };
  } finally {
    await handle.close();
  }
}

async function walkSessionFiles(root, result) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walkSessionFiles(entryPath, result);
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;
    const threadId = entry.name.match(THREAD_ID_PATTERN)?.[1]?.toLowerCase();
    if (threadId) result.set(threadId, entryPath);
  }));
}

export class PreviewRepository {
  constructor({
    codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    maxTailBytes = DEFAULT_MAX_TAIL_BYTES,
    usageIndexRefreshIntervalMs = 15_000,
  } = {}) {
    this.codexHome = codexHome;
    this.sessionsRoot = path.join(codexHome, "sessions");
    this.sessionIndexPath = path.join(codexHome, "session_index.jsonl");
    this.globalStatePath = path.join(codexHome, ".codex-global-state.json");
    this.maxTailBytes = maxTailBytes;
    this.usageIndexRefreshIntervalMs = usageIndexRefreshIntervalMs;
    this.filesById = new Map();
    this.idsByTitle = new Map();
    this.metadataById = new Map();
    this.cache = new Map();
    this.overviewCache = new Map();
    this.searchCatalogCache = null;
    this.usageSnapshots = new Map();
    this.lastUsageIndexRefreshMs = 0;
    this.indexed = false;
  }

  async refreshIndex() {
    const files = new Map();
    await walkSessionFiles(this.sessionsRoot, files);
    this.filesById = files;

    const idsByTitle = new Map();
    const metadataById = new Map();
    try {
      const content = await readFile(this.sessionIndexPath, "utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          const id = String(row.id || "").toLowerCase();
          const title = String(row.thread_name || "").trim();
          if (!THREAD_ID_PATTERN.test(id) || !title) continue;
          const existing = idsByTitle.get(title);
          const updatedAt = timestampValue(row.updated_at);
          if (!existing || updatedAt >= existing.updatedAt) {
            idsByTitle.set(title, { id, updatedAt });
          }
          const existingMetadata = metadataById.get(id);
          if (!existingMetadata || updatedAt >= existingMetadata.updatedAtMs) {
            metadataById.set(id, {
              title,
              updatedAtMs: updatedAt,
              updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
            });
          }
        } catch {}
      }
    } catch {}
    this.idsByTitle = idsByTitle;
    this.metadataById = metadataById;
    this.lastUsageIndexRefreshMs = Date.now();
    this.indexed = true;
  }

  async ensureIndex() {
    if (!this.indexed) await this.refreshIndex();
  }

  resolveThreadId(rawId, title = "") {
    const normalized = String(rawId || "").replace(/^(?:local|cloud):/i, "").toLowerCase();
    if (THREAD_ID_PATTERN.test(normalized) && this.filesById.has(normalized)) return normalized;
    return this.idsByTitle.get(String(title || "").trim())?.id || null;
  }

  async readPreview(rawId, title = "") {
    await this.ensureIndex();
    let threadId = this.resolveThreadId(rawId, title);
    if (!threadId) {
      await this.refreshIndex();
      threadId = this.resolveThreadId(rawId, title);
    }
    if (!threadId) {
      return {
        threadId: null,
        summary: title ? `围绕“${title}”的对话` : "暂无可用总结",
        recentInput: "",
        recentOutput: "",
        updatedAt: null,
        tags: extractPreviewTags({ title }),
      };
    }

    const filePath = this.filesById.get(threadId);
    if (!filePath) return null;
    const currentStat = await stat(filePath);
    const metadata = this.metadataById.get(threadId);
    const updatedAt = metadata?.updatedAt || new Date(currentStat.mtimeMs).toISOString();
    const cacheKey = `${currentStat.size}:${currentStat.mtimeMs}:${updatedAt}`;
    const cached = this.cache.get(threadId);
    if (cached?.cacheKey === cacheKey && cached.preview) return cached.preview;

    const { lines } = await tailLines(filePath, this.maxTailBytes);
    const preview = { threadId, ...parsePreviewLines(lines, { title }), updatedAt };
    if (!preview.recentInput && cached?.preview?.recentInput) {
      preview.recentInput = cached.preview.recentInput;
    }
    preview.tags = extractPreviewTags({ title, ...preview });
    this.cache.set(threadId, { cacheKey, preview, usage: parseRateLimitLines(lines) });
    return preview;
  }

  async readOverview(rawId, title = "") {
    try {
      await this.ensureIndex();
      let threadId = this.resolveThreadId(rawId, title);
      if (!threadId) {
        await this.refreshIndex();
        threadId = this.resolveThreadId(rawId, title);
      }
      if (!threadId) return null;

      const filePath = this.filesById.get(threadId);
      if (!filePath) return null;
      const fileStat = await stat(filePath);
      const metadata = this.metadataById.get(threadId);
      const updatedAt = metadata?.updatedAt || new Date(fileStat.mtimeMs).toISOString();
      const cacheKey = `${fileStat.size}:${fileStat.mtimeMs}:${updatedAt}:${title}`;
      let cached = this.overviewCache.get(threadId);
      if (cached?.cacheKey !== cacheKey) {
        // ponytail: full-read keeps the overview exact; switch to an offset cache if active rollouts grow enough to make 5s refreshes costly.
        const content = await readFile(filePath, "utf8");
        const parsed = parseSessionOverview(content.split("\n"), { threadId, title, updatedAt });
        cached = { cacheKey, ...parsed };
        this.overviewCache.set(threadId, cached);
      }
      const taskContext = normalizeThreadId(rawId) === threadId ? await readTaskContext(cached.cwd, threadId, this.codexHome) : null;
      return { ...cached.overview, cwd: cached.cwd, taskContext };
    } catch {
      return null;
    }
  }

  async readMany(requests) {
    const unique = requests.slice(0, 200);
    return Promise.all(unique.map(async (request) => ({
      key: String(request.key || ""),
      ...(await this.readPreview(request.id, request.title)),
    })));
  }

  async readSearchCatalog() {
    let indexStat;
    let stateStat;
    try {
      [indexStat, stateStat] = await Promise.all([
        stat(this.sessionIndexPath),
        stat(this.globalStatePath),
      ]);
    } catch {
      return [];
    }
    const cacheKey = `${indexStat.size}:${indexStat.mtimeMs}:${stateStat.size}:${stateStat.mtimeMs}`;
    if (this.searchCatalogCache?.cacheKey === cacheKey) return this.searchCatalogCache.items;

    let indexContent;
    let state;
    try {
      const [rawIndex, rawState] = await Promise.all([
        readFile(this.sessionIndexPath, "utf8"),
        readFile(this.globalStatePath, "utf8"),
      ]);
      indexContent = rawIndex;
      state = JSON.parse(rawState);
    } catch {
      return [];
    }

    const projects = state?.["local-projects"] || {};
    const assignments = state?.["thread-project-assignments"] || {};
    const newestById = new Map();
    for (const line of indexContent.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const threadId = String(row.id || "").toLowerCase();
        const title = String(row.thread_name || "").trim();
        const updatedAtMs = timestampValue(row.updated_at);
        if (!THREAD_ID_PATTERN.test(threadId) || !title) continue;
        const current = newestById.get(threadId);
        if (!current || updatedAtMs >= current.updatedAtMs) {
          newestById.set(threadId, { threadId, title, updatedAtMs });
        }
      } catch {}
    }

    const items = Array.from(newestById.values()).flatMap((thread) => {
      const assignment = assignments[thread.threadId];
      const projectId = String(assignment?.projectId || "");
      const projectName = String(projects[projectId]?.name || "").trim();
      if (!projectId || !projectName) return [];
      return [{
        threadId: thread.threadId,
        title: thread.title,
        updatedAt: thread.updatedAtMs ? new Date(thread.updatedAtMs).toISOString() : null,
        projectId,
        projectName,
      }];
    }).sort((left, right) => timestampValue(right.updatedAt) - timestampValue(left.updatedAt));
    this.searchCatalogCache = { cacheKey, items };
    return items;
  }

  async readUsage() {
    await this.ensureIndex();
    if (Date.now() - this.lastUsageIndexRefreshMs >= this.usageIndexRefreshIntervalMs) {
      await this.refreshIndex();
    }
    const candidates = (await Promise.all(Array.from(this.filesById.entries()).map(async ([threadId, filePath]) => {
      try {
        const fileStat = await stat(filePath);
        return { threadId, filePath, fileStat };
      } catch {
        return null;
      }
    }))).filter(Boolean).sort((left, right) => right.fileStat.mtimeMs - left.fileStat.mtimeMs);

    let latest = null;
    let latestAccountWide = null;
    const scanLimit = Math.min(candidates.length, 64);
    for (let index = 0; index < scanLimit; index += 1) {
      const candidate = candidates[index];
      const cacheKey = `${candidate.fileStat.size}:${candidate.fileStat.mtimeMs}`;
      let cached = this.usageSnapshots.get(candidate.threadId);
      if (cached?.cacheKey !== cacheKey) {
        try {
          const { lines } = await tailLines(candidate.filePath, this.maxTailBytes);
          cached = { cacheKey, snapshot: parseRateLimitSnapshot(lines) };
        } catch {
          cached = { cacheKey, snapshot: null };
        }
        this.usageSnapshots.set(candidate.threadId, cached);
      }
      const snapshot = cached?.snapshot;
      const observedAtMs = snapshot?.observedAtMs || candidate.fileStat.mtimeMs;
      if (snapshot?.usage && (!latest || observedAtMs > latest.observedAtMs)) {
        latest = { observedAtMs, usage: snapshot.usage };
      }
      if (snapshot?.usage?.limitId === "codex"
        && (!latestAccountWide || observedAtMs > latestAccountWide.observedAtMs)) {
        latestAccountWide = { observedAtMs, usage: snapshot.usage };
      }
      const nextMtimeMs = candidates[index + 1]?.fileStat.mtimeMs || 0;
      if (latestAccountWide && nextMtimeMs <= latestAccountWide.observedAtMs) break;
    }

    const retainedIds = new Set(candidates.slice(0, 64).map((candidate) => candidate.threadId));
    for (const threadId of this.usageSnapshots.keys()) {
      if (!retainedIds.has(threadId)) this.usageSnapshots.delete(threadId);
    }
    return latestAccountWide?.usage || latest?.usage || null;
  }
}
