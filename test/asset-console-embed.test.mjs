import assert from "node:assert/strict";
import test from "node:test";

import {
  assetConsoleEmbedPrefix,
  assetConsoleEmbedUrl,
  assetConsoleRoute,
  responseHeadersForCdp,
  transformAssetConsoleBody,
} from "../lib/asset-console-embed.mjs";

const token = "0123456789abcdef0123456789abcdef0123456789abcdef";
const embedUrl = assetConsoleEmbedUrl(token);

test("embedded Asset Console routes only its own sandbox requests to localhost", () => {
  assert.equal(assetConsoleRoute(`${embedUrl}styles.css`, { token }), "/styles.css");
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/api/projects", { token, assetSession: true }), "/api/projects");
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/media?path=a.png", { token, assetSession: true }), "/media?path=a.png");
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/api/projects", { token }), null);
  assert.equal(assetConsoleRoute("https://example.com/api/projects", { token, assetSession: true }), null);
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/__codex_asset_console__/wrong-token/app.js", { token }), null);
  assert.throws(() => assetConsoleEmbedPrefix("predictable"), /Invalid Asset Console embed token/);
});

test("embedded Asset Console rewrites local assets and disables the unproxyable event stream", () => {
  const html = Buffer.from('<link href="/styles.css"><script src="/app.js"></script>');
  const rewrittenHtml = transformAssetConsoleBody(embedUrl, html, { token }).toString("utf8");
  assert.match(rewrittenHtml, new RegExp(`${token}/styles\\.css`));
  assert.match(rewrittenHtml, new RegExp(`${token}/app\\.js`));

  const script = Buffer.from("function configureLiveEvents() { if (!window.EventSource) return; }");
  const rewrittenScript = transformAssetConsoleBody(`${embedUrl}app.js`, script, { token }).toString("utf8");
  assert.match(rewrittenScript, /Embedded mode uses the existing timed refresh/);
});

test("proxied responses replace stale transport lengths", () => {
  const headers = responseHeadersForCdp({ "content-type": "text/css", "content-length": "1", connection: "close" }, 42);
  assert.deepEqual(headers, [
    { name: "content-type", value: "text/css" },
    { name: "content-length", value: "42" },
  ]);
});
