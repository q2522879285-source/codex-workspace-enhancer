import { spawn } from "node:child_process";

let clientPromise = null;
let activeClient = null;

function executable() {
  return process.env.CODEX_APP_SERVER_BIN || "codex.exe";
}

function normalizeTimestamp(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function normalizePercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : null;
}

function normalizeRateLimits(response) {
  const root = response?.result || response;
  const limits = root?.rateLimitsByLimitId?.codex || root?.rateLimits;
  const primary = limits?.primary;
  const usedPercent = Number(primary?.usedPercent);
  const windowMinutes = Number(primary?.windowDurationMins);
  if (!Number.isFinite(usedPercent) || !Number.isFinite(windowMinutes) || windowMinutes <= 0) return null;
  const resetsAtSeconds = Number(primary?.resetsAt);
  const credits = root?.rateLimitResetCredits;
  const resetCreditsAvailable = Number(credits?.availableCount);
  return {
    limitId: String(limits.limitId || "codex"),
    planType: limits.planType ? String(limits.planType) : null,
    usedPercent,
    remainingPercent: Math.round(100 - usedPercent),
    windowMinutes,
    resetsAt: Number.isFinite(resetsAtSeconds) && resetsAtSeconds > 0
      ? new Date(resetsAtSeconds * 1000).toISOString()
      : null,
    tiboResetAt: normalizeTimestamp(root?.tiboResetAt),
    tiboExpectedAt: normalizeTimestamp(root?.tiboExpectedAt),
    tiboProbability: normalizePercent(root?.tiboProbability),
    resetCreditsAvailable: Number.isFinite(resetCreditsAvailable) && resetCreditsAvailable >= 0
      ? Math.floor(resetCreditsAvailable)
      : null,
    resetCredits: Array.isArray(credits?.credits)
      ? credits.credits.map((credit) => ({
          id: typeof credit?.id === "string" ? credit.id : null,
          status: typeof credit?.status === "string" ? credit.status : "unknown",
          resetType: typeof credit?.resetType === "string" ? credit.resetType : null,
          title: typeof credit?.title === "string" ? credit.title : null,
          description: typeof credit?.description === "string" ? credit.description : null,
          grantedAt: Number.isFinite(Number(credit?.grantedAt))
            ? new Date(Number(credit.grantedAt) * 1000).toISOString()
            : null,
          expiresAt: Number.isFinite(Number(credit?.expiresAt))
            ? new Date(Number(credit.expiresAt) * 1000).toISOString()
            : null,
        }))
      : null,
  };
}

function createClient() {
  return new Promise((resolve, reject) => {
    const child = spawn(executable(), ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    let buffer = "";
    let nextId = 1;
    let settled = false;
    const pending = new Map();

    const fail = (error) => {
      for (const request of pending.values()) request.reject(error);
      pending.clear();
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const request = (method, params, timeoutMs = 5000) => new Promise((requestResolve, requestReject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        requestReject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); requestResolve(value); },
        reject: (error) => { clearTimeout(timer); requestReject(error); },
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) {
          pending.delete(id);
          clearTimeout(timer);
          requestReject(error);
        }
      });
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (!Number.isInteger(message?.id)) continue;
        const current = pending.get(message.id);
        if (!current) continue;
        pending.delete(message.id);
        if (message.error) current.reject(new Error(message.error.message || "Codex app-server error"));
        else current.resolve(message);
      }
    });
    child.on("error", fail);
    child.on("exit", (code, signal) => fail(new Error(`Codex app-server exited (${code ?? "?"}/${signal || "?"})`)));

    (async () => {
      try {
        await request("initialize", { clientInfo: { name: "codex-sidebar-enhancer", version: "1.0" } });
        child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
        const read = async () => normalizeRateLimits(await request("account/rateLimits/read", null));
        activeClient = { child, read };
        if (!settled) {
          settled = true;
          resolve(activeClient);
        }
      } catch (error) {
        fail(error);
        try { child.kill(); } catch {}
      }
    })();
  });
}

export async function readNativeRateLimits() {
  try {
    if (!clientPromise) clientPromise = createClient();
    const client = await clientPromise;
    return await client.read();
  } catch {
    clientPromise = null;
    activeClient = null;
    return null;
  }
}

export function closeNativeRateLimits() {
  try { activeClient?.child.kill(); } catch {}
  activeClient = null;
  clientPromise = null;
}
