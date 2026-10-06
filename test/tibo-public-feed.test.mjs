import assert from "node:assert/strict";
import test from "node:test";
import { presentRateLimit } from "../lib/usage-data.mjs";

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

const CHALLENGE_DAY_2_NOW = Date.parse("2026-10-06T04:00:00Z");
const improvement = {
  id: "day-2-improvement",
  authorHandle: "thsottiaux",
  signalType: "announcement",
  subtype: "product_improvement",
  status: "executed",
  occurredAtIso: "2026-10-06T02:00:00Z",
  summaryZh: "Codex 速度提高 50%。",
  originalUrl: "https://x.com/thsottiaux/status/2107200000000000000",
};
const challengeResult = (events = [], now = CHALLENGE_DAY_2_NOW, historyEvents = []) => classifyTiboFeed({
  history: { days: [{ events: historyEvents }] },
}, { now, challengeFeed: { events } });

test("keeps day-two product improvements at the 50 percent daily baseline and links their X post", () => {
  const result = challengeResult([improvement]);
  assert.equal(result.probability, 50);
  assert.equal(result.tiboChallenge.day, 2);
  assert.equal(result.tiboChallenge.totalDays, 28);
  assert.equal(result.tiboChallenge.phase, "active");
  assert.equal(result.tiboChallenge.status, "improvement");
  assert.equal(result.tiboChallenge.evidenceUrl, improvement.originalUrl);
});

test("a confirmed same-day hard reset wins over a newer product improvement", () => {
  const reset = {
    ...improvement,
    id: "day-2-reset",
    signalType: "reset",
    subtype: "hard_reset",
    resetKinds: ["hard"],
    occurredAtIso: "2026-10-06T01:00:00Z",
    originalUrl: "https://x.com/thsottiaux/status/2107100000000000000",
  };
  const result = challengeResult([reset, improvement]);
  assert.equal(result.probability, 0);
  assert.equal(result.tiboChallenge.status, "reset");
  assert.equal(result.tiboChallenge.evidenceUrl, reset.originalUrl);
  const nextDay = challengeResult([reset, improvement], Date.parse("2026-10-06T16:00:00Z"));
  assert.equal(nextDay.probability, 50);
  assert.equal(nextDay.tiboChallenge.day, 3);
  assert.equal(nextDay.tiboChallenge.status, "waiting");
});

test("daily waiting baseline advances at Shanghai midnight and stops when the challenge ends", () => {
  const before = challengeResult([], Date.parse("2026-10-04T15:59:59Z"));
  const start = challengeResult([], Date.parse("2026-10-04T16:00:00Z"));
  const lastDayTwoSecond = challengeResult([improvement], Date.parse("2026-10-06T15:59:59Z"));
  const dayThree = challengeResult([improvement], Date.parse("2026-10-06T16:00:00Z"));
  const ended = challengeResult([], Date.parse("2026-11-01T16:00:00Z"));
  assert.equal(before.probability, 0);
  assert.equal(before.tiboChallenge.phase, "upcoming");
  assert.equal(start.probability, 50);
  assert.equal(start.tiboChallenge.day, 1);
  assert.equal(start.tiboChallenge.status, "waiting");
  assert.equal(lastDayTwoSecond.tiboChallenge.day, 2);
  assert.equal(dayThree.probability, 50);
  assert.equal(dayThree.tiboChallenge.day, 3);
  assert.equal(dayThree.tiboChallenge.status, "waiting");
  assert.equal(dayThree.tiboChallenge.deadlineIso, "2026-10-07T16:00:00.000Z");
  assert.equal(ended.probability, 0);
  assert.equal(ended.tiboChallenge.phase, "ended");
  assert.equal(ended.tiboChallenge.day, 28);
});

test("partial and scheduled hard resets do not count as an executed daily reset", () => {
  for (const status of ["partial", "scheduled"]) {
    const result = challengeResult([{
      ...improvement,
      id: status,
      signalType: "reset",
      subtype: "hard_reset",
      resetKinds: ["hard"],
      status,
      expectedAtIso: "2026-10-06T03:00:00Z",
      summaryZh: "重置状态更新",
    }]);
    assert.equal(result.probability, 50, status);
    assert.equal(result.tiboChallenge.status, "waiting", status);
  }
});

test("old resets and expired schedules cannot suppress the active daily baseline", () => {
  for (const status of ["executed", "scheduled"]) {
    const result = challengeResult([], CHALLENGE_DAY_2_NOW, [{
      id: `old-${status}`,
      status,
      signalType: "reset",
      subtype: "hard_reset",
      resetKinds: ["hard"],
      occurredAtIso: "2026-10-05T02:00:00Z",
      expectedAtIso: "2026-10-05T03:00:00Z",
      summaryZh: "全员重置",
    }]);
    assert.equal(result.probability, 50, status);
    assert.equal(result.tiboChallenge.status, "waiting", status);
  }
});

test("a concrete future reset signal may raise the active daily baseline", () => {
  const result = challengeResult([], CHALLENGE_DAY_2_NOW, [{
    id: "upcoming-reset",
    status: "scheduled",
    subtype: "hard_reset",
    resetKinds: ["hard"],
    occurredAtIso: "2026-10-06T02:00:00Z",
    expectedAtIso: "2026-10-06T06:00:00Z",
    summaryZh: "稍后全员重置",
  }]);
  assert.equal(result.probability, 100);
  assert.equal(result.tiboChallenge.status, "waiting");
});

