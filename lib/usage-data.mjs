function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, number));
}

function normalizeWindow(value) {
  const usedPercent = clampPercent(value?.used_percent);
  const windowMinutes = Number(value?.window_minutes);
  if (usedPercent == null || !Number.isFinite(windowMinutes) || windowMinutes <= 0) return null;
  const resetsAtSeconds = Number(value?.resets_at);
  const resetsAt = Number.isFinite(resetsAtSeconds) && resetsAtSeconds > 0
    ? new Date(resetsAtSeconds * 1000).toISOString()
    : null;
  return { usedPercent, windowMinutes, resetsAt };
}

export function parseRateLimitSnapshot(lines) {
  let latest = null;
  let latestAccountWide = null;
  let fallback = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || "").trim();
    if (!line.includes('"token_count"') || !line.includes('"rate_limits"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "event_msg" || entry.payload?.type !== "token_count") continue;
    const limits = entry.payload.rate_limits;
    const windows = [normalizeWindow(limits?.primary), normalizeWindow(limits?.secondary)].filter(Boolean);
    if (!windows.length) continue;
    const governing = windows.reduce((current, candidate) => (
      candidate.usedPercent > current.usedPercent ? candidate : current
    ));
    const observedAtMs = Date.parse(entry.timestamp || "");
    const snapshot = {
      observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : 0,
      usage: {
        limitId: String(limits.limit_id || "codex"),
        planType: limits.plan_type ? String(limits.plan_type) : null,
        usedPercent: governing.usedPercent,
        remainingPercent: Math.round(100 - governing.usedPercent),
        windowMinutes: governing.windowMinutes,
        resetsAt: governing.resetsAt,
      },
    };
    fallback = snapshot;
    if (Number.isFinite(observedAtMs) && (!latest || observedAtMs >= latest.observedAtMs)) {
      latest = snapshot;
    }
    if (snapshot.usage.limitId === "codex"
      && (!latestAccountWide || snapshot.observedAtMs >= latestAccountWide.observedAtMs)) {
      latestAccountWide = snapshot;
    }
  }
  // The desktop log can contain both the account-wide Codex allowance and
  // newer model-specific allowances (for example Codex Spark). The sidebar's
  // single "weekly remaining" value represents the account-wide allowance,
  // so a newer model-specific event must not overwrite it.
  return latestAccountWide || latest || fallback;
}

export function parseRateLimitLines(lines) {
  return parseRateLimitSnapshot(lines)?.usage || null;
}

function windowLabel(minutes) {
  if (minutes === 10_080) return "本周";
  if (minutes === 1_440) return "今日";
  if (minutes % 60 === 0) return `${minutes / 60}小时`;
  return `${minutes}分钟`;
}

function resetLabel(value, timeZone) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${Number(part("month"))}月${Number(part("day"))}日 ${part("hour")}:${part("minute")}`;
}

function availableResetCredit(usage) {
  const credits = Array.isArray(usage?.resetCredits) ? usage.resetCredits : [];
  return credits
    .filter((credit) => credit?.status === "available")
    .sort((left, right) => Date.parse(left?.expiresAt || "") - Date.parse(right?.expiresAt || ""))[0] || null;
}

export function presentRateLimit(usage, { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const remainingPercent = clampPercent(usage?.remainingPercent);
  const resetCreditsAvailable = Number.isFinite(Number(usage?.resetCreditsAvailable))
    && Number(usage.resetCreditsAvailable) >= 0
    ? Math.floor(Number(usage.resetCreditsAvailable))
    : null;
  const resetAt = resetLabel(usage?.resetsAt, timeZone) || null;
  const credit = availableResetCredit(usage);
  const resetCardExpiryAt = resetLabel(credit?.expiresAt, timeZone) || null;
  const normalResetText = resetAt || "--";
  const resetCardText = resetCreditsAvailable == null ? "--" : `${resetCreditsAvailable} 次`;
  const resetCardExpiryText = resetCardExpiryAt || "--";
  const tiboResetAt = resetLabel(usage?.tiboResetAt || usage?.tiboExpectedAt, timeZone) || null;
  const tiboResetText = tiboResetAt || "--";
  const tiboAvailable = Boolean(tiboResetAt);
  const tiboProbability = clampPercent(usage?.tiboProbability);
  const tiboProbabilityText = tiboProbability === null ? "--" : `${Math.round(tiboProbability)}%`;
  const tiboAria = tiboAvailable ? `，Tibo预计 ${tiboResetAt}` : "";
  const tiboSummary = typeof usage?.tiboSummary === "string" ? usage.tiboSummary : "";
  const tiboEvidenceUrl = typeof usage?.tiboEvidenceUrl === "string" ? usage.tiboEvidenceUrl : "";
  const resetCreditsText = resetCreditsAvailable == null
    ? "可用重置 --"
    : `可用重置 ${resetCreditsAvailable} 次`;
  const resetText = resetAt ? `预计 ${resetAt}` : "预计 --";
  if (remainingPercent == null) {
    return {
      available: false,
      text: "剩余量 --",
      remainingPercent: null,
      tone: "muted",
      resetCreditsAvailable,
      resetCreditsText,
      resetText,
      normalResetText,
      resetCardText,
      resetCardExpiryText,
      tiboResetText,
      tiboAvailable,
      tiboProbability,
      tiboProbabilityText,
      tiboSummary,
      tiboEvidenceUrl,
      ariaLabel: `Codex 剩余量暂不可用，正常重置 ${normalResetText}，重置卡 ${resetCardText}，Tibo概率 ${tiboProbabilityText}${tiboAria}`,
    };
  }
  const period = windowLabel(Number(usage.windowMinutes));
  const roundedRemaining = Math.round(remainingPercent);
  const tone = roundedRemaining <= 10 ? "critical" : roundedRemaining <= 30 ? "warning" : "normal";
  return {
    available: true,
    text: `${period}剩余 ${roundedRemaining}%`,
    remainingPercent: roundedRemaining,
    tone,
    resetCreditsAvailable,
    resetCreditsText,
    resetText,
    normalResetText,
    resetCardText,
    resetCardExpiryText,
    tiboResetText,
    tiboAvailable,
    tiboProbability,
    tiboProbabilityText,
    tiboSummary,
    tiboEvidenceUrl,
    ariaLabel: `Codex ${period}额度剩余 ${roundedRemaining}%，正常重置 ${normalResetText}，重置卡 ${resetCardText}，Tibo概率 ${tiboProbabilityText}${tiboAria}`,
  };
}
