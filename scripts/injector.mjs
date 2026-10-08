#!/usr/bin/env node

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { closeSync, existsSync, openSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

import { CdpClient, connectMainCodex, readTargets, selectMainCodexTarget } from "./cdp-client.mjs";
import { assetBrowserRuntime, ensureAssetBrowserState } from "../lib/install-config.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";
import { ColdHistoryStore } from "../lib/cold-history-store.mjs";
import { normalizeTaskId, updateSkillDefaults } from "../lib/task-context-store.mjs";
import { presentCardPreview } from "../lib/card-view.mjs";
import { presentRateLimit } from "../lib/usage-data.mjs";
import { closeNativeRateLimits, readNativeRateLimits } from "../lib/native-rate-limits.mjs";
import { mergeTiboUsage, readTiboPublicSignal } from "../lib/tibo-public-feed.mjs";
import { needsPreviewAttachment } from "../lib/injector-state.mjs";
import { buildHomeProjectShelf, readTaskboardSnapshot } from "../lib/home-projects.mjs";
import { AccountProfileStore } from "../lib/account-profiles.mjs";
import { TaskMapIndex } from "../lib/cortexdb-task-map.mjs";
import {
  ASSET_CONSOLE_EMBED_ORIGIN,
  assetConsoleEmbedPrefix,
  assetConsoleEmbedUrl,
  assetConsoleLocalRequestHeaders,
  assetConsoleRoute,
  assetConsolePreviewRoute,
  assetConsoleDirectPreviewFrame,
  responseHeadersForCdp,
  transformAssetConsoleBody,
} from "../lib/asset-console-embed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "inject", "conversation-preview.user.js");
const SCRIPT_ID_GLOBAL = "__CODEX_CONVERSATION_PREVIEW_SCRIPT_IDENTIFIER__";
const ASSET_CONSOLE_BINDING = "codexSidebarOpenAssetConsole";
const COLD_HISTORY_BINDING = "codexSidebarColdHistory";
const DEFAULT_SKILLS_BINDING = "codexSidebarDefaultSkills";
const TASK_CATALOG_BINDING = "codexSidebarTaskCatalog";
const TASK_MAP_INDEX_BINDING = "codexSidebarTaskMapIndex";
const ACCOUNT_PROFILES_BINDING = "codexSidebarAccountProfiles";
const REFRESH_THREAD_TOKEN_BINDING = "codexSidebarRefreshThreadToken";
const MOKE_OAUTH_BINDING = "codexSidebarMokeOAuth";
const STARTUP_VIDEO_BINDING = "codexSidebarStartupVideo";
const startupStateDir = process.platform === "win32" && process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "CodexSidebarEnhancer")
  : path.join(root, "work");
