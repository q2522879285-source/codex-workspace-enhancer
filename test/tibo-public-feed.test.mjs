import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTiboFeed,
  mergeTiboUsage,
  readTiboPublicSignal,
  resetTiboPublicFeedCache,
} from "../lib/tibo-public-feed.mjs";

const NOW = Date.parse("2026-09-27T00:00:00Z");

test("classifies recent reset-related posts and boosts an active future hint", () => {
  const feed = {
    source: "x-api",
    signal: {
      id: "signal-1",
      at: "2026-09-26T18:00:00Z",
      summary: "More resets coming next week",
      active: true,
    },
    tweets: [
      { id: "1", at: "2026-09-26T18:00:00Z", tibo_lane: "reset_related", kind: "signal", text: "More resets coming next week" },
      { id: "2", at: "2026-09-20T18:00:00Z", tibo_lane: "reset_related", kind: "other", text: "Weekend plans" },
      { id: "3", at: "2026-09-19T18:00:00Z", tibo_lane: "reset_related", kind: "candidate", text: "We reset usage limits" },
    ],
  };
  const result = classifyTiboFeed(feed, { now: NOW });
  assert.equal(result.sampleCount, 2);
  assert.ok(result.baseProbability > 0);
  assert.equal(result.signalBoost, 45);
  assert.ok(result.probability > result.baseProbability);
});

test("uses the latest BetterOPC reset status as the public probability", () => {
  const result = classifyTiboFeed({
    history: {
      days: [{
        events: [
          { id: "old", status: "executed", occurredAtIso: "2026-09-26T18:17:54Z" },
          {
            id: "current",
            status: "scheduled",
            occurredAtIso: "2026-10-02T02:14:51Z",
            summaryZh: "明日全员重置",
            originalUrl: "https://x.com/example/status/1",
          },
        ],
      }],
    },
  }, {
    now: Date.parse("2026-10-02T12:00:00Z"),
    targetIso: "2026-10-02T18:00:00.000Z",
  });
  assert.equal(result.source, "betteropc");
  assert.equal(result.status, "scheduled");
  assert.equal(result.probability, 100);
  assert.equal(result.summary, "明日全员重置");
  assert.equal(result.tiboExpectedAt, "2026-10-02T18:00:00.000Z");
  assert.equal(result.tiboEvidenceUrl, "https://x.com/example/status/1");
});

test("updates the public summary when BetterOPC marks the reset executed", () => {
  const result = classifyTiboFeed({
    history: {
      days: [{
        events: [{
          id: "executed",
          status: "executed",
          labelZh: "全员重置",
          occurredAtIso: "2026-10-03T02:14:00Z",
          summaryZh: "作者宣布明日全员重置，尚未开始。",
        }],
      }],
    },
  });
  assert.equal(result.probability, 0);
  assert.equal(result.tiboSummary, "Tibo已完成全员重置。");
  assert.equal(result.summary, "Tibo已完成全员重置。");
});

test("ignores BetterOPC reset hints without a concrete reset kind", () => {
  const result = classifyTiboFeed({
    history: { days: [{ events: [{
      id: "hint",
      status: "possible",
      subtype: "reset_hint",
      resetKinds: [],
      occurredAtIso: "2026-10-03T17:39:44Z",
      summaryZh: "Codex 可能即将有新动作，额度重置只是可能性之一。",
      originalText: "What’s one thing that’s missing in codex that you wish we had?",
    }] }] },
  }, { now: Date.parse("2026-10-03T12:00:00Z") });
  assert.equal(result.probability, 0);
});

test("raises fresh concrete future signals and discounts stale ones", () => {
  const make = (occurredAtIso, summaryZh = "明日全员重置") => classifyTiboFeed({
    history: { days: [{ events: [{
      id: occurredAtIso,
      status: "possible",
      subtype: "reset_claim",
      resetKinds: ["all_users"],
      occurredAtIso,
      summaryZh,
    }] }] },
  }, { now: Date.parse("2026-10-03T12:00:00Z") });
  const fresh = make("2026-10-03T10:00:00Z");
  const old = make("2026-09-20T10:00:00Z", "重置相关讨论");
  assert.ok(fresh.probability > old.probability);
  assert.ok(fresh.probability > 25);
});