test("merging the challenge preserves its stale marker even when the main feed is fresh", () => {
  const challenge = { day: 2, status: "waiting", stale: true };
  const merged = mergeTiboUsage({}, {
    source: "betteropc", probability: 50, stale: false, tiboChallenge: challenge,
  });
  assert.equal(merged.tiboProbability, 50);
  assert.equal(merged.tiboChallenge.stale, true);
  assert.notEqual(merged.tiboChallenge, challenge);
});

test("default history and challenge feeds keep the daily clock and stale fallback moving through cache", async () => {
  const originalFetch = globalThis.fetch;
  const feedUrl = "https://betteropc.com/api/browser/product-tracking/codex/history";
  const calls = [];
  let challengeOffline = false;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith("/challenge")) {
      if (challengeOffline) throw new Error("challenge offline");
      return { ok: true, json: async () => ({ events: [improvement] }) };
    }
    if (path.endsWith("/history")) {
      return { ok: true, json: async () => ({ history: { days: [{ events: [] }] } }) };
    }
    assert.equal(path, "/ai-products/reset-signals/codex");
    return { ok: true, text: async () => "" };
  };
  const start = Date.parse("2026-10-06T15:58:00Z");
  const read = (offset) => readTiboPublicSignal({ feedUrl, now: start + offset, ttlMs: 240_000 });
  try {
    resetTiboPublicFeedCache();
    const first = await read(0);
    assert.equal(first.probability, 50);
    assert.equal(first.tiboChallenge.status, "improvement");
    assert.equal(first.tiboChallenge.remainingMinutes, 2);
    const minuteLater = await read(60_000);
    assert.equal(minuteLater.tiboChallenge.remainingMinutes, 1);
    const nextDay = await read(120_000);
    assert.equal(nextDay.probability, 50);
    assert.equal(nextDay.tiboChallenge.day, 3);
    assert.equal(nextDay.tiboChallenge.status, "waiting");
    assert.equal(calls.length, 3);
    challengeOffline = true;
    const stale = await read(240_001);
    assert.equal(stale.probability, 50);
    assert.equal(stale.tiboChallenge.day, 3);
    assert.equal(stale.stale, true);
    assert.equal(stale.tiboChallenge.stale, true);
    const staleCached = await read(300_001);
    assert.equal(staleCached.probability, 50);
    assert.equal(staleCached.stale, true);
    assert.equal(staleCached.tiboChallenge.stale, true);
    assert.ok(staleCached.tiboChallenge.remainingMinutes < stale.tiboChallenge.remainingMinutes);
    assert.equal(calls.filter(path => path.endsWith("/history")).length, 2);
    assert.equal(calls.filter(path => path.endsWith("/challenge")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    resetTiboPublicFeedCache();
  }
});

test("the classify merge presentation chain separates the daily deadline from an actual reset forecast", () => {
  const signal = challengeResult([improvement]);
  const usage = mergeTiboUsage({ remainingPercent: 70 }, signal);
  const display = presentRateLimit(usage, { timeZone: "Asia/Shanghai" });
  assert.equal(display.tiboProbabilityText, "50%");
  assert.equal(display.tiboChallengeText, "进行中 · 第 2/28 天");
  assert.equal(display.tiboDailyText, "已改进，尚未全面重置");
  assert.equal(display.tiboDeadlineText, "10月7日 00:00（北京时间）");
  assert.equal(display.tiboResetText, "未公布具体时间");
  assert.equal(display.tiboAvailable, false);
  assert.match(display.tiboProbabilityReason, /50%.*自定展示基准/);
  assert.equal(usage.tiboNewsAt, improvement.occurredAtIso);
  assert.equal(display.tiboNewsPostedText, "10月6日 10:00");
  assert.equal(display.tiboDailyPostedText, "10月6日 10:00");
  assert.equal(display.tiboEvidenceUrl, improvement.originalUrl);
  assert.equal(display.tiboDailyEvidenceUrl, improvement.originalUrl);
});

test("an initial feed failure remains unknown instead of claiming zero probability", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    resetTiboPublicFeedCache();
    const signal = await readTiboPublicSignal({ feedUrl: "https://fixture.invalid/feed", now: NOW });
    assert.equal(signal.status, "unavailable");
    assert.equal(signal.stale, true);
    assert.equal(signal.probability, undefined);
    assert.deepEqual(mergeTiboUsage(null, signal), {});
    assert.equal(presentRateLimit(mergeTiboUsage(null, signal)).tiboProbabilityText, "--");
  } finally {
    globalThis.fetch = original;
    resetTiboPublicFeedCache();
  }
});

test("an initially missing challenge remains visibly stale through merge and presentation", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const route = new URL(url).pathname;
    if (route.endsWith("/challenge")) throw new Error("challenge offline");
    if (route.endsWith("/history")) return { ok: true, json: async () => ({ history: { days: [] } }) };
    return { ok: true, text: async () => "" };
  };
  try {
    resetTiboPublicFeedCache();
    const signal = await readTiboPublicSignal({
      feedUrl: "https://betteropc.com/api/browser/product-tracking/codex/history", now: NOW,
    });
    assert.equal(signal.stale, true);
    assert.equal(signal.tiboChallenge, null);
    const display = presentRateLimit(mergeTiboUsage(null, signal));
    assert.equal(display.tiboFeedStale, true);
    assert.equal(display.tiboChallengeText, "");
  } finally {
    globalThis.fetch = original;
    resetTiboPublicFeedCache();
  }
});
