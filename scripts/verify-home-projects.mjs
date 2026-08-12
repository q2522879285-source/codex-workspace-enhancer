#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

const STATE_KEY = "codex-conversation-preview:home-projects-state";
const CURRENT_THREAD_ID = process.env.CODEX_THREAD_ID || "019fe64a-ace1-7793-92aa-4d91195005ec";
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(client, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await client.evaluate(expression)) return true;
    } catch {}
    await wait(80);
  }
  return false;
}

const [projectResponse, taskResponse] = await Promise.all([
  fetch("http://127.0.0.1:47823/api/projects"),
  fetch("http://127.0.0.1:47823/api/tasks"),
]);
assert.equal(projectResponse.ok, true);
assert.equal(taskResponse.ok, true);
const projects = (await projectResponse.json()).projects;
const tasks = (await taskResponse.json()).tasks;
const projectNames = new Map(projects.map((project) => [project.id, project.name]));
const activeTasks = tasks.filter((task) => task.status === "in_progress" && THREAD_ID_PATTERN.test(task.threadId || ""));
const expectedProjectIds = [...new Set(activeTasks.map((task) => task.projectId))].sort();

const client = await connectMainCodex(9231);
let originalState = null;

try {
  originalState = await client.evaluate(`localStorage.getItem(${JSON.stringify(STATE_KEY)})`);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-shortcut-name="新对话"]')?.click()`);
  assert.equal(
    await waitFor(client, `Boolean(document.getElementById("codex-home-project-shelf"))`, 8_000),
    true,
    "the current-project shelf must be rendered on the Codex home page",
  );

  const actual = await client.evaluate(`(() => {
    const shelf = document.getElementById("codex-home-project-shelf");
    const grid = shelf?.querySelector("[data-codex-home-project-grid]");
    const cards = Array.from(shelf?.querySelectorAll("[data-codex-home-project-card]") || []);
    return {
      role: shelf?.getAttribute("role"),
      ariaLabel: shelf?.getAttribute("aria-label"),
      gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length : 0,
      projectIds: cards.map((card) => card.dataset.codexHomeProjectId),
      cards: cards.map((card) => ({
        projectId: card.dataset.codexHomeProjectId,
        projectName: card.querySelector("[data-codex-home-project-name]")?.textContent.trim(),
        taskTitle: card.querySelector("[data-codex-home-project-task]")?.textContent.trim(),
        status: card.querySelector("[data-codex-home-project-status]")?.textContent.trim(),
        openLabel: card.querySelector("[data-codex-home-project-open]")?.getAttribute("aria-label"),
        pinLabel: card.querySelector("[data-codex-home-project-pin]")?.getAttribute("aria-label"),
        pinPressed: card.querySelector("[data-codex-home-project-pin]")?.getAttribute("aria-pressed"),
      })),
    };
  })()`);

  assert.equal(actual.role, "region");
  assert.equal(actual.ariaLabel, "当前项目");
  assert.ok(actual.gridColumns >= 2);
  const actualActiveProjectIds = actual.cards
    .filter((card) => card.status === "执行中")
    .map((card) => card.projectId)
    .sort();
  assert.deepEqual(actualActiveProjectIds, expectedProjectIds);
  assert.ok(actual.cards.every((card) => card.projectName === projectNames.get(card.projectId)));
  assert.ok(actual.cards.every((card) => card.taskTitle && ["执行中", "待查看", "已钉住"].includes(card.status)));
  assert.ok(actual.cards.every((card) => card.openLabel?.includes("打开") && card.pinLabel?.includes("钉住")));
  assert.ok(actual.cards.every((card) => card.pinPressed === "false"));

  const pinProjectId = actual.projectIds[0];
  await client.evaluate(`document.querySelector('[data-codex-home-project-id=${JSON.stringify(pinProjectId)}] [data-codex-home-project-pin]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-home-project-id=${JSON.stringify(pinProjectId)}] [data-codex-home-project-pin]')?.getAttribute('aria-pressed') === 'true'`), true);

  await client.send("Page.reload", { ignoreCache: true });
  assert.equal(await waitFor(client, `Boolean(window.__codexConversationPreviewInjection__)`, 20_000), true);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-shortcut-name="新对话"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-home-project-id=${JSON.stringify(pinProjectId)}] [data-codex-home-project-pin]')?.getAttribute('aria-pressed') === 'true'`, 20_000), true,
    "pinned state must survive a renderer reload");
  await client.evaluate(`document.querySelector('[data-codex-home-project-id=${JSON.stringify(pinProjectId)}] [data-codex-home-project-pin]')?.click()`);

  const scheduledProject = activeTasks
    .filter((task) => projectNames.get(task.projectId) === "自动执行")
    .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""))[0];
  if (scheduledProject) {
    await client.evaluate(`document.querySelector('[data-codex-home-project-id=${JSON.stringify(scheduledProject.projectId)}] [data-codex-home-project-open]')?.click()`);
    assert.equal(await waitFor(client, `Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-active="true"]')).some((row) => (row.getAttribute('data-app-action-sidebar-thread-id') || '').endsWith(${JSON.stringify(scheduledProject.threadId)}))`, 12_000), true,
      "a card must navigate by Codex route even when the thread was not mounted in the sidebar");
  }

  process.stdout.write(`${JSON.stringify({ expectedProjectIds, actual }, null, 2)}\n`);
} finally {
  try {
    await client.evaluate(`(() => {
      const key = ${JSON.stringify(STATE_KEY)};
      const original = ${JSON.stringify(originalState)};
      if (original == null) localStorage.removeItem(key);
      else localStorage.setItem(key, original);
      window.postMessage({ type: "navigate-to-route", path: "/local/${CURRENT_THREAD_ID}" }, "*");
    })()`);
    await wait(600);
  } catch {}
  client.close();
}
