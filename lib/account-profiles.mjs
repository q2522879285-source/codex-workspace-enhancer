import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./task-context-store.mjs";

const DEFAULT_ROOT = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "CodexSidebarEnhancer")
  : join(homedir(), ".codex-sidebar-enhancer");

function jwtPayload(token) {
  try {
    const part = String(token).split(".")[1];
    return part ? JSON.parse(Buffer.from(part, "base64url").toString("utf8")) : {};
  } catch { return {}; }
}

function publicProfile(profile) {
  const { tokens: _tokens, ...safe } = profile;
  return safe;
}

export class AccountProfileStore {
  constructor({ root = DEFAULT_ROOT, authPath = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json") } = {}) {
    this.path = join(root, "account-profiles.json");
    this.authPath = authPath;
  }

  read() {
    const state = readJson(this.path) || {};
    return { activeProfileId: typeof state.activeProfileId === "string" ? state.activeProfileId : null,
      profiles: Array.isArray(state.profiles) ? state.profiles.filter(item => item && typeof item.id === "string") : [] };
  }

  currentAuth() {
    if (!existsSync(this.authPath)) return null;
    let auth;
    try { auth = JSON.parse(readFileSync(this.authPath, "utf8")); } catch { return null; }
    const tokens = auth?.tokens;
    if (!tokens || typeof tokens !== "object") return null;
    const payload = jwtPayload(tokens.id_token || tokens.access_token);
    const accountId = tokens.account_id || payload["https://api.openai.com/auth"]?.chatgpt_account_id || payload.sub;
    if (!accountId) return null;
    return {
      id: String(accountId), accountId: String(accountId),
      email: payload.email || null, name: payload.name || null,
      authProvider: payload.auth_provider || null,
      updatedAt: new Date().toISOString(),
      tokens: { ...tokens },
    };
  }

  syncCurrent() {
    const current = this.currentAuth();
    const state = this.read();
    if (!current) return state;
    const index = state.profiles.findIndex(item => item.id === current.id);
    if (index >= 0) state.profiles[index] = { ...state.profiles[index], ...current, tokens: current.tokens };
    else state.profiles.push(current);
    state.activeProfileId = current.id;
    writeJsonAtomic(this.path, state);
    return state;
  }

  list() {
    const state = this.syncCurrent();
    return { activeProfileId: state.activeProfileId, profiles: state.profiles.map(publicProfile) };
  }

  upsert(input = {}) {
    const state = this.syncCurrent();
    const id = String(input.id || input.accountId || input.email || "").trim();
    if (!id) throw Error("账号 profile 缺少 id");
    const index = state.profiles.findIndex(item => item.id === id);
    const previous = index >= 0 ? state.profiles[index] : {};
    const next = { ...previous, ...input, id, updatedAt: new Date().toISOString() };
    if (input.tokens && typeof input.tokens === "object") next.tokens = { ...input.tokens };
    else if (previous.tokens) next.tokens = previous.tokens;
    state.profiles[index >= 0 ? index : state.profiles.length] = next;
    writeJsonAtomic(this.path, state);
    return publicProfile(next);
  }

  profile(id) {
    const state = this.syncCurrent();
    return state.profiles.find(item => item.id === String(id)) || null;
  }

  persist(profile) {
    if (!profile?.id || !profile.tokens?.access_token && !profile.tokens?.id_token) {
      throw Error("账号 profile 缺少 token");
    }
    const auth = readJson(this.authPath) || {};
    auth.auth_mode = auth.auth_mode || "chatgpt";
    auth.tokens = { ...profile.tokens };
    writeJsonAtomic(this.authPath, auth);
    const state = this.read();
    const index = state.profiles.findIndex(item => item.id === profile.id);
    if (index >= 0) state.profiles[index] = { ...state.profiles[index], ...profile };
    else state.profiles.push(profile);
    state.activeProfileId = profile.id;
    writeJsonAtomic(this.path, state);
    return publicProfile(profile);
  }

  switchProfile(id) {
    const profile = this.profile(id);
    if (!profile) throw Error("账号 profile 不存在");
    return this.persist(profile);
  }
}