const startupSettingsPath = path.join(startupStateDir, "startup-settings.json");
const startupVideoDir = path.join(startupStateDir, "startup-videos");
const startupVideoExtensions = new Set([".mp4", ".m4v", ".wmv", ".avi", ".mov", ".mkv", ".webm"]);
const assetRuntime = assetBrowserRuntime({ installDir: root });
await ensureAssetBrowserState(assetRuntime);
const assetConsoleRoot = assetRuntime.sourceRoot;
const assetConsoleServer = assetRuntime.serverPath;
const assetConsoleApiTokenPath = assetRuntime.tokenPath;
const assetConsoleUrl = "http://127.0.0.1:5177/";
const embeddedAssetConsoleRoot = path.join(root, "asset-console", "public");
const accountProfileStore = new AccountProfileStore();
const taskMapIndex = new TaskMapIndex();
process.once("exit", () => taskMapIndex.close());
const embeddedAssetConsoleFiles = new Map([
  ["/", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { name: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/ui-v3.css", { name: "ui-v3.css", type: "text/css; charset=utf-8" }],
]);

async function embeddedAssetConsoleResponse(route, method, panelKind = "asset", body = null) {
  let pathname;
  try { pathname = new URL(route, assetConsoleUrl).pathname; } catch { return null; }

  if (method !== "GET") return null;
  const files = embeddedAssetConsoleFiles;
  const staticRoot = embeddedAssetConsoleRoot;
  const file = files.get(pathname);
  if (!file) return null;
  const staticBody = await readFile(path.join(staticRoot, file.name));
  return {
    status: 200,
    headers: { "content-type": file.type, "cache-control": "no-store" },
    body: staticBody,
  };
}

function parseArgs(argv) {
  const options = { port: 9231, watch: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") options.watch = true;
    else if (arg === "--port") options.port = Number(argv[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("Invalid port");
  return options;
}

const defaultStartupSettings = () => ({
  enabled: true,
  mode: "random",
  selectedVideo: "",
  customVideos: [],
});

function normalizeStartupSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: source.enabled !== false,
    mode: source.mode === "specific" ? "specific" : "random",
    selectedVideo: typeof source.selectedVideo === "string" ? source.selectedVideo : "",
    customVideos: Array.isArray(source.customVideos)
      ? source.customVideos.filter((item) => item && typeof item === "object" && typeof item.file === "string")
        .map((item) => ({
          id: typeof item.id === "string" && item.id ? item.id : item.file,
          name: typeof item.name === "string" && item.name ? item.name : path.parse(item.file).name,
          file: path.basename(item.file),
        }))
      : [],
  };
}

async function readStartupSettings() {
  try { return normalizeStartupSettings(JSON.parse(await readFile(startupSettingsPath, "utf8"))); }
  catch (error) { if (error.code !== "ENOENT") process.stderr.write(`Startup settings: ${error.message}\n`); return defaultStartupSettings(); }
}

async function writeStartupSettings(value) {
  const settings = normalizeStartupSettings(value);
  await mkdir(startupStateDir, { recursive: true });
  await writeFile(startupSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

async function readStartupVideoConfig() {
  const settings = await readStartupSettings();
  const videos = [];
  const builtinNames = {
    "startup-animation.mp4": "01 · 霓光汇聚",
    "startup-animation-02.mp4": "02 · 心跳脉冲",
    "startup-animation-03.mp4": "03 · 橙白旋转",
  };
  const assetRoot = path.join(root, "assets");
  let names = [];
  try { names = await readdir(assetRoot); } catch {}
  for (const file of names.filter((name) => /^startup-.*\.mp4$/i.test(name))
    .sort((a, b) => (builtinNames[a] || a).localeCompare(builtinNames[b] || b, "zh-CN"))) {
    videos.push({ id: file, name: builtinNames[file] || path.parse(file).name, source: "builtin" });
  }
  for (const item of settings.customVideos) {
    const file = path.basename(item.file);
    if (!startupVideoExtensions.has(path.extname(file).toLowerCase())) continue;
    if (!existsSync(path.join(startupVideoDir, file))) continue;
    videos.push({ id: item.id, name: item.name, source: "custom" });
  }
  return { ...settings, videos };
}

let startupVideoWriteQueue = Promise.resolve();

async function handleStartupVideoBinding(payload) {
  let message;
  try { message = JSON.parse(payload || "{}"); } catch { return; }
  const requestId = typeof message.requestId === "string" ? message.requestId : null;
  if (!["read", "update", "add", "remove"].includes(message.action)) return;
  const target = client;
  const result = { requestId };
  startupVideoWriteQueue = startupVideoWriteQueue.then(async () => {
    try {
      let settings = await readStartupSettings();
      if (message.action === "update") {
        settings = await writeStartupSettings({ ...settings, ...message.settings });
      } else if (message.action === "add") {
        const name = typeof message.name === "string" ? message.name.trim() : "";
        const data = typeof message.data === "string" ? message.data : "";
        if (!name || !data) throw new Error("视频文件为空");
        const extension = path.extname(name).toLowerCase() || ".mp4";
        if (!startupVideoExtensions.has(extension)) throw new Error("只支持常见视频格式");
        const safeBase = (path.basename(name, extension).replace(/[^\w\-\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "") || "startup-video").slice(0, 80);
        const file = `custom-${Date.now()}-${safeBase}${extension}`;
        await mkdir(startupVideoDir, { recursive: true });
        await writeFile(path.join(startupVideoDir, file), Buffer.from(data, "base64"));
        const item = { id: file, name: path.basename(name, extension), file };
        settings = await writeStartupSettings({ ...settings, customVideos: [...settings.customVideos, item] });
      } else if (message.action === "remove") {
        const id = typeof message.id === "string" ? message.id : "";
        const item = settings.customVideos.find((candidate) => candidate.id === id);
        if (item) {
          settings = await writeStartupSettings({ ...settings, customVideos: settings.customVideos.filter((candidate) => candidate.id !== id) });
          try { await unlink(path.join(startupVideoDir, path.basename(item.file))); } catch {}
        }
      }
      result.data = await readStartupVideoConfig();
    } catch (error) { result.error = error.message || "启动视频设置保存失败"; }
    if (client === target) await target.evaluate(`window.__codexConversationPreviewInjection__?.setStartupVideoConfig?.(${JSON.stringify(result)})`).catch(() => {});
  }).catch(() => {});
  await startupVideoWriteQueue;
}

async function targetId(port) {
  try {
    return selectMainCodexTarget(await readTargets(port))?.id || null;
  } catch {
    return null;
  }
}

async function waitForCodexHomeStable(cdp, {
  timeoutMs = 20_000,
  stableMs = 1_200,
  pollMs = 150,
} = {}) {
  const signatureExpression = `(() => {
    const visible = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (rect.width < 1 || rect.height < 1 || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return null;
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    if (document.readyState !== "complete") return null;
    const main = [...document.querySelectorAll("main")].map(visible).find(Boolean);
    const nav = visible(document.querySelector('nav[aria-label="首页"]'));
    const textbox = visible(document.querySelector('[role="textbox"][aria-label="随心输入"]'));
    const newChat = visible(document.querySelector('button[aria-label="打开新对话"], button[aria-label="新对话"]'));
    if (!main || !nav || !textbox || !newChat) return null;
    return JSON.stringify({
      main,
      nav,
      textbox,
      newChat,
    });
  })()`;
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  let unchangedSince = 0;
  while (Date.now() < deadline) {
    const signature = await cdp.evaluate(signatureExpression).catch(() => null);
    if (signature && signature === previous && Date.now() - unchangedSince >= stableMs) return true;
    if (signature !== previous) {
      previous = signature;
      unchangedSince = signature ? Date.now() : 0;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

const options = parseArgs(process.argv.slice(2));
const repository = new PreviewRepository();
let enhancerConfig = { skills: {} };
try { enhancerConfig = JSON.parse(await readFile(path.join(root, "enhancer.config.json"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const coldHistory = new ColdHistoryStore({
  codexHome: repository.codexHome,
  archiveRoot: enhancerConfig.coldHistory?.archiveRoot,
  indexScript: path.join(root, "scripts", "cold_history.py"),
});
let lastColdHistoryTick = 0;
let coldHistoryTick = null;
let removeColdHistoryListener = null;
let lastNativeSidebarRefreshAt = 0;

function tickColdHistory() {
  if (coldHistoryTick || Date.now() - lastColdHistoryTick < 60_000) return;
  lastColdHistoryTick = Date.now();
  coldHistoryTick = coldHistory.tick().catch(error => {
    process.stderr.write(`Cold history: ${error.message}\n`);
  }).finally(() => { coldHistoryTick = null; });
}

async function handleTaskCatalogBinding(payload) {
  let message;
  try { message = JSON.parse(payload); } catch { return; }
  if (typeof message?.requestId !== "string" || message.requestId.length > 100) return;
  const target = client;
  const result = { requestId: message.requestId };
  try { result.data = repository.listThreads(message.options); }
  catch { result.error = "本机任务目录读取失败，请重试。"; }
  if (client === target) await target.evaluate(`window.__codexConversationPreviewInjection__?.setTaskCatalog?.(${JSON.stringify(result)})`);
}

async function handleTaskMapIndexBinding(payload) {
  let message;
  try { message = JSON.parse(payload); } catch { return; }
  if (typeof message?.requestId !== "string" || message.requestId.length > 100) return;
  if (!["sync", "search", "graph"].includes(message.action)) return;
  const target = client;
  const result = { requestId: message.requestId };
  try {
    result.data = message.action === "sync"
      ? await taskMapIndex.sync(message.data)
      : message.action === "graph"
        ? await taskMapIndex.graph()
        : await taskMapIndex.search(message.options);
  } catch (error) { result.error = `CortexDB：${error.message || "检索索引暂不可用"}`; }
  if (client === target) await target.evaluate(`window.__codexConversationPreviewInjection__?.setTaskCatalog?.(${JSON.stringify(result)})`);
}

async function handleAccountProfilesBinding(payload) {
  let message;
  try { message = JSON.parse(payload); } catch { return; }
  if (!['list', 'sync', 'upsert', 'switch'].includes(message?.action)) return;
  const result = { requestId: typeof message.requestId === 'string' ? message.requestId : null };
  try {
    if (message.action === 'list' || message.action === 'sync') result.data = accountProfileStore.list();
    else if (message.action === 'upsert') result.data = { profile: accountProfileStore.upsert(message.profile) };
    else {
      const profile = accountProfileStore.profile(message.id);
      if (!profile) throw Error('账号 profile 不存在');
      const accountId = await client.evaluate(`(async () => {
        const tokens = ${JSON.stringify(profile.tokens)};
        const expectedEmail = ${JSON.stringify(profile.email || null)};
        const expectedPlan = ${JSON.stringify(profile.planType || profile.plan_type || null)};
        const planType = ${JSON.stringify(profile.planType || profile.plan_type || null)};
        const bridge = window.electronBridge?.sendMessageFromView;
        if (typeof bridge !== "function") throw new Error("MCP bridge unavailable");
        const call = (method, params) => new Promise((resolve, reject) => {
          const id = crypto.randomUUID();
          let timer;
          const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", onMessage); };
          const onMessage = (event) => {
            const message = event.data;
            if (message?.type !== "mcp-response" || message.hostId !== "local" || message.message?.id !== id) return;
            cleanup();
            const response = message.message;
            if (response.error) reject(new Error(response.error.message || String(response.error)));
            else resolve(response.result);
          };
          window.addEventListener("message", onMessage);
          timer = setTimeout(() => { cleanup(); reject(new Error("MCP request timed out: " + method)); }, 15000);
          Promise.resolve(bridge({ type: "mcp-request", hostId: "local", request: { id, method, params }, source: "account-switch" })).catch((error) => { cleanup(); reject(error); });
        });
        await call("account/login/start", { type: "chatgptAuthTokens", accessToken: tokens.access_token, chatgptAccountId: tokens.account_id, chatgptPlanType: planType });
        const account = await call("account/read", {});
        const current = account?.account || account;
        if (current?.type !== "chatgpt") throw new Error("账号切换校验失败");
        if (expectedEmail && current.email && current.email !== expectedEmail) throw new Error("账号切换校验失败");
        if (expectedPlan && current.planType && current.planType !== expectedPlan) throw new Error("账号切换校验失败");
        return true;
      })()`);
      if (accountId !== true) throw Error('账号切换校验失败');
      result.data = { profile: accountProfileStore.persist(profile) };
    }
  } catch (error) { result.error = error.message; }
  // The store deliberately strips tokens before returning data to the renderer.
  await client?.evaluate(`window.__codexConversationPreviewInjection__?.setAccountProfiles?.(${JSON.stringify(result)})`);
}

async function handleRefreshThreadTokenBinding(payload) {
  let message;
  try { message = JSON.parse(payload); } catch { return; }
  const threadId = normalizeTaskId(message?.threadId);
  if (!threadId) return;
  const target = client;
  const active = await target.evaluate("window.__codexConversationPreviewInjection__?.getColdHistoryThreadId?.() || ''").catch(() => '');
  if (active !== threadId) return;
  const overview = await repository.readOverview(threadId).catch(() => null);
  if (client !== target) return;
  const current = await target.evaluate("window.__codexConversationPreviewInjection__?.getColdHistoryThreadId?.() || ''").catch(() => '');
  if (current !== threadId) return;
  if (overview) await target.evaluate(`window.__codexConversationPreviewInjection__?.setThreadOverview?.(${JSON.stringify(overview)})`);
}

async function handleDefaultSkillsBinding(payload) {
  let message;
  try { message = JSON.parse(payload); } catch { return; }
  const threadId = normalizeTaskId(message?.threadId);
  if (!threadId || typeof message.requestId !== 'string' || !['add', 'remove'].includes(message.action)) return;
  const target = client;
  const result = { threadId, requestId: message.requestId, scope: message.scope || 'global' };
  try {
    const active = await target.evaluate("window.__codexConversationPreviewInjection__?.getDefaultSkillsTask?.() || null");
    if (active?.threadId !== threadId) return;
    const entry = message.action === 'add'
      ? active.entries?.find(item => item.path === message.entry?.path && item.name === message.entry?.name && item.enabled !== false)
      : null;
    if (message.action === 'add' && !entry) throw Error('技能目录已变化，请刷新后选择。');
    const overview = await repository.readOverview(threadId);
    const current = await target.evaluate("window.__codexConversationPreviewInjection__?.getDefaultSkillsTask?.() || null");
    if (client !== target || current?.threadId !== threadId) return;
    Object.assign(result, updateSkillDefaults({ codexHome: repository.codexHome, threadId, cwd: overview?.cwd,
      scope: result.scope, projectId: message.projectId, action: message.action, entry, value: message.value }));
  } catch (error) { result.error = error.message; }
  await target.evaluate(`window.__codexConversationPreviewInjection__?.setSkillDefaults?.(${JSON.stringify(result)})`);
}

async function handleColdHistoryBinding(payload) {
  let message;
  try { message = JSON.parse(payload); } catch { return; }
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(message?.threadId || "")) return;
  if (!['archive', 'toggle'].includes(message.action)) return;
  // Only the selected task's native renderer controls can request a snapshot.
  const activeId = await client.evaluate("window.__codexConversationPreviewInjection__?.getColdHistoryThreadId?.() || ''");
  if (activeId !== message.threadId) return;
  let status;
  try {
    if (message.action === 'toggle') {
      if (typeof message.enabled !== 'boolean') return;
      await coldHistory.setEnabled(message.enabled);
    } else {
      await coldHistory.request(message.threadId);
      lastColdHistoryTick = 0;
      tickColdHistory();
    }
    status = await coldHistory.getStatus(message.threadId);
  } catch (error) {
    status = { threadId: message.threadId, state: 'error', message: error.message };
  }
  await client?.evaluate(`window.__codexConversationPreviewInjection__?.setColdHistory?.(${JSON.stringify(status)})`);
}

let stopped = false;
let attachedTargetId = null;
let client = null;
let registeredScriptIdentifier = null;
let removeBindingListener = null;
let removeMokeOAuthListener = null;
let mokeOAuthProcess = null;
let assetConsoleProxy = null;
let assetConsoleProxyQueue = Promise.resolve();
let assetConsoleStartPromise = null;
let assetConsoleRequestGeneration = 0;
let lastExternalAccountSyncAt = 0;
let externalAccountSyncPromise = null;
const syncedExternalAccountTokens = new Set();
const externalAddAccountTargetIds = new Set();
const MAX_BUFFERED_ASSET_CONSOLE_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_ASSET_CONSOLE_MEDIA_RANGE_BYTES = 8 * 1024 * 1024;

function requestAssetConsole({
  method = "GET",
  route = "/",
  headers = {},
  body = null,
  apiToken = "",
  timeoutMs = 15_000,
  maxResponseBytes = MAX_BUFFERED_ASSET_CONSOLE_RESPONSE_BYTES,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let isMediaRoute = false;
    try { isMediaRoute = new URL(route, assetConsoleUrl).pathname === "/media"; } catch {}
    const requestHeaders = assetConsoleLocalRequestHeaders(headers, apiToken, {
      maxOpenRangeBytes: isMediaRoute ? MAX_ASSET_CONSOLE_MEDIA_RANGE_BYTES : 0,
    });
    const request = http.request({
      hostname: "127.0.0.1",
      port: 5177,
      path: route,
      method,
      headers: requestHeaders,
    }, (response) => {
      response.on("error", rejectOnce);
      response.on("aborted", () => rejectOnce(new Error("Asset Console response was aborted")));
      const declaredLength = Number(response.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        response.destroy(new Error(`Asset Console response exceeds ${maxResponseBytes} bytes`));
        return;
      }
      const chunks = [];
      let receivedBytes = 0;
      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxResponseBytes) {
          response.destroy(new Error(`Asset Console response exceeds ${maxResponseBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status: response.statusCode || 502,
          headers: response.headers,
          body: Buffer.concat(chunks, receivedBytes),
        });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Asset Console request timed out")));
    request.on("error", rejectOnce);
    if (body) request.write(body);
    request.end();
  });
}

async function assetConsoleIsReady() {
  const apiToken = (await readFile(assetConsoleApiTokenPath, "utf8")).trim();
  let response;
  try { response = await requestAssetConsole({ route: "/api/config", apiToken, timeoutMs: 500 }); }
  catch (error) {
    if (error.code === "ECONNREFUSED") return false;
    throw new Error(`资产控制台端口 5177 暂不可用：${error.message}`);
  }
  let config;
  try { config = JSON.parse(response.body.toString("utf8")); } catch {}
  if (response.status === 200 && Array.isArray(config?.projects)) return true;
  throw new Error("端口 5177 已被其他服务或不同配置的资产控制台占用；请先关闭该服务后重试。");
}

async function ensureAssetConsoleServer() {
  if (await assetConsoleIsReady()) return;
  if (!assetConsoleRoot || !assetConsoleServer || !existsSync(assetConsoleServer)) {
    throw new Error("没有找到本机资产控制台服务");
  }
  if (!assetConsoleStartPromise) {
    assetConsoleStartPromise = (async () => {
      const stdoutPath = path.join(assetConsoleRoot, "asset-browser.stdout.log");
      const stderrPath = path.join(assetConsoleRoot, "asset-browser.stderr.log");
      let stdoutFd;
      let stderrFd;
      try {
        stdoutFd = openSync(stdoutPath, "a");
        stderrFd = openSync(stderrPath, "a");
        const child = spawn(process.execPath, [assetConsoleServer], {
          cwd: assetConsoleRoot,
          detached: true,
          windowsHide: true,
          stdio: ["ignore", stdoutFd, stderrFd],
          env: {
            ...process.env,
            ...assetRuntime.env,
            NO_PROXY: "localhost,127.0.0.1,::1",
            no_proxy: "localhost,127.0.0.1,::1",
            HTTP_PROXY: "",
            HTTPS_PROXY: "",
            ALL_PROXY: "",
            http_proxy: "",
            https_proxy: "",
            all_proxy: "",
          },
        });
        child.unref();
      } finally {
        if (stdoutFd !== undefined) closeSync(stdoutFd);
        if (stderrFd !== undefined) closeSync(stderrFd);
      }
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (await assetConsoleIsReady()) return;
      }
      throw new Error("资产控制台服务没有在 15 秒内准备完成");
    })().finally(() => { assetConsoleStartPromise = null; });
  }
  await assetConsoleStartPromise;
}

function queueAssetConsoleProxyWork(work) {
  const pending = assetConsoleProxyQueue.then(work, work);
  assetConsoleProxyQueue = pending.catch(() => {});
  return pending;
}

async function failAssetConsoleRequest(proxy, event, sessionId) {
  try {
    await proxy.client.send("Fetch.failRequest", {
      requestId: event.requestId,
      errorReason: "BlockedByClient",
    }, sessionId);
  } catch {}
}

async function activateAssetConsoleSession(proxy, sessionId) {
  const info = proxy.sessionInfo.get(sessionId);
  if (!info || info.active || proxy.cancelled) return;
  info.active = true;
  proxy.assetSessions.add(sessionId);
  try {
    // Once the private frame is identified, intercept every request from it so
    // the embedded app cannot use the synthetic public origin as an egress path.
    await proxy.client.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    }, sessionId);
    await proxy.client.send("Target.setAutoAttach", {
      autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    }, sessionId);
  } catch (error) {
    info.active = false;
    proxy.assetSessions.delete(sessionId);
    throw error;
  }
}

async function proxyAssetConsoleRequest(event, sessionId, proxy) {
  if (proxy.cancelled) return failAssetConsoleRequest(proxy, event, sessionId);
  let url;
  try { url = new URL(event.request.url); } catch {
    return failAssetConsoleRequest(proxy, event, sessionId);
  }
  const isPrivateEmbedRequest = url.origin === ASSET_CONSOLE_EMBED_ORIGIN
    && url.pathname.startsWith(proxy.embedPrefix);
  let previewRoute = null;
  const isPreview = proxy.panelKind === "asset" && proxy.allowedFrameId
    && event.frameId && event.frameId !== proxy.allowedFrameId;
  if (isPreview) {
    try {
      const { frameTree } = await proxy.client.send("Page.getFrameTree", {}, sessionId);
      if (!assetConsoleDirectPreviewFrame(frameTree, event.frameId, proxy.allowedFrameId)) {
        return failAssetConsoleRequest(proxy, event, sessionId);
      }
      const documentUrl = proxy.previewDocuments.get(event.frameId)
        || (event.resourceType === "Document" ? event.request.url : null);
      if (!documentUrl) return failAssetConsoleRequest(proxy, event, sessionId);
      previewRoute = assetConsolePreviewRoute(event.request.url, { method: event.request.method, documentUrl });
      if (!previewRoute) return failAssetConsoleRequest(proxy, event, sessionId);
      proxy.previewDocuments.set(event.frameId, documentUrl);
    } catch { return failAssetConsoleRequest(proxy, event, sessionId); }
  }

  if (isPreview) {
    // Preview documents have a separate read-only scope, never panel API access.
  } else if (!sessionId) {
    if (!isPrivateEmbedRequest || !event.frameId) return failAssetConsoleRequest(proxy, event, sessionId);
    if (proxy.allowedFrameId && proxy.allowedFrameId !== event.frameId) {
      return failAssetConsoleRequest(proxy, event, sessionId);
    }
    proxy.allowedFrameId = event.frameId;
    for (const [candidateSessionId, info] of proxy.sessionInfo) {
      if (info.targetId === proxy.allowedFrameId) {
        try { await activateAssetConsoleSession(proxy, candidateSessionId); } catch {}
      }
    }
  } else {
    const info = proxy.sessionInfo.get(sessionId);
    const frameMatches = Boolean(info && proxy.allowedFrameId
      && info.targetId === proxy.allowedFrameId
      && (!event.frameId || event.frameId === proxy.allowedFrameId));
    if (isPrivateEmbedRequest && !proxy.allowedFrameId && info && event.frameId === info.targetId) {
      proxy.allowedFrameId = event.frameId;
    }
    const confirmedFrame = Boolean(info && proxy.allowedFrameId
      && info.targetId === proxy.allowedFrameId
      && (!event.frameId || event.frameId === proxy.allowedFrameId));
    if (isPrivateEmbedRequest && confirmedFrame) {
      try { await activateAssetConsoleSession(proxy, sessionId); } catch {
        return failAssetConsoleRequest(proxy, event, sessionId);
      }
    } else if (!frameMatches || !proxy.assetSessions.has(sessionId)) {
      // A different sandbox frame may know the public prefix, but it never gets
      // access to localhost without both the per-open nonce and exact frame id.
      return failAssetConsoleRequest(proxy, event, sessionId);
    }
  }

  const assetSession = Boolean(sessionId && proxy.assetSessions.has(sessionId));
  const route = previewRoute || assetConsoleRoute(event.request.url, { token: proxy.token, assetSession });
  if (!route) {
    // The dedicated frame is fail-closed: it may only load its private static
    // files and the two local API namespaces used by Asset Console.
    if (assetSession) proxy.assetSessions.delete(sessionId);
    return failAssetConsoleRequest(proxy, event, sessionId);
  }
  try {
    const response = (!isPreview && await embeddedAssetConsoleResponse(
      route,
      event.request.method,
      proxy.panelKind,
      event.request.postData || null,
    )) || (proxy.panelKind === "asset" ? await requestAssetConsole({
      method: event.request.method,
      route,
      headers: event.request.headers,
      body: event.request.postData || null,
      apiToken: proxy.apiToken,
    }) : null);
    if (!response) throw new Error("Blocked workspace panel route");
    const body = isPreview ? response.body : transformAssetConsoleBody(event.request.url, response.body, { token: proxy.token });
    await proxy.client.send("Fetch.fulfillRequest", {
      requestId: event.requestId,
      responseCode: response.status,
      responseHeaders: responseHeadersForCdp(response.headers, body.length),
      body: body.toString("base64"),
    }, sessionId);
  } catch {
    await failAssetConsoleRequest(proxy, event, sessionId);
  }
}

async function disposeAssetConsoleProxy(proxy) {
  if (!proxy || proxy.disposed) return;
  proxy.cancelled = true;
  proxy.disposed = true;
  if (assetConsoleProxy === proxy) assetConsoleProxy = null;
  proxy.removeAttachedListener?.();
  proxy.removePausedListener?.();
  try { await proxy.client.send("Fetch.disable"); } catch {}
  for (const sessionId of proxy.sessions) {
    try { await proxy.client.send("Fetch.disable", {}, sessionId); } catch {}
    try { await proxy.client.send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }, sessionId); } catch {}
  }
  proxy.sessions.clear();
  proxy.assetSessions.clear();
  proxy.sessionInfo.clear();
  proxy.previewDocuments.clear();
  proxy.allowedFrameId = null;
  proxy.token = null;
  proxy.apiToken = null;
  try {
    await proxy.client.send("Target.setAutoAttach", {
      autoAttach: false,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
  } catch {}
}

async function setupAssetConsoleProxy(generation, panelKind = "asset") {
  return queueAssetConsoleProxyWork(async () => {
    if (generation !== assetConsoleRequestGeneration || stopped || !client) return null;
    if (assetConsoleProxy) await disposeAssetConsoleProxy(assetConsoleProxy);
    if (generation !== assetConsoleRequestGeneration || stopped || !client) return null;

    const token = randomBytes(24).toString("hex");
    const apiToken = panelKind === "asset" && assetConsoleApiTokenPath
      ? (await readFile(assetConsoleApiTokenPath, "utf8")).trim()
      : "";
    if (panelKind === "asset" && !apiToken) throw new Error("资产控制台本机令牌不可用");
    const proxy = {
      client,
      generation,
      token,
      apiToken,
      panelKind,
      embedPrefix: assetConsoleEmbedPrefix(token),
      embedUrl: assetConsoleEmbedUrl(token),
      allowedFrameId: null,
      sessions: new Set(),
      assetSessions: new Set(),
      sessionInfo: new Map(),
      previewDocuments: new Map(),
      cancelled: false,
      disposed: false,
      removeAttachedListener: null,
      removePausedListener: null,
    };
    // Publish the provisional object before the first await. A close request can
    // now cancel it even while CDP is still answering setup commands.
    assetConsoleProxy = proxy;
    proxy.removeAttachedListener = proxy.client.on("Target.attachedToTarget", async (event) => {
      const sessionId = event.sessionId;
      const targetUrl = event.targetInfo?.url || "";
      let isPreviewTarget = false;
      if (sessionId && proxy.panelKind === "asset" && proxy.allowedFrameId && event.targetInfo?.type === "iframe") {
        try {
          const { frameTree } = await proxy.client.send("Page.getFrameTree", {}, sessionId);
          isPreviewTarget = assetConsoleDirectPreviewFrame(frameTree, event.targetInfo.targetId, proxy.allowedFrameId);
        } catch {}
      }
      const isCandidate = Boolean(sessionId
        && event.targetInfo?.type === "iframe"
        && (isPreviewTarget || !targetUrl || targetUrl.startsWith(proxy.embedUrl)));
      if (!isCandidate || proxy.cancelled) {
        if (sessionId) {
          try { await proxy.client.send("Runtime.runIfWaitingForDebugger", {}, sessionId); } catch {}
        }
        return;
      }
      proxy.sessions.add(sessionId);
      proxy.sessionInfo.set(sessionId, { targetId: event.targetInfo.targetId, active: false });
      try {
        await proxy.client.send("Fetch.enable", {
          patterns: [{ urlPattern: isPreviewTarget ? "*" : `${proxy.embedUrl}*`, requestStage: "Request" }],
        }, sessionId);
        if (proxy.allowedFrameId === event.targetInfo.targetId) {
          await activateAssetConsoleSession(proxy, sessionId);
        }
      } catch {}
      try { await proxy.client.send("Runtime.runIfWaitingForDebugger", {}, sessionId); } catch {}
    });
    proxy.removePausedListener = proxy.client.on("Fetch.requestPaused", (event, meta) => {
      proxyAssetConsoleRequest(event, meta.sessionId, proxy).catch(() => {});
    });

    try {
      await proxy.client.send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      });
      if (proxy.cancelled || generation !== assetConsoleRequestGeneration) {
        await disposeAssetConsoleProxy(proxy);
        return null;
      }
      await proxy.client.send("Fetch.enable", {
        patterns: [{ urlPattern: `${proxy.embedUrl}*`, requestStage: "Request" }],
      });
      if (proxy.cancelled || generation !== assetConsoleRequestGeneration) {
        await disposeAssetConsoleProxy(proxy);
        return null;
      }
      return proxy;
    } catch (error) {
      const cancelled = proxy.cancelled || generation !== assetConsoleRequestGeneration;
      await disposeAssetConsoleProxy(proxy);
      if (cancelled) return null;
      throw error;
    }
  });
}

async function teardownAssetConsoleProxy() {
  const proxy = assetConsoleProxy;
  if (proxy) proxy.cancelled = true;
  return queueAssetConsoleProxyWork(async () => {
    if (proxy) await disposeAssetConsoleProxy(proxy);
  });
}

async function handleAssetConsoleBinding(payload) {
  let message = {};
  try { message = JSON.parse(payload || "{}"); } catch {}
  if (message.panel && message.panel !== "asset") return;
  const panelKind = "asset";
  const panelLabel = "资产控制台";
  const generation = ++assetConsoleRequestGeneration;
  if (message.action === "close") {
    await teardownAssetConsoleProxy();
    return;
  }
  try {
    if (panelKind === "asset") await ensureAssetConsoleServer();
    if (generation !== assetConsoleRequestGeneration) return;
    const proxy = await setupAssetConsoleProxy(generation, panelKind);
    if (!proxy) return;
    if (generation !== assetConsoleRequestGeneration) return;
    const embedUrl = new URL(proxy.embedUrl);
    embedUrl.searchParams.set("embed", "codex");
    embedUrl.searchParams.set("panel", panelKind);
    if (typeof message.threadId === "string" && message.threadId.length <= 160) {
      embedUrl.searchParams.set("threadId", message.threadId);
    }
    if (typeof message.threadTitle === "string" && message.threadTitle.length <= 300) {
      embedUrl.searchParams.set("threadTitle", message.threadTitle);
    }
    await client.evaluate(`window.__codexConversationPreviewInjection__?.setAssetConsolePanel?.(${JSON.stringify({
      state: "ready",
      url: embedUrl.href,
      panel: panelKind,
      label: panelLabel,
    })})`);
  } catch (error) {
    if (generation !== assetConsoleRequestGeneration) return;
    await teardownAssetConsoleProxy();
    try {
      await client.evaluate(`window.__codexConversationPreviewInjection__?.setAssetConsolePanel?.(${JSON.stringify({
        state: "error",
        panel: panelKind,
        label: panelLabel,
        message: error?.message || `${panelLabel}加载失败`,
      })})`);
    } catch {}
  }
}

function sendMokeOAuthResult(target, result) {
  if (!target || target !== client) return;
  target.evaluate(`window.__codexConversationPreviewInjection__?.setMokeOAuth?.(${JSON.stringify(result)})`).catch(() => {});
}

function handleMokeOAuthBinding(payload) {
  let message;
  try { message = JSON.parse(payload); } catch { return; }
  if (message?.action !== "start" || typeof message.requestId !== "string") return;
  const target = client;
  if (mokeOAuthProcess) {
    sendMokeOAuthResult(target, { requestId: message.requestId, state: "error", message: "已有 MOKE 授权流程进行中，请完成当前登录后重试。" });
    return;
  }
  const scopes = ["openid", "skill:read", "prompt:read", "offline_access"];
  let buffer = "";
  let authUrlSent = false;
  let settled = false;
  const emit = (result) => sendMokeOAuthResult(target, { requestId: message.requestId, ...result });
  const child = spawn(process.env.CODEX_CLI_BIN || "codex.exe", [
    "mcp", "login", "moke", "--no-browser", "--scopes", scopes.join(","),
  ], {
    windowsHide: true,
    // Keep stdin open so --no-browser waits for the HTTP callback, not EOF.
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  mokeOAuthProcess = child;
  const readOutput = (chunk) => {
    buffer = `${buffer}${String(chunk)}`.slice(-16_384);
    const match = buffer.match(/https:\/\/oss\.mokeaigc\.ai\/oidc\/auth\?[^\s"'<>]+/);
    if (!match || authUrlSent) return;
    const authUrl = match[0].replace(/[),.;]+$/, "");
    try { new URL(authUrl); } catch { return; }
    authUrlSent = true;
    emit({ state: "authorization_required", authUrl });
  };
  child.stdout?.on("data", readOutput);
  child.stderr?.on("data", readOutput);
  child.once("error", (error) => {
    if (settled) return;
    settled = true;
    if (mokeOAuthProcess === child) mokeOAuthProcess = null;
    emit({ state: "error", message: error?.message || "MOKE 授权进程启动失败。" });
  });
  child.once("close", (code, signal) => {
    if (settled) return;
    settled = true;
    if (mokeOAuthProcess === child) mokeOAuthProcess = null;
    if (code === 0) emit({ state: "completed" });
    else emit({ state: "error", message: authUrlSent ? "MOKE 授权未完成，请返回后重试。" : "无法启动 MOKE 授权流程。", code, signal });
  });
}
async function bindAssetConsole({ resetBinding = true } = {}) {
  if (resetBinding) {
    removeBindingListener?.();
    removeBindingListener = null;
    removeColdHistoryListener?.();
    removeColdHistoryListener = null;
    removeMokeOAuthListener?.();
    removeMokeOAuthListener = null;
  }
  const assetAvailable = Boolean(assetConsoleServer && existsSync(assetConsoleServer));
  if (!removeColdHistoryListener) {
    await client.send("Runtime.enable");
    try { await client.send("Runtime.removeBinding", { name: COLD_HISTORY_BINDING }); } catch {}
    await client.send("Runtime.addBinding", { name: COLD_HISTORY_BINDING });
    try { await client.send("Runtime.removeBinding", { name: DEFAULT_SKILLS_BINDING }); } catch {}
    await client.send("Runtime.addBinding", { name: DEFAULT_SKILLS_BINDING });
    try { await client.send("Runtime.removeBinding", { name: TASK_CATALOG_BINDING }); } catch {}
    await client.send("Runtime.addBinding", { name: TASK_CATALOG_BINDING });
    try { await client.send("Runtime.removeBinding", { name: TASK_MAP_INDEX_BINDING }); } catch {}
    await client.send("Runtime.addBinding", { name: TASK_MAP_INDEX_BINDING });
    try { await client.send("Runtime.removeBinding", { name: ACCOUNT_PROFILES_BINDING }); } catch {}
    await client.send("Runtime.addBinding", { name: ACCOUNT_PROFILES_BINDING });
    try { await client.send("Runtime.removeBinding", { name: REFRESH_THREAD_TOKEN_BINDING }); } catch {}
    await client.send("Runtime.addBinding", { name: REFRESH_THREAD_TOKEN_BINDING });
    try { await client.send("Runtime.removeBinding", { name: MOKE_OAUTH_BINDING }); } catch {}
    await client.send("Runtime.addBinding", { name: MOKE_OAUTH_BINDING });
    try { await client.send("Runtime.removeBinding", { name: STARTUP_VIDEO_BINDING }); } catch {}
    await client.send("Runtime.addBinding", { name: STARTUP_VIDEO_BINDING });
    removeColdHistoryListener = client.on("Runtime.bindingCalled", ({ name, payload, executionContextId }) => {
      if (![COLD_HISTORY_BINDING, DEFAULT_SKILLS_BINDING, TASK_CATALOG_BINDING, TASK_MAP_INDEX_BINDING, ACCOUNT_PROFILES_BINDING, REFRESH_THREAD_TOKEN_BINDING, STARTUP_VIDEO_BINDING].includes(name)) return;
      // A binding is visible in subframes too; admit only the native top-level app.
      client.send('Runtime.evaluate', {
        contextId: executionContextId,
        expression: "window === window.top && location.protocol === 'app:'",
        returnByValue: true,
      }).then(result => {
        if (result.result?.value === true) return name === TASK_MAP_INDEX_BINDING ? handleTaskMapIndexBinding(payload) : name === STARTUP_VIDEO_BINDING ? handleStartupVideoBinding(payload) : name === REFRESH_THREAD_TOKEN_BINDING ? handleRefreshThreadTokenBinding(payload) : name === TASK_CATALOG_BINDING ? handleTaskCatalogBinding(payload) : name === DEFAULT_SKILLS_BINDING
          ? handleDefaultSkillsBinding(payload) : name === ACCOUNT_PROFILES_BINDING
            ? handleAccountProfilesBinding(payload) : handleColdHistoryBinding(payload);
      }).catch(() => {});
    });
    removeMokeOAuthListener = client.on("Runtime.bindingCalled", ({ name, payload, executionContextId }) => {
      if (name !== MOKE_OAUTH_BINDING) return;
      client.send("Runtime.evaluate", {
        contextId: executionContextId,
        expression: "window === window.top && location.protocol === 'app:'",
        returnByValue: true,
      }).then(result => {
        if (result.result?.value === true) handleMokeOAuthBinding(payload);
      }).catch(() => {});
    });
  }
  if (assetAvailable && (resetBinding || !removeBindingListener)) {
    await client.send("Runtime.enable");
    try { await client.send("Runtime.removeBinding", { name: ASSET_CONSOLE_BINDING }); } catch {}
    await client.send("Runtime.addBinding", { name: ASSET_CONSOLE_BINDING });
    removeBindingListener = client.on("Runtime.bindingCalled", ({ name, payload }) => {
      if (name === ASSET_CONSOLE_BINDING) handleAssetConsoleBinding(payload).catch(() => {});
    });
  }
  await client.evaluate(`window.__codexConversationPreviewInjection__?.setAssetConsole?.(${JSON.stringify({
    available: assetAvailable,
    assetAvailable,

    label: "资产控制台",
    mode: "embedded",
  })})`);
  await client.evaluate(`window.__codexConversationPreviewInjection__?.setStartupVideoConfig?.(${JSON.stringify({ data: await readStartupVideoConfig() })})`);
}

async function attach() {
  const nextTargetId = await targetId(options.port);
  if (!await needsPreviewAttachment({ client, attachedTargetId, nextTargetId })) return false;

  if (!client || nextTargetId !== attachedTargetId) {
    assetConsoleRequestGeneration += 1;
    await teardownAssetConsoleProxy();
    client?.close();
    client = await connectMainCodex(options.port);
    client.requestTimeoutMs = 30_000;
    removeBindingListener = null;
    removeColdHistoryListener = null;
    removeMokeOAuthListener?.();
    removeMokeOAuthListener = null;
    if (mokeOAuthProcess) {
      try { mokeOAuthProcess.kill(); } catch {}
      mokeOAuthProcess = null;
    }
    registeredScriptIdentifier = null;
  }

  const oldIdentifier = registeredScriptIdentifier
    || await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`);
  if (oldIdentifier) {
    try { await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: oldIdentifier }); } catch {}
  }
  const injectDir = sourcePath.slice(0, Math.max(0, sourcePath.lastIndexOf("\\") + 1) || sourcePath.lastIndexOf("/") + 1);
  const mapSource = await readFile(`${injectDir}global-task-map.js`, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const previewSource = await readFile(sourcePath, "utf8");
  const browserSource = await readFile(`${injectDir}global-browser.js`, "utf8");
  const bundledSource = mapSource === previewSource && browserSource === previewSource
    ? previewSource
    : `${mapSource}\n;\n${browserSource}\n;\n${previewSource}`;
  const userSource = `window.__CODEX_ENHANCER_CONFIG__ = ${JSON.stringify({ ...enhancerConfig, skills: enhancerConfig.skills || {} })};\n${bundledSource}`;
  const sourceHash = createHash("sha256").update(userSource).digest("hex");
  const markedSource = `${userSource}\n;window.__CODEX_CONVERSATION_PREVIEW_SOURCE_HASH__ = ${JSON.stringify(sourceHash)};\n;window.__CODEX_CDP_CSP_BYPASS__ = true;`;
  const registered = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: markedSource });
  registeredScriptIdentifier = registered.identifier;
  // The global browser panel talks to the local CDP proxy from the app renderer.
  // Codex's renderer CSP blocks localhost, so bypass it once for this renderer.
  // Do not reload the renderer here: the launcher is already waiting for the
  // real Codex target, and a forced reload exposes the native splash screen
  // and causes the home page to paint a second time during startup.
  const cdpCspReady = await client.evaluate("window.__CODEX_CDP_CSP_BYPASS__ === true").catch(() => false);
  if (!cdpCspReady) {
    await client.send("Page.setBypassCSP", { enabled: true });
  }
  const sourceAlreadyActive = await client.evaluate(`Boolean(
    window.__codexConversationPreviewInjection__
    && document.getElementById("codex-conversation-preview-style")
    && window.__CODEX_CONVERSATION_PREVIEW_SOURCE_HASH__ === ${JSON.stringify(sourceHash)}
  )`);
  if (!sourceAlreadyActive) await client.evaluate(markedSource);
  await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] = ${JSON.stringify(registered.identifier)}`);
  await bindAssetConsole();
  attachedTargetId = nextTargetId;
  return true;
}

function isExternalAddAccountTarget(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "chatgpt.com" && !parsed.hostname.endsWith(".chatgpt.com")) return false;
    return parsed.pathname === "/auth/login"
      || parsed.searchParams.get("account_switch_login") === "add_account"
      || parsed.searchParams.get("next")?.includes("account_switch_login=add_account") === true;
  } catch {
    return false;
  }
}

function isExternalAuthTarget(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "chatgpt.com"
      || host.endsWith(".chatgpt.com")
      || host === "auth.openai.com"
      || host.endsWith(".auth.openai.com")
      || host === "accounts.google.com"
      || host === "login.microsoftonline.com"
      || host === "appleid.apple.com";
  } catch {
    return false;
  }
}

function isChatGptTarget(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "chatgpt.com" || host.endsWith(".chatgpt.com");
  } catch {
    return false;
  }
}

async function readExternalAccountSession(target) {
  const external = new CdpClient(target.webSocketDebuggerUrl, {
    connectTimeoutMs: 1_000,
    requestTimeoutMs: 5_000,
  });
  try {
    await external.connect();
    return await external.evaluate(`(async () => {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "include",
          headers: {
            "X-OpenAI-Target-Path": "/api/auth/session",
            "X-OpenAI-Target-Route": "/api/auth/session",
          },
        });
        if (!response.ok) return null;
        const payload = await response.json().catch(() => null);
        if (!payload || typeof payload.sessionToken !== "string" || payload.sessionToken.length < 8) return null;
        return {
          sessionToken: payload.sessionToken,
          authProvider: payload.authProvider ?? null,
          user: payload.user && typeof payload.user === "object" ? {
            id: typeof payload.user.id === "string" ? payload.user.id : null,
            email: typeof payload.user.email === "string" ? payload.user.email : null,
            image: typeof payload.user.image === "string" ? payload.user.image : null,
            name: typeof payload.user.name === "string" ? payload.user.name : null,
            phone_number: typeof payload.user.phone_number === "string" ? payload.user.phone_number : null,
          } : null,
        };
      } catch {
        return null;
      }
    })()`);
  } finally {
    external.close();
  }
}

async function syncExternalAddAccount() {
  if (!client || Date.now() - lastExternalAccountSyncAt < 3_000) return;
  if (externalAccountSyncPromise) return externalAccountSyncPromise;
  lastExternalAccountSyncAt = Date.now();
  externalAccountSyncPromise = (async () => {
    let targets;
    try { targets = await readTargets(options.port); } catch { return; }
    for (const target of targets) {
      if (target.type === "page" && target.id && isExternalAddAccountTarget(target.url)) {
        externalAddAccountTargetIds.add(target.id);
      }
      // OAuth can move the login into a popup. Keep newly-created auth tabs
      // attached to the add-account flow until they return to chatgpt.com.
      if (target.type === "page" && target.id && externalAddAccountTargetIds.size > 0
        && isExternalAuthTarget(target.url)) {
        externalAddAccountTargetIds.add(target.id);
      }
    }
    const candidates = targets.filter((target) => target.type === "page"
      && target.webSocketDebuggerUrl
      && isChatGptTarget(target.url)
      && (externalAddAccountTargetIds.has(target.id) || isExternalAddAccountTarget(target.url)));
    for (const target of candidates) {
      const session = await readExternalAccountSession(target).catch(() => null);
      const sessionToken = session?.sessionToken;
      if (!sessionToken || syncedExternalAccountTokens.has(sessionToken) || !client) continue;
      const result = await client.evaluate(`(() => {
        const key = "oai/apps/accountSwitchSessions";
        const session = ${JSON.stringify(session)};
        let saved = [];
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || "[]");
          if (Array.isArray(parsed)) saved = parsed.filter((entry) => entry && typeof entry.sessionToken === "string");
        } catch {}
        const next = {
          authProvider: session.authProvider ?? null,
          email: session.user?.email ?? null,
          lastLoggedInAt: Date.now(),
          name: session.user?.name ?? null,
          phoneNumber: session.user?.phone_number ?? null,
          sessionToken: session.sessionToken,
          userId: session.user?.id ?? null,
          userImageUrl: session.user?.image ?? null,
          workspaces: [],
        };
        const index = saved.findIndex((entry) => entry.sessionToken === next.sessionToken);
        if (index >= 0) saved[index] = { ...saved[index], ...next };
        else saved.push(next);
        localStorage.setItem(key, JSON.stringify(saved));
        return { count: saved.length, added: index < 0 };
      })()`);
      syncedExternalAccountTokens.add(sessionToken);
      externalAddAccountTargetIds.delete(target.id);
      if (result?.added) await client.send("Page.reload", { ignoreCache: false }).catch(() => {});
      break;
    }
  })().finally(() => { externalAccountSyncPromise = null; });
  return externalAccountSyncPromise;
}

async function pushPreviews() {
  if (!client || !attachedTargetId) return;
  if (Date.now() - lastNativeSidebarRefreshAt >= 15_000) {
    lastNativeSidebarRefreshAt = Date.now();
    await client.evaluate("window.__codexConversationPreviewInjection__?.refreshNativeSidebar?.() || false").catch(() => false);
  }
  const [sidebarState, homeProjectState] = await Promise.all([
    client.evaluate(`(() => {
      const seen = new Set();
      const requests = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]')).flatMap((row) => {
        const id = row.getAttribute('data-app-action-sidebar-thread-id') || '';
        const title = row.getAttribute('data-app-action-sidebar-thread-title') || '';
        const key = id + '\\n' + title;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ key, id, title }];
      });
      const selected = document.querySelector('[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-selected="true"]')
        || document.querySelector('[data-app-action-sidebar-thread-id][data-selected="true"]')
        || document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"]')
        || document.querySelector('[data-app-action-sidebar-thread-id][data-active="true"]')
        || document.querySelector('[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active="true"]');
      const routeId = location.pathname.split('/').find((part) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part)) || '';
      // Reuse the renderer's resolver so previews, overview, assets and skills
      // all read the same active conversation during navigation.
      const resolved = window.__codexConversationPreviewInjection__?.getActiveThreadContext?.();
      const id = resolved?.threadId
        || selected?.getAttribute('data-app-action-sidebar-thread-id')
        || routeId;
      const title = resolved?.threadTitle
        || selected?.getAttribute('data-app-action-sidebar-thread-title')
        || Array.from(document.querySelectorAll('[data-testid="app-shell-header-context-menu-surface"] button'))
          .find((button) => button.offsetParent !== null)?.textContent?.trim()
        || '';
      return { requests, activeThread: { id, title } };
    })()`),
    client.evaluate("window.__codexConversationPreviewInjection__?.getHomeProjectsState?.() || null"),
  ]);
  const requests = Array.isArray(sidebarState?.requests) ? sidebarState.requests : [];
  const activeThread = sidebarState?.activeThread || {};
  tickColdHistory();
  const coldHistoryStatus = await coldHistory.getStatus(activeThread.id);
  const [rawPreviews, rawUsage, nativeUsage, taskboard, searchCatalog, overview, tiboSignal] = await Promise.all([
    repository.readMany(requests),
    repository.readUsage(),
    readNativeRateLimits(),
    readTaskboardSnapshot(),
    repository.readSearchCatalog(),
    repository.readOverview(activeThread.id, activeThread.title),
    process.env.CODEX_TIBO_FEED_URL ? readTiboPublicSignal() : Promise.resolve(null),
  ]);
  const previews = rawPreviews.map((preview) => presentCardPreview(preview));
  // Keep the overview's display fields on the same live session snapshot as
  // the sidebar cards. The overview parser can be cached between turns while
  // readPreview() sees the newest assistant event, which otherwise leaves the
  // right rail one turn behind the card/floating preview.
  const activeThreadId = normalizeTaskId(String(activeThread.id || "").replace(/^cloud:/i, ""));
  const activePreview = activeThreadId
    ? rawPreviews.find((preview) => normalizeTaskId(String(preview?.threadId || "").replace(/^cloud:/i, "")) === activeThreadId)
    : null;
  const syncedOverview = overview && activePreview
    ? {
        ...overview,
        ...(activePreview.recentInput ? { currentRequest: activePreview.recentInput } : {}),
        ...(activePreview.recentOutput ? {
          progress: activePreview.recentOutput,
          summary: activePreview.summary || activePreview.recentOutput,
        } : activePreview.summary ? {
          progress: activePreview.summary,
          summary: activePreview.summary,
        } : {}),
        ...(activePreview.updatedAt ? { updatedAt: activePreview.updatedAt } : {}),
      }
    : overview;
  const usage = presentRateLimit(mergeTiboUsage(nativeUsage || rawUsage, tiboSignal), {});
  const homeProjects = taskboard.available
    ? {
        available: true,
        message: "",
        ...buildHomeProjectShelf({
          projects: taskboard.projects,
          tasks: taskboard.tasks,
          state: homeProjectState,
          syncedAt: new Date().toISOString(),
        }),
      }
    : {
        available: false,
        message: taskboard.message,
        cards: [],
        state: homeProjectState,
      };
  await client.evaluate(`(() => {
    const api = window.__codexConversationPreviewInjection__;
    api?.setPreviews?.(${JSON.stringify(previews)});
    api?.setUsage?.(${JSON.stringify(usage)});
    api?.setHomeProjects?.(${JSON.stringify(homeProjects)});
    api?.setSearchCatalog?.(${JSON.stringify(searchCatalog)});
    api?.setThreadOverview?.(${JSON.stringify(syncedOverview)});
    api?.setColdHistory?.(${JSON.stringify(coldHistoryStatus)});
  })()`);
}

async function stop() {
  if (stopped) return;
  stopped = true;
  try { await client?.evaluate("window.__codexConversationPreviewInjection__?.destroy?.()") } catch {}
  assetConsoleRequestGeneration += 1;
  await teardownAssetConsoleProxy();
  removeBindingListener?.();
  removeBindingListener = null;
  removeColdHistoryListener?.();
  removeColdHistoryListener = null;
  removeMokeOAuthListener?.();
  removeMokeOAuthListener = null;
  if (mokeOAuthProcess) {
    try { mokeOAuthProcess.kill(); } catch {}
    mokeOAuthProcess = null;
  }
  closeNativeRateLimits();
  client?.close();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
}

let lastInjectorErrorDetail = null;
try {
  while (!stopped) {
    try {
      const attached = await attach();
      if (!attached) await bindAssetConsole({ resetBinding: false });
      await syncExternalAddAccount();
      await pushPreviews();
      if (attached) {
        const stable = await waitForCodexHomeStable(client);
        process.stdout.write(
          `Codex conversation preview attached to renderer ${attachedTargetId}\n`,
        );
        process.stdout.write(
          `Codex conversation preview ready${stable ? "" : " (stability timeout fallback)"}\n`,
        );
      }
      lastInjectorErrorDetail = null;
    } catch (error) {
      const detail = String(error?.stack || error?.message || error);
      if (detail !== lastInjectorErrorDetail) {
        process.stderr.write(`Injector on 127.0.0.1:${options.port}: ${detail}${options.watch ? "\nRetrying in 5 seconds." : ""}\n`);
        lastInjectorErrorDetail = detail;
      }
      attachedTargetId = null;
      registeredScriptIdentifier = null;
      assetConsoleRequestGeneration += 1;
      await teardownAssetConsoleProxy();
      client?.close();
      client = null;
      if (!options.watch) throw error;
    }
    if (!options.watch) break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
} finally {
  if (!options.watch) await stop();
}
