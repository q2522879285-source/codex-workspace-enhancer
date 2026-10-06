const DEFAULT_FEED_URL = "https://betteropc.com/api/browser/product-tracking/codex/history";
const DEFAULT_PAGE_URL = "https://betteropc.com/ai-products/reset-signals/codex";
const DEFAULT_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_HORIZON_HOURS = 24;
const REQUEST_TIMEOUT_MS = 5_000;
const RESET_RE = /\b(?:reset|resets|resetting|rate\s+limits?|usage\s+limits?|banked\s+reset|credits?)\b/i;
const FUTURE_RE = /(?:\b(?:coming|next\s+(?:week|day|\w+)|tomorrow|today|soon|in\s+(?:a\s+)?few\s+hours?|in\s+a\s+bit|promised|will\s+reset|more\s+resets?|landing|lands|by\s+midnight|end\s+of\s+day)\b|(?:明日|明天|今天|即将|很快|下周|稍后|将(?:会)?|承诺|预告).{0,16}(?:重置|reset))/i;
const NEGATIVE_RE = /(?:\b(?:can't|cannot|no|not|never|unable|virtually\s+unlimited|just\s+a\s+possibility|only\s+a\s+possibility)\b|无法(?:给出|确认|承诺)|未(?:承诺|宣布|说明)|只是可能性之一|仅是可能|没有(?:具体)?重置)/i;
let cached = null;
let inFlight = null;

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function uniquePosts(feed) {
  const posts = Array.isArray(feed?.tweets) ? feed.tweets : [];
  const seen = new Set();
  return posts.filter((post) => {
    const id = String(post?.id || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function isResetRelatedPost(post) {
  if (String(post?.tibo_lane || "").toLowerCase() !== "reset_related") return false;
  const text = String(post?.text || "");
  const kind = String(post?.kind || "").toLowerCase();
  return post?.explicit_reset_claim === true
    || kind === "signal"
    || kind === "candidate"
    || RESET_RE.test(text)
    || FUTURE_RE.test(text);
}

function isFutureSignal(post) {
  const text = String(post?.text || post?.summary || "");
  return post?.explicit_reset_claim === true && FUTURE_RE.test(text)
    || FUTURE_RE.test(text)
    || post?.tease_classification?.teasing === true;
}

function clamp(value) {
  return Math.min(100, Math.max(0, value));
}

function betterOpcSummary(event, status) {
  const raw = typeof event?.summaryZh === "string"
    ? event.summaryZh.replace(/^作者宣布/, "Tibo宣布")
    : "";
  if (status === "executed") return `Tibo已完成${event?.labelZh || "本次重置"}。`;
  if (status === "partial") return `Tibo已部分完成${event?.labelZh || "本次重置"}。`;
  return raw;
}

function betterOpcEvents(feed) {
  if (!Array.isArray(feed?.history?.days)) return [];
  const seen = new Set();
  return feed.history.days.flatMap((day) => Array.isArray(day?.events) ? day.events : [])
    .filter((event) => {
      const id = String(event?.id || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function eventTargetMs(event, targetIso = null) {
  const candidates = [
    targetIso,
    event?.targetIso,
    event?.expectedAtIso,
    event?.scheduledAtIso,
    event?.official_window?.start_at,
  ];
  for (const candidate of candidates) {
    const parsed = timestamp(candidate);
    if (parsed != null) return parsed;
  }
  return null;
}

function eventAgeHours(event, now) {
  const occurred = timestamp(event?.occurredAtIso);
  return occurred == null ? 0 : Math.max(0, (Number(now) - occurred) / 3_600_000);
}

function scheduledProbability(event, now, targetIso) {
  const target = eventTargetMs(event, targetIso);
  if (target != null) {
    const hoursUntil = (target - Number(now)) / 3_600_000;
    if (hoursUntil <= 0) return Math.round(clamp(25 - Math.abs(hoursUntil) * 5));
    if (hoursUntil <= 6) return 100;
    if (hoursUntil <= 24) return 95;
    if (hoursUntil <= 72) return 85;
    if (hoursUntil <= 168) return 70;
    return 55;
  }

  const ageHours = eventAgeHours(event, now);
  if (ageHours <= 6) return 100;
  if (ageHours <= 24) return 95;
  if (ageHours <= 48) return 85;
  if (ageHours <= 72) return 70;
  if (ageHours <= 168) return 50;
  return 25;
}

function betterOpcEventProbability(event, status, now, { targetIso = null } = {}) {
  if (status === "executed") return 0;
  if (status === "scheduled") return scheduledProbability(event, now, targetIso);

  const subtype = String(event?.subtype || "").toLowerCase();
  const resetKinds = Array.isArray(event?.resetKinds) ? event.resetKinds.filter(Boolean) : [];
  const text = [event?.summaryZh, event?.originalText, event?.labelZh].filter(Boolean).join(" ");
  if (subtype === "reset_hint" || status === "reset_hint" || resetKinds.length === 0) return 0;
  if (NEGATIVE_RE.test(text)) return 0;

  const freshness = Math.exp(-eventAgeHours(event, now) / (3 * 24));
  const future = FUTURE_RE.test(text);
  const statusBase = status === "partial" ? 35 : 20;
  const probability = statusBase + freshness * 30 + (future ? 30 : 0);
  return Math.round(clamp(probability));
}

function extractBetterOpcTargetIso(page) {
  const match = String(page || "").match(/targetIso\\?":\\?"([^"\\]+)/);
  const value = match?.[1] || "";
  return timestamp(value) == null ? null : new Date(timestamp(value)).toISOString();
}

function classifyBetterOpcFeed(feed, { targetIso = null, now = Date.now() } = {}) {
  const currentNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const events = betterOpcEvents(feed).sort((a, b) =>
    (timestamp(b?.occurredAtIso) ?? -Infinity) - (timestamp(a?.occurredAtIso) ?? -Infinity));
  const latest = events[0] || null;
  const status = String(latest?.status || "").toLowerCase();
  const probability = betterOpcEventProbability(latest, status, currentNow, { targetIso });
  return {
    probability,
    baseProbability: probability,
    signalBoost: 0,
    sampleCount: events.length,
    windowDays: DEFAULT_WINDOW_DAYS,
    horizonHours: DEFAULT_HORIZON_HOURS,
    source: "betteropc",
    status: status || null,
    latestEventAt: latest?.occurredAtIso || null,
    tiboExpectedAt: targetIso,
    tiboSummary: betterOpcSummary(latest, status) || null,
    tiboEvidenceUrl: latest?.originalUrl || DEFAULT_PAGE_URL,
    summary: betterOpcSummary(latest, status) || null,
    originalUrl: latest?.originalUrl || null,
    feedFetchedAt: null,
    feedStale: false,
  };
}

/**
 * Estimate the chance that Tibo posts a reset-related update in the next 24h.
 * The base is a Poisson estimate from the recent posting rate; active hints add
 * a bounded hazard boost without using the separate actual-reset forecast.
 */
export function classifyTiboFeed(feed, {
  now = Date.now(),
  windowDays = DEFAULT_WINDOW_DAYS,
  horizonHours = DEFAULT_HORIZON_HOURS,
  targetIso = null,
} = {}) {
  if (Array.isArray(feed?.history?.days)) return classifyBetterOpcFeed(feed, { targetIso, now });
  const nowMs = Number(now);
  const days = Number(windowDays);
  const hours = Number(horizonHours);
  if (!Number.isFinite(nowMs) || !Number.isFinite(days) || days <= 0 || !Number.isFinite(hours) || hours <= 0) {
    return { probability: 0, baseProbability: 0, signalBoost: 0, sampleCount: 0 };
  }

  const startMs = nowMs - days * 24 * 60 * 60 * 1000;
  const posts = uniquePosts(feed);
  const recent = posts.filter((post) => {
    const at = timestamp(post?.at || post?.declared_at);
    return at != null && at >= startMs && at <= nowMs && isResetRelatedPost(post);
  });
  const ratePerDay = recent.length / days;
  const baseProbability = clamp((1 - Math.exp(-(ratePerDay * hours) / 24)) * 100);

  const signalAt = timestamp(feed?.signal?.at);
  const signalIsFresh = signalAt != null && signalAt >= nowMs - 7 * 24 * 60 * 60 * 1000 && signalAt <= nowMs;
  const activeSignal = signalIsFresh && feed?.signal?.active !== false && isFutureSignal(feed.signal);
  const recentTease = recent.some((post) => {
    const at = timestamp(post?.at || post?.declared_at);
    return at != null && at >= nowMs - 7 * 24 * 60 * 60 * 1000 && isFutureSignal(post);
  });
  const activeWindow = (Array.isArray(feed?.events) ? feed.events : []).some((event) => {
    const end = timestamp(event?.official_window?.end_at);
    return event?.preview === true && end != null && end >= nowMs && event?.type === "reset";
  });
  const signalBoost = activeWindow ? 65 : activeSignal ? 45 : recentTease ? 25 : 0;
  const probability = clamp(100 - (100 - baseProbability) * (1 - signalBoost / 100));

  return {
    probability,
    baseProbability,
    signalBoost,
    sampleCount: recent.length,
    windowDays: days,
    horizonHours: hours,
    source: typeof feed?.source === "string" ? feed.source : "codex-reset-feed",
    feedFetchedAt: typeof feed?.fetched_at === "string" ? feed.fetched_at : null,
    feedStale: feed?.stale === true,
  };
}

async function fetchFeed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response?.ok) throw new Error(`Tibo feed request failed (${response?.status || "unknown"})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBetterOpcTarget(url = DEFAULT_PAGE_URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "text/html" },
      signal: controller.signal,
    });
    if (!response?.ok) throw new Error(`BetterOPC page request failed (${response?.status || "unknown"})`);
    return extractBetterOpcTargetIso(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

function resolveFeedUrl(feedUrl, now) {
  if (feedUrl !== DEFAULT_FEED_URL) return feedUrl;
  const url = new URL(feedUrl);
  const date = new Date(now);
  url.searchParams.set("endMonth", `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  url.searchParams.set("kind", "reset");
  url.searchParams.set("months", "12");
  return url.toString();
}

export async function readTiboPublicSignal({
  feedUrl = process.env.CODEX_TIBO_FEED_URL || "",
  ttlMs = DEFAULT_CACHE_TTL_MS,
  now = Date.now(),
} = {}) {
  if (!feedUrl) return { status: "unavailable", stale: false };
  const nowMs = Number(now);
  const current = Number.isFinite(nowMs) ? nowMs : Date.now();
  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_CACHE_TTL_MS;
  if (cached && cached.expiresAt > current) return cached.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const feed = await fetchFeed(resolveFeedUrl(feedUrl, current));
      const targetIso = Array.isArray(feed?.history?.days)
        ? await fetchBetterOpcTarget().catch(() => null)
        : null;
      const value = classifyTiboFeed(feed, { now: current, targetIso });
      cached = { value: { ...value, stale: value.feedStale }, expiresAt: current + ttl };
      return cached.value;
    } catch (error) {
      if (cached) return { ...cached.value, stale: true };
      return { status: "unavailable", stale: true };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function mergeTiboUsage(usage, signal) {
  const base = usage && typeof usage === "object" ? usage : {};
  const hasNativeProbability = base.tiboProbability !== null
    && base.tiboProbability !== undefined
    && Number.isFinite(Number(base.tiboProbability));
  const hasPublicProbability = signal?.source === "betteropc"
    && Number.isFinite(Number(signal?.probability));
  if ((!hasPublicProbability && hasNativeProbability) || !Number.isFinite(Number(signal?.probability))) return base;
  const merged = { ...base, tiboProbability: clamp(Number(signal.probability)) };
  if (signal?.source === "betteropc") {
    merged.tiboExpectedAt = signal.tiboExpectedAt || null;
    merged.tiboResetAt = signal.tiboExpectedAt || null;
    merged.tiboSummary = signal.tiboSummary || signal.summary || null;
    merged.tiboEvidenceUrl = signal.tiboEvidenceUrl || signal.originalUrl || DEFAULT_PAGE_URL;
  }
  return merged;
}

export function resetTiboPublicFeedCache() {
  cached = null;
  inFlight = null;
}
