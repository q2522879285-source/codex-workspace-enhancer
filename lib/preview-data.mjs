import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { extractPreviewTags } from "./card-view.mjs";
import { parseRateLimitLines, parseRateLimitSnapshot } from "./usage-data.mjs";

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
    codexHome = path.join(os.homedir(), ".codex"),
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
      const nextMtimeMs = candidates[index + 1]?.fileStat.mtimeMs || 0;
      if (latest && nextMtimeMs <= latest.observedAtMs) break;
    }

    const retainedIds = new Set(candidates.slice(0, 64).map((candidate) => candidate.threadId));
    for (const threadId of this.usageSnapshots.keys()) {
      if (!retainedIds.has(threadId)) this.usageSnapshots.delete(threadId);
    }
    return latest?.usage || null;
  }
}
