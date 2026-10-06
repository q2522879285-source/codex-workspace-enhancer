import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { presentRateLimit } from "../lib/usage-data.mjs";

class Element {
  constructor(tag = "div") {
    this.tag = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false;
    this.style = { setProperty() {}, removeProperty() {} };
  }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  appendChild(node) { this.append(node); }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
  setAttribute(key, value) {
    this.attributes[key] = value;
    if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener() {}
  cloneNode() { const node = new Element(this.tag); Object.assign(node, { target: this.target, rel: this.rel }); return node; }
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.className === selector.slice(1);
    const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (!match) return false;
    const key = match[1].replace(/^data-/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = match[1].startsWith("data-") ? this.dataset[key] : this.attributes[match[1]];
    return value !== undefined && (match[2] === undefined || value === match[2]);
  }
  querySelector(selector) {
    const space = selector.indexOf(" ");
    if (space >= 0) return this.querySelector(selector.slice(0, space))?.querySelector(selector.slice(space + 1)) || null;
    for (const child of this.children) { if (child.matches(selector)) return child; const found = child.querySelector(selector); if (found) return found; }
    return null;
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  getBoundingClientRect() { return { left: 0, right: 340 }; }
  remove() { this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
}

async function fixture(input) {
  const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
  const root = new Element(), host = new Element(); host.className = "app-shell-left-panel"; root.append(host);
  const document = { createElement: tag => new Element(tag), getElementById: id => root.querySelector(`#${id}`), querySelector: selector => root.querySelector(selector) };
  const constants = source.split(/\r?\n/).filter(line => /^  const (USAGE_[A-Z_]+|TIBO_HEADER_ID) = "/.test(line)).join("\n");
  const begin = source.indexOf("  function updateUsageState() {");
  const end = source.indexOf("  const NATIVE_HELP_MENU_TRIGGER_ID", begin);
  assert.ok(begin >= 0 && end > begin);
  const context = vm.createContext({ document, innerWidth: 1000, RUNTIME_TOKEN: "demo-runtime", usage: presentRateLimit(input) });
  vm.runInContext(constants + "\n" + source.slice(begin, end), context);
  context.ensureUsageStatus(host);
  return { context, root, detail: key => root.querySelector(`[data-tibo-detail="${key}"]`), header: document.getElementById("codex-tibo-probability-header") };
}

const challenge = {
  phase: "active", day: 2, totalDays: 28, status: "improvement", deadlineIso: "2026-10-06T17:00:00Z",
  remainingMinutes: 90, summary: "Demo daily improvement", eventAt: "2026-10-06T08:00:00Z",
  evidenceUrl: "https://example.com/today", announcementUrl: "https://example.com/announcement", stale: true,
};

test("Tibo disclosure renders challenge, distinct deadline, news, reason, signal and source links", async () => {
  const f = await fixture({ tiboProbability: 37, tiboChallenge: challenge,
    tiboNewsAt: "2026-10-06T09:00:00Z", tiboSummary: "Demo newest update", tiboEvidenceUrl: "https://example.com/news",
    tiboProbabilityReason: "Demo probability rule", tiboSignalSummary: "Demo upcoming reset", tiboSignalEvidenceUrl: "https://example.com/signal" });
  assert.equal(f.header.firstElementChild.textContent, "Tibo");
  assert.equal(f.header.querySelector(".codex-conversation-usage-tibo-probability-value").textContent, "37%");
  assert.equal(f.header.querySelector("[data-tibo-daily-status]").textContent, "· 已改进");
  assert.match(f.detail("challenge").textContent, /第 2\/28 天/);
  assert.match(f.detail("promise").textContent, /每天推出一项/);
  assert.match(f.detail("daily").textContent, /已改进，尚未全面重置/);
  assert.match(f.detail("deadline").textContent, /10月7日 01:00/);
  assert.equal(f.detail("remaining").textContent, "1小时30分钟");
  assert.equal(f.detail("expected").textContent, "未公布具体时间");
  assert.match(f.detail("posted").textContent, /10月6日 17:00/);
  assert.match(f.detail("reason").textContent, /Demo probability rule/);
  assert.match(f.detail("signal").textContent, /Demo upcoming reset/);
  assert.match(f.detail("stale").textContent, /最近可用记录/);
  for (const [key, tail] of [["link", "news"], ["today-link", "today"], ["announcement", "announcement"], ["signal-link", "signal"]]) {
    assert.equal(f.detail(key).href, `https://example.com/${tail}`); assert.equal(f.detail(key).hidden, false);
  }
  const panel = f.header.querySelector(".codex-conversation-usage-tibo-details-panel");
  const button = f.header.querySelector(".codex-conversation-usage-tibo-details-button");
  assert.equal(panel.style.width, "316px"); assert.equal(panel.style.left, "12px");
  button.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(panel.hidden, false); assert.equal(button.attributes["aria-expanded"], "true");
  button.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(panel.hidden, true); assert.equal(button.attributes["aria-expanded"], "false");
});

test("Tibo daily reset and waiting labels update, absent fields hide, and explicit zero remains zero", async () => {
  const f = await fixture({ tiboProbability: 0, tiboChallenge: { ...challenge, status: "reset", stale: false }, tiboResetAt: "2026-10-06T12:00:00Z" });
  assert.equal(f.detail("daily").textContent, "已全面重置");
  assert.equal(f.header.querySelector(".codex-conversation-usage-tibo-probability-value").textContent, "0%");
  assert.match(f.detail("expected").textContent, /10月6日/);
  assert.equal(f.detail("stale").hidden, true); assert.equal(f.detail("signal").hidden, true);
  f.context.usage = presentRateLimit({ tiboChallenge: { ...challenge, status: "waiting" }, tiboProbability: null });
  f.context.updateUsageState();
  assert.match(f.detail("daily").textContent, /等待今日更新/);
  assert.equal(f.header.querySelector(".codex-conversation-usage-tibo-probability-value").textContent, "--");
  assert.match(f.header.attributes["aria-label"], /概率 --/);
  f.context.usage = presentRateLimit({ tiboChallenge: challenge, tiboEvidenceUrl: challenge.announcementUrl });
  f.context.updateUsageState();
  assert.equal(f.detail("announcement").hidden, true);
});

test("unconfigured and unavailable signals stay unknown and remove prior detail content", async () => {
  const f = await fixture({ tiboProbability: 25, tiboChallenge: challenge });
  for (const input of [null, { tiboProbability: null }, { status: "unavailable", stale: true }, { tiboFeedStale: true }]) {
    const presentation = presentRateLimit(input);
    assert.equal(presentation.tiboProbability, null); assert.equal(presentation.tiboProbabilityText, "--");
    f.context.usage = presentation; f.context.updateUsageState();
    assert.equal(f.header.firstElementChild.textContent, "Tibo 概率");
    assert.equal(f.header.querySelector(".codex-conversation-usage-tibo-probability-value").textContent, "--");
    assert.equal(f.header.querySelector("[data-tibo-daily-status]").hidden, true);
    assert.equal(f.header.querySelector(".codex-conversation-usage-tibo-details").hidden, true);
    assert.equal(f.header.querySelector(".codex-conversation-usage-tibo-details-button").disabled, true);
    assert.equal(f.detail("link").hidden, true); assert.equal(f.detail("announcement").hidden, true);
  }
});

test("a partial feed refresh exposes stale history even when no challenge exists", async () => {
  const input = { tiboProbability: 50, tiboSummary: "Latest available history record",
    tiboEvidenceUrl: "https://example.com/history", tiboChallenge: null, tiboFeedStale: true };
  const presentation = presentRateLimit(input);
  assert.equal(presentation.tiboFeedStale, true);
  assert.equal(presentation.tiboChallengeStale, false);
  const f = await fixture(input);
  assert.equal(f.header.querySelector(".codex-conversation-usage-tibo-details").hidden, false);
  assert.equal(f.detail("stale").hidden, false);
  assert.equal(f.detail("stale").textContent, "数据未完整刷新，显示最近可用记录");
  assert.equal(f.detail("challenge").hidden, true);
  assert.equal(f.detail("link").href, input.tiboEvidenceUrl);
  f.context.usage = presentRateLimit({ ...input, tiboFeedStale: false });
  f.context.updateUsageState();
  assert.equal(f.detail("stale").hidden, true);
});
