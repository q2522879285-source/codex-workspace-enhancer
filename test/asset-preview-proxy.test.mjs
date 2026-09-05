import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as embed from "../lib/asset-console-embed.mjs";

const origin = embed.ASSET_CONSOLE_EMBED_ORIGIN;
const html = `${origin}/api/project-file/project-a/site/index.html`;
test("preview reads only same-project resources or the selected media", () => {
  const route = (url, method = "GET") => embed.assetConsolePreviewRoute(new URL(url, html).href, { documentUrl: html, method });
  assert.equal(route("./style.css"), "/api/project-file/project-a/site/style.css");
  assert.equal(route("../app.js", "HEAD"), "/api/project-file/project-a/app.js");
  for (const url of ["/api/projects", "/api/project-file/project-b/x.js", "/media?output=other", "https://example.com/x.js"]) assert.equal(route(url), null);
  assert.equal(route("./style.css", "POST"), null);
  const pdf = `${origin}/media?output=pdf-1`;
  assert.equal(embed.assetConsolePreviewRoute(pdf, { documentUrl: pdf }), "/media?output=pdf-1");
  assert.equal(embed.assetConsolePreviewRoute(`${origin}/media?output=pdf-2`, { documentUrl: pdf }), null);
  const tree = { frame: { id: "panel" }, childFrames: [{ frame: { id: "preview" }, childFrames: [{ frame: { id: "nested" } }] }] };
  assert.equal(embed.assetConsoleDirectPreviewFrame(tree, "preview", "panel"), true);
  assert.equal(embed.assetConsoleDirectPreviewFrame(tree, "nested", "panel"), false);
});

test("proxy requires a direct preview child and never rewrites or forwards preview writes", async () => {
  const source = await readFile(new URL("../scripts/injector.mjs", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("async function proxyAssetConsoleRequest("), source.indexOf("async function disposeAssetConsoleProxy("));
  const forwarded = [], fulfilled = [], failed = [];
  let parentId = "panel";
  const token = "a".repeat(48);
  const proxy = { panelKind: "asset", allowedFrameId: "panel", embedPrefix: embed.assetConsoleEmbedPrefix(token), token,
    previewDocuments: new Map(), assetSessions: new Set(["main-session"]), sessionInfo: new Map([["main-session", { targetId: "panel" }]]),
    client: { async send(method, args) {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "preview", parentId } } };
      if (method === "Fetch.fulfillRequest") fulfilled.push(args);
    } },
  };
  const context = vm.createContext({ ...embed, URL, Buffer,
    failAssetConsoleRequest: async (_, event) => failed.push(event.requestId),
    activateAssetConsoleSession: async () => {},
    embeddedAssetConsoleResponse: async () => { throw Error("preview entered panel handler"); },
    requestAssetConsole: async request => { forwarded.push(request); return { status: 200, body: Buffer.from("if (!window.EventSource) return;"), headers: {} }; },
  });
  vm.runInContext(`${fn}; globalThis.run = proxyAssetConsoleRequest;`, context);
  const event = (url, method = "GET", resourceType = "Document") => ({ requestId: String(forwarded.length + failed.length), frameId: "preview", resourceType, request: { url, method, headers: {} } });
  await context.run(event(html), "preview-session", proxy);
  await context.run(event(new URL("./app.js", html).href, "GET", "Script"), "preview-session", proxy);
  assert.equal(forwarded.length, 2);
  assert.equal(Buffer.from(fulfilled[1].body, "base64").toString(), "if (!window.EventSource) return;");
  await context.run(event(html, "POST"), "preview-session", proxy);
  await context.run(event(`${origin}/api/projects`), "preview-session", proxy);
  parentId = "other-preview";
  await context.run(event(html), "preview-session", proxy);
  parentId = "unrelated";
  await context.run(event(html), "preview-session", proxy);
  await context.run(event(embed.assetConsoleEmbedUrl(token)), "preview-session", proxy);
  const firstScript = event(html, "GET", "Script");
  parentId = "panel";
  proxy.previewDocuments.clear();
  await context.run(firstScript, "preview-session", proxy);
  assert.equal(failed.length, 6);
  assert.equal(forwarded.length, 2);
  assert.equal(proxy.assetSessions.size, 1);
});
