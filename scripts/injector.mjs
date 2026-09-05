#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { closeSync, existsSync, openSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

import { connectMainCodex, readTargets, selectMainCodexTarget } from "./cdp-client.mjs";
import { assetBrowserRuntime, ensureAssetBrowserState } from "../lib/install-config.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";
import { presentCardPreview } from "../lib/card-view.mjs";
import { presentRateLimit } from "../lib/usage-data.mjs";
import { needsPreviewAttachment } from "../lib/injector-state.mjs";
import { buildHomeProjectShelf, readTaskboardSnapshot } from "../lib/home-projects.mjs";
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
const assetRuntime = assetBrowserRuntime({ installDir: root });
await ensureAssetBrowserState(assetRuntime);
const assetConsoleRoot = assetRuntime.sourceRoot;
const assetConsoleServer = assetRuntime.serverPath;
const assetConsoleApiTokenPath = assetRuntime.tokenPath;
let enhancerConfig = {};
try { enhancerConfig = JSON.parse(await readFile(path.join(root, "enhancer.config.json"), "utf8")); } catch (error) {
  if (error.code !== "ENOENT") console.error(`UI configuration could not be read: ${error.message}`);
}
const assetConsoleUrl = "http://127.0.0.1:5177/";
const embeddedAssetConsoleRoot = path.join(root, "asset-console", "public");
const embeddedAssetConsoleFiles = new Map([
  ["/", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { name: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { name: "styles.css", type: "text/css; charset=utf-8" }],
  ["/ui-v3.css", { name: "ui-v3.css", type: "text/css; charset=utf-8" }],
]);
async function embeddedAssetConsoleResponse(route, method, panelKind = "asset", body = null) {
  let pathname;
  try { pathname = new URL(route, assetConsoleUrl).pathname; } catch { return null; }
  if (panelKind !== "asset" || method !== "GET") return null;
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

async function targetId(port) {
  try {
    return selectMainCodexTarget(await readTargets(port))?.id || null;
  } catch {
    return null;
  }
}

const options = parseArgs(process.argv.slice(2));
const repository = new PreviewRepository();

let stopped = false;
let attachedTargetId = null;
let client = null;
let registeredScriptIdentifier = null;
let removeBindingListener = null;
let assetConsoleProxy = null;
let assetConsoleProxyQueue = Promise.resolve();
let assetConsoleStartPromise = null;
let assetConsoleRequestGeneration = 0;
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
      const stdoutPath = path.join(assetRuntime.stateRoot, "asset-browser.stdout.log");
      const stderrPath = path.join(assetRuntime.stateRoot, "asset-browser.stderr.log");
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
  const panelKind = message.panel === "operations" ? "operations" : "asset";
  const panelLabel = panelKind === "operations" ? "专项运营" : "资产控制台";
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

async function bindAssetConsole({ resetBinding = true } = {}) {
  if (resetBinding) {
    removeBindingListener?.();
    removeBindingListener = null;
  }
  const assetAvailable = Boolean(assetConsoleServer && existsSync(assetConsoleServer));
  const operationsAvailable = false;
  if ((assetAvailable || operationsAvailable) && (resetBinding || !removeBindingListener)) {
    await client.send("Runtime.enable");
    try { await client.send("Runtime.removeBinding", { name: ASSET_CONSOLE_BINDING }); } catch {}
    await client.send("Runtime.addBinding", { name: ASSET_CONSOLE_BINDING });
    removeBindingListener = client.on("Runtime.bindingCalled", ({ name, payload }) => {
      if (name === ASSET_CONSOLE_BINDING) handleAssetConsoleBinding(payload).catch(() => {});
    });
  }
  await client.evaluate(`window.__codexConversationPreviewInjection__?.setAssetConsole?.(${JSON.stringify({
    available: assetAvailable || operationsAvailable,
    assetAvailable,
    operationsAvailable,
    label: "资产控制台",
    mode: "embedded",
  })})`);
}

async function attach() {
  const nextTargetId = await targetId(options.port);
  if (!await needsPreviewAttachment({ client, attachedTargetId, nextTargetId })) return false;

  if (!client || nextTargetId !== attachedTargetId) {
    assetConsoleRequestGeneration += 1;
    await teardownAssetConsoleProxy();
    client?.close();
    client = await connectMainCodex(options.port);
    removeBindingListener = null;
    registeredScriptIdentifier = null;
  }

  const oldIdentifier = registeredScriptIdentifier
    || await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`);
  if (oldIdentifier) {
    try { await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: oldIdentifier }); } catch {}
  }
  const userSource = `window.__CODEX_ENHANCER_CONFIG__ = ${JSON.stringify({ skills: enhancerConfig.skills || {} })};\n${await readFile(sourcePath, "utf8")}`;
  const sourceHash = createHash("sha256").update(userSource).digest("hex");
  const markedSource = `${userSource}\n;window.__CODEX_CONVERSATION_PREVIEW_SOURCE_HASH__ = ${JSON.stringify(sourceHash)};`;
  const registered = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: markedSource });
  registeredScriptIdentifier = registered.identifier;
  const sourceAlreadyActive = await client.evaluate(`Boolean(
    window.__codexConversationPreviewInjection__
    && document.getElementById("codex-conversation-preview-style")
    && window.__CODEX_CONVERSATION_PREVIEW_SOURCE_HASH__ === ${JSON.stringify(sourceHash)}
  )`);
  if (!sourceAlreadyActive) await client.evaluate(markedSource);
  await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] = ${JSON.stringify(registered.identifier)}`);
  await bindAssetConsole();
  attachedTargetId = nextTargetId;
  process.stdout.write(`Codex conversation preview attached to renderer ${nextTargetId}\n`);
  return true;
}

async function pushPreviews() {
  if (!client || !attachedTargetId) return;
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
      const id = document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id')
        || document.querySelector('[data-response-annotation-conversation]')?.getAttribute('data-response-annotation-conversation')
        || selected?.getAttribute('data-app-action-sidebar-thread-id')
        || routeId;
      const title = selected?.getAttribute('data-app-action-sidebar-thread-title')
        || Array.from(document.querySelectorAll('[data-testid="app-shell-header-context-menu-surface"] button'))
          .find((button) => button.offsetParent !== null)?.textContent?.trim()
        || '';
      return { requests, activeThread: { id, title } };
    })()`),
    client.evaluate("window.__codexConversationPreviewInjection__?.getHomeProjectsState?.() || null"),
  ]);
  const requests = Array.isArray(sidebarState?.requests) ? sidebarState.requests : [];
  const activeThread = sidebarState?.activeThread || {};
  const [rawPreviews, rawUsage, taskboard, searchCatalog, overview] = await Promise.all([
    repository.readMany(requests),
    repository.readUsage(),
    readTaskboardSnapshot(),
    repository.readSearchCatalog(),
    repository.readOverview(activeThread.id, activeThread.title),
  ]);
  const previews = rawPreviews.map((preview) => presentCardPreview(preview));
  const usage = presentRateLimit(rawUsage, { timeZone: "Asia/Shanghai" });
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
    api?.setThreadOverview?.(${JSON.stringify(overview)});
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
  client?.close();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
}

try {
  while (!stopped) {
    try {
      const attached = await attach();
      if (!attached) await bindAssetConsole({ resetBinding: false });
      await pushPreviews();
    } catch (error) {
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