test("reduces a scheduled signal after its target window passes", () => {
  const feed = {
    history: { days: [{ events: [{
      id: "scheduled",
      status: "scheduled",
      subtype: "hard_reset",
      resetKinds: ["hard"],
      occurredAtIso: "2026-10-02T02:00:00Z",
      summaryZh: "明日全员重置",
    }] }] },
  };
  const before = classifyTiboFeed(feed, {
    now: Date.parse("2026-10-02T12:00:00Z"),
    targetIso: "2026-10-02T18:00:00Z",
  });
  const after = classifyTiboFeed(feed, {
    now: Date.parse("2026-10-03T12:00:00Z"),
    targetIso: "2026-10-02T18:00:00Z",
  });
  assert.equal(before.probability, 100);
  assert.ok(after.probability < before.probability);
});

test("does not turn a negated reset post into a positive probability", () => {
  const result = classifyTiboFeed({
    history: { days: [{ events: [{
      id: "no-reset",
      status: "possible",
      subtype: "hard_reset",
      resetKinds: ["hard"],
      occurredAtIso: "2026-10-03T10:00:00Z",
      summaryZh: "主 dot 用量近乎无限，目前无法给出重置。",
      originalText: "I can't really give a reset right now.",
    }] }] },
  }, { now: Date.parse("2026-10-03T12:00:00Z") });
  assert.equal(result.probability, 0);
});

test("keeps an explicit native probability and fills a missing one from the feed", () => {
  assert.equal(mergeTiboUsage({ tiboProbability: 12 }, { probability: 88 }).tiboProbability, 12);
  assert.equal(mergeTiboUsage({ remainingPercent: 70 }, { probability: 88 }).tiboProbability, 88);
  const merged = mergeTiboUsage({ tiboProbability: 12 }, {
    source: "betteropc",
    probability: 100,
    tiboExpectedAt: "2026-10-02T18:00:00.000Z",
    tiboSummary: "明日全员重置",
    tiboEvidenceUrl: "https://betteropc.com/ai-products/reset-signals/codex",
  });
  assert.equal(merged.tiboProbability, 100);
  assert.equal(merged.tiboExpectedAt, "2026-10-02T18:00:00.000Z");
  assert.equal(merged.tiboSummary, "明日全员重置");
  assert.equal(merged.tiboEvidenceUrl, "https://betteropc.com/ai-products/reset-signals/codex");
});

test("caches the public feed and keeps the last good value on request failure", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls > 1) throw new Error("offline");
    return {
      ok: true,
      json: async () => ({
        source: "x-api",
        tweets: [{ id: "1", at: "2026-09-26T12:00:00Z", tibo_lane: "reset_related", kind: "signal", text: "More resets coming" }],
      }),
    };
  };
  try {
    resetTiboPublicFeedCache();
    const first = await readTiboPublicSignal({ feedUrl: "https://fixture.invalid/feed", now: NOW, ttlMs: 100 });
    const cached = await readTiboPublicSignal({ feedUrl: "https://fixture.invalid/feed", now: NOW + 50, ttlMs: 100 });
    const stale = await readTiboPublicSignal({ feedUrl: "https://fixture.invalid/feed", now: NOW + 101, ttlMs: 100 });
    assert.equal(calls, 2);
    assert.equal(cached.probability, first.probability);
    assert.equal(stale.probability, first.probability);
    assert.equal(stale.stale, true);
  } finally {
    globalThis.fetch = originalFetch;
    resetTiboPublicFeedCache();
  }
});

test("unconfigured public feed never performs network requests or injects zero probability", async () => {
  const original = globalThis.fetch, previous = process.env.CODEX_TIBO_FEED_URL;
  delete process.env.CODEX_TIBO_FEED_URL;
  globalThis.fetch = async () => { throw new Error("unexpected network"); };
  try {
    const signal = await readTiboPublicSignal();
    assert.equal(signal.status, "unavailable");
    assert.equal(signal.probability, undefined);
    assert.deepEqual(mergeTiboUsage(null, signal), {});
  } finally { globalThis.fetch = original; if (previous === undefined) delete process.env.CODEX_TIBO_FEED_URL; else process.env.CODEX_TIBO_FEED_URL = previous; }
});
