import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n  function ", start + 1));
}

test("ordinary task keeps primary actions; project layout and every original item survive", () => {
  const layout = new Function(`${extract("shortcutLayout")} return shortcutLayout;`)();
  const items = ["新对话", "拉取请求", "已安排", "Skill 管理", "项目管理", "资产控制台"]
    .map((name) => ({ name, ...(name === "资产控制台" ? { panelKind: "asset" } : {}) }));
  const compact = layout(items, true);
  assert.deepEqual(compact.primary.map((item) => item.name), ["新对话"]);
  assert.deepEqual(compact.overflow, items.slice(1, -1));
  assert.deepEqual(layout(items, false), { primary: items, overflow: [] });
  assert.deepEqual(layout(items.slice(0, -1), true).primary, [items[0]]);
  assert.match(extract("ensureShortcutGrid"), /const compact = isTaskShell\(\)/);
  assert.match(extract("clearShortcutEnhancement"), /__codexShortcutMoreCleanup/);
});

test("more reuses cards, closes on action, outside pointer and Escape, cleans up listeners", () => {
  class Element extends EventTarget {
    dataset = {};
    children = [];
    open = false;
    attributes = {};
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...children) { this.children.push(...children); }
    contains(target) { return this === target || this.children.some((child) => child.contains?.(target)); }
    focus() { this.focused = true; }
  }
  const document = new EventTarget();
  document.createElement = () => new Element();
  const cards = [];
  const createCard = (item) => { cards.push(item); return new Element(); };
  const make = new Function("document", "createShortcutCard", `${extract("createShortcutOverflow")} return createShortcutOverflow;`)(document, createCard);
  const grid = {};
  const items = [{ name: "已安排" }, { name: "Skill 管理" }];
  const details = make(items, grid);
  const [summary, content] = details.children;
  assert.deepEqual(cards, items);
  assert.equal(summary.textContent, "⋯");
  assert.equal(summary.attributes['aria-label'], "更多快捷入口");
  assert.equal(summary.title, "更多");
  details.open = true;
  const click = new Event("click");
  content.closest = () => ({});
  document.activeElement = content.children[0];
  content.dispatchEvent(click);
  assert.equal(details.open, false);
  assert.equal(summary.focused, true);
  summary.focused = false;
  details.open = true;
  const escape = new Event("keydown", { cancelable: true });
  escape.key = "Escape";
  document.dispatchEvent(escape);
  assert.equal(details.open, false);
  assert.equal(summary.focused, true);
  assert.equal(escape.defaultPrevented, true);
  details.open = true;
  summary.focused = false;
  const release = new Event("keyup", { cancelable: true });
  release.key = "Escape";
  // The app's window capture may swallow keydown entirely.
  document.dispatchEvent(release);
  assert.equal(details.open, false);
  assert.equal(summary.focused, true);
  assert.equal(release.defaultPrevented, true);
  details.open = true;
  document.dispatchEvent(new Event("pointerdown"));
  assert.equal(details.open, false);
  grid.__codexShortcutMoreCleanup();
  details.open = true;
  document.dispatchEvent(new Event("pointerdown"));
  assert.equal(details.open, true);
  document.dispatchEvent(release);
  assert.equal(details.open, true);
});

test("task shortcuts share one compact row with an anchored narrow overflow list", () => {
  assert.match(source, /\[data-codex-shortcut-compact="true"\]:has\(> \[data-codex-shortcut-more\]\)\s*\{\s*grid-template-columns: repeat\(var\(--codex-sidebar-shortcut-columns, 2\), minmax\(0, 1fr\)\) 30px;/);
  assert.match(source, /\[data-codex-shortcut-more-items\]\s*\{[^}]*position: absolute;[^}]*top: calc\(100% \+ 4px\);[^}]*width: min\(190px, calc\(100% - 16px\)\);/);
  assert.match(source, /\[data-codex-shortcut-compact="true"\] \.\$\{SHORTCUT_CARD_CLASS\}\s*\{[^}]*height: 32px;[^}]*flex-direction: row;/);
});
