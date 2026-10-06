import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { presentCardPreview } from "../lib/card-view.mjs";
import { normalizeTaskId } from "../lib/task-context-store.mjs";
import { presentRateLimit } from "../lib/usage-data.mjs";
import { mergeTiboUsage } from "../lib/tibo-public-feed.mjs";
import { buildHomeProjectShelf } from "../lib/home-projects.mjs";

test("public refresh delivers previews, usage and overview without a business store", async () => {
  const source = await readFile(new URL("../scripts/injector.mjs", import.meta.url), "utf8");
  const begin = source.indexOf("async function pushPreviews() {");
  const end = source.indexOf("\nasync function stop()", begin);
  assert.ok(begin >= 0 && end > begin);
  const id = "11111111-1111-4111-8111-111111111111";
  const preview = { threadId: id, recentInput: "demo request", recentOutput: "demo result", summary: "demo summary" };
  const payloads = {};
  const renderer = vm.createContext({ window: { __codexConversationPreviewInjection__: Object.fromEntries(
    ["Previews", "Usage", "HomeProjects", "SearchCatalog", "ThreadOverview", "ColdHistory"].map(name =>
      [`set${name}`, value => { payloads[name] = value; }]),
  ) } });
  const context = vm.createContext({
    client: { evaluate: async script => {
      if (script.includes("const seen = new Set()")) return { requests: [{ id, title: "Demo" }], activeThread: { id, title: "Demo" } };
      if (script.includes("getHomeProjectsState")) return null;
      return vm.runInContext(script, renderer);
    } },
    attachedTargetId: "demo-renderer", lastNativeSidebarRefreshAt: Date.now(),
    tickColdHistory() {}, coldHistory: { getStatus: async () => ({ enabled: false }) },
    repository: {
      readMany: async requests => { assert.equal(requests[0].id, id); return [preview]; },
      readUsage: async () => ({}), readSearchCatalog: async () => [{ threadId: id }],
      readOverview: async () => ({ threadId: id, summary: "cached summary" }),
    },
    readNativeRateLimits: async () => null,
    readTaskboardSnapshot: async () => ({ available: false, message: "not configured" }),
    process: { env: { CODEX_TIBO_FEED_URL: "https://example.com/feed" } },
    readTiboPublicSignal: async () => ({ probability: 42 }),
    presentCardPreview, normalizeTaskId, presentRateLimit, mergeTiboUsage, buildHomeProjectShelf,
  });
  vm.runInContext(source.slice(begin, end), context);
  await context.pushPreviews();
  assert.equal(payloads.Previews.length, 1);
  assert.equal(payloads.Usage.tiboProbability, 42);
  assert.equal(payloads.ThreadOverview.currentRequest, "demo request");
  assert.equal(payloads.ThreadOverview.progress, "demo result");
  assert.equal(payloads.SearchCatalog[0].threadId, id);
  assert.equal(payloads.HomeProjects.available, false);
  assert.equal(payloads.ColdHistory.enabled, false);
});
