export const ASSET_CONSOLE_EMBED_ORIGIN = "https://web-sandbox.oaiusercontent.com";
export const ASSET_CONSOLE_EMBED_PREFIX = "/__codex_asset_console__/";

export function assetConsoleEmbedPrefix(token) {
  if (!/^[a-f0-9]{32,128}$/i.test(token || "")) throw new Error("Invalid Asset Console embed token");
  return `${ASSET_CONSOLE_EMBED_PREFIX}${token}/`;
}

export function assetConsoleEmbedUrl(token) {
  return `${ASSET_CONSOLE_EMBED_ORIGIN}${assetConsoleEmbedPrefix(token)}`;
}

export function assetConsoleRoute(requestUrl, { token, assetSession = false } = {}) {
  const url = new URL(requestUrl);
  if (url.origin !== ASSET_CONSOLE_EMBED_ORIGIN) return null;
  const embedPrefix = assetConsoleEmbedPrefix(token);
  let pathname = url.pathname;
  if (pathname.startsWith(embedPrefix)) {
    pathname = pathname.slice(embedPrefix.length - 1) || "/";
  } else if (!assetSession || (!pathname.startsWith("/api/") && pathname !== "/media" && pathname !== "/download")) {
    return null;
  }
  return `${pathname}${url.search}`;
}

export function assetConsolePreviewRoute(requestUrl, { method = "GET", documentUrl = requestUrl } = {}) {
  if (method !== "GET" && method !== "HEAD") return null;
  let request, document;
  try { request = new URL(requestUrl); document = new URL(documentUrl); } catch { return null; }
  if (request.origin !== ASSET_CONSOLE_EMBED_ORIGIN || document.origin !== request.origin) return null;
  const project = /^\/api\/project-file\/([^/]+)\/.+/.exec(document.pathname);
  if (project) {
    if (!request.pathname.startsWith(`/api/project-file/${project[1]}/`)) return null;
  } else if (document.pathname !== "/media" || request.pathname !== "/media" || request.search !== document.search) {
    return null;
  }
  return `${request.pathname}${request.search}`;
}

export function assetConsoleDirectPreviewFrame(frameTree, frameId, panelFrameId) {
  if (!frameTree || !frameId || frameId === panelFrameId) return false;
  if (frameTree.frame?.id === frameId) return frameTree.frame.parentId === panelFrameId;
  return (frameTree.childFrames || []).some((child) =>
    child.frame?.id === frameId
      ? (child.frame.parentId || frameTree.frame?.id) === panelFrameId
      : assetConsoleDirectPreviewFrame(child, frameId, panelFrameId));
}

export function assetConsoleLocalRequestHeaders(headers = {}, apiToken = "", { maxOpenRangeBytes = 0 } = {}) {
  const result = { ...headers, host: "127.0.0.1:5177" };
  const blocked = new Set(["origin", "referer", "connection", "content-length", "x-asset-console-token"]);
  for (const name of Object.keys(result)) {
    if (blocked.has(name.toLowerCase())) delete result[name];
  }
  if (Number.isSafeInteger(maxOpenRangeBytes) && maxOpenRangeBytes > 0) {
    const rangeName = Object.keys(result).find((name) => name.toLowerCase() === "range");
    const match = rangeName && /^bytes=(\d+)-$/i.exec(String(result[rangeName]).trim());
    if (match) {
      const start = Number(match[1]);
      if (Number.isSafeInteger(start)) {
        const end = Math.min(Number.MAX_SAFE_INTEGER, start + maxOpenRangeBytes - 1);
        result[rangeName] = `bytes=${start}-${end}`;
      }
    }
  }
  if (apiToken) result["x-asset-console-token"] = String(apiToken);
  return result;
}

export function transformAssetConsoleBody(requestUrl, body, { token } = {}) {
  const pathname = new URL(requestUrl).pathname;
  const embedPrefix = assetConsoleEmbedPrefix(token);
  if (pathname === embedPrefix || pathname === `${embedPrefix}index.html`) {
    const html = body.toString("utf8")
      .replaceAll('href="/', `href="${embedPrefix}`)
      .replaceAll('src="/', `src="${embedPrefix}`);
    return Buffer.from(html);
  }
  if (pathname.endsWith("/app.js")) {
    return Buffer.from(body.toString("utf8").replace(
      "if (!window.EventSource) return;",
      "return; // Embedded mode uses the existing timed refresh instead of SSE.",
    ));
  }
  return body;
}

export function responseHeadersForCdp(headers, bodyLength) {
  const blocked = new Set(["content-length", "transfer-encoding", "content-encoding", "connection"]);
  const result = Object.entries(headers || {}).flatMap(([name, value]) => {
    if (value == null || blocked.has(name.toLowerCase())) return [];
    return [{ name, value: Array.isArray(value) ? value.join(", ") : String(value) }];
  });
  result.push({ name: "content-length", value: String(bodyLength) });
  return result;
}
