#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

async function connectWhenReady(timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await connectMainCodex(9231);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  throw lastError || new Error("Codex renderer did not become available");
}

const client = await connectWhenReady();

try {
  const deadline = Date.now() + 8_000;
  while (!await client.evaluate(`(() => {
    const names = Array.from(document.querySelectorAll("#codex-sidebar-shortcut-grid [data-codex-sidebar-shortcut-card]"))
      .map((button) => button.dataset.codexSidebarShortcutName);
    const sourceNames = Array.from(document.querySelectorAll("[data-codex-sidebar-shortcut-source-name]"))
      .map((button) => button.dataset.codexSidebarShortcutSourceName);
    return names.includes("Skill 管理")
      && names.includes("资产控制台")
      && !names.includes("站点")
      && !names.includes("插件")
      && sourceNames.every((name) => names.includes(name));
  })()`)) {
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const actual = await client.evaluate(`(() => {
    const grid = document.getElementById("codex-sidebar-shortcut-grid");
    if (!grid) return null;
    const cards = Array.from(grid.querySelectorAll(":scope > [data-codex-sidebar-shortcut-card-wrap]"));
    const metrics = cards.map((wrap) => {
      const button = wrap.querySelector("[data-codex-sidebar-shortcut-card]");
      const icon = button?.querySelector(".codex-sidebar-shortcut-icon");
      const label = button?.querySelector(".codex-sidebar-shortcut-label");
      const cardRect = button?.getBoundingClientRect();
      const iconRect = icon?.getBoundingClientRect();
      const labelRect = label?.getBoundingClientRect();
      return {
        name: button?.dataset.codexSidebarShortcutName,
        width: cardRect?.width || 0,
        height: cardRect?.height || 0,
        top: cardRect?.top || 0,
        left: cardRect?.left || 0,
        iconBeforeLabel: Boolean(iconRect && labelRect && iconRect.bottom <= labelRect.top),
        hasImage: Boolean(icon?.querySelector("svg, img")),
        ariaLabel: button?.getAttribute("aria-label"),
      };
    });

    const proxy = grid.querySelector('[data-codex-sidebar-shortcut-name="已安排"]');
    const source = document.querySelector('[data-codex-sidebar-shortcut-source-name="已安排"]');
    let forwardedClicks = 0;
    if (proxy && source) {
      const originalClick = source.click;
      source.click = () => { forwardedClicks += 1; };
      try { proxy.click(); } finally { source.click = originalClick; }
    }

    const overflowClones = [];
    while (grid.children.length < cards.length + 1 && cards[0]) {
      const clone = cards[0].cloneNode(true);
      grid.appendChild(clone);
      overflowClones.push(clone);
    }
    const overflowTop = grid.children[cards.length]
      ?.querySelector("[data-codex-sidebar-shortcut-card]")
      ?.getBoundingClientRect().top || 0;
    overflowClones.forEach((clone) => clone.remove());

    const sourceNames = Array.from(document.querySelectorAll("[data-codex-sidebar-shortcut-source-name]"))
      .map((node) => node.dataset.codexSidebarShortcutSourceName);
    return {
      role: grid.getAttribute("role"),
      ariaLabel: grid.getAttribute("aria-label"),
      columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length,
      cards: metrics,
      sourceNames,
      sourcesHidden: Array.from(document.querySelectorAll("[data-codex-sidebar-shortcut-source-hidden], [data-codex-sidebar-shortcut-source-group-hidden]"))
        .every((node) => getComputedStyle(node).display === "none"),
      forwardedClicks,
      overflowTop,
      firstRowTop: metrics[0]?.top || 0,
      quickAction: Boolean(grid.querySelector('[data-codex-sidebar-shortcut-quick="true"]')),
      scheduledStatus: Boolean(grid.querySelector('[data-codex-sidebar-shortcut-name="已安排"]')
        ?.closest("[data-codex-sidebar-shortcut-card-wrap]")
        ?.querySelector(".codex-sidebar-shortcut-status")),
    };
  })()`);

  assert.ok(actual, "shortcut card grid must exist");
  assert.equal(actual.role, "group");
  assert.equal(actual.ariaLabel, "快捷入口");
  assert.equal(actual.columns, actual.cards.length);
  const expectedCards = ["新对话", "拉取请求", "已安排", "Skill 管理", "项目管理", "资产控制台"];
  assert.deepEqual(actual.cards.map((card) => card.name), expectedCards.filter((name) => actual.cards.some((card) => card.name === name)));
  assert.equal(actual.cards.some((card) => card.name === "站点" || card.name === "插件"), false);
  assert.ok(actual.cards.some((card) => card.name === "Skill 管理"));
  assert.ok(actual.sourceNames.length >= 4, "the stable native sources must remain available behind the focused shortcuts");
  assert.ok(actual.sourceNames.every((name) => actual.cards.some((card) => card.name === name)));
  assert.ok(Math.max(...actual.cards.map((card) => card.top)) - Math.min(...actual.cards.map((card) => card.top)) <= 1);
  assert.equal(new Set(actual.cards.map((card) => card.width)).size, 1);
  assert.ok(actual.cards.every((card) => card.height >= 62));
  assert.ok(actual.cards.every((card) => card.hasImage && card.iconBeforeLabel));
  assert.ok(actual.cards.every((card) => card.ariaLabel));
  assert.equal(actual.sourcesHidden, true);
  assert.equal(actual.forwardedClicks, 1);
  assert.ok(actual.overflowTop > actual.firstRowTop, "one extra card must wrap to a second row");
  assert.equal(actual.scheduledStatus, true);

  await client.evaluate(`document.querySelector('[data-codex-sidebar-shortcut-name="Skill 管理"]')?.click()`);
  const skillsDeadline = Date.now() + 4_000;
  let skillManagerOpened = false;
  while (Date.now() < skillsDeadline) {
    skillManagerOpened = await client.evaluate(`Array.from(document.querySelectorAll("button")).some((button) =>
      button.textContent?.trim() === "技能"
      && button.getAttribute("aria-pressed") === "true"
      && button.getBoundingClientRect().width > 0
      && !button.closest("#codex-sidebar-shortcut-grid")
    )`);
    if (skillManagerOpened) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.equal(skillManagerOpened, true, "Skill 管理 must open the native Skills page directly");
  await client.evaluate(`(() => {
    const active = document.querySelector('[data-app-action-sidebar-thread-active="true"], [data-app-action-sidebar-thread-selected="true"]');
    (active?.matches('button,[role="button"]') ? active : active?.querySelector('button,[role="button"]'))?.click();
  })()`);

  process.stdout.write(`${JSON.stringify({ ...actual, skillManagerOpened }, null, 2)}\n`);
} finally {
  client.close();
}
