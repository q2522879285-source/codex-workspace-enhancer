import assert from "node:assert/strict";
import process from "node:process";
import WebSocket from "ws";

const port = Number(process.env.CODEX_DEBUG_PORT || 9231);
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page");
assert.ok(target?.webSocketDebuggerUrl, "Codex renderer is not available through CDP");

const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

socket.on("message", (data) => {
  const message = JSON.parse(data.toString());
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  return result.result.value;
}

await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const organizer = document.querySelector('#codex-skill-organizer');
  if (!organizer) return;
  const search = organizer.querySelector('input[type="search"]');
  if (search?.value) {
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const common = [...organizer.querySelectorAll('[data-codex-skill-filter]')]
    .find((node) => node.textContent === '常用');
  common?.click();
  const toggle = organizer.querySelector('.codex-skill-native-toggle');
  if (toggle?.textContent === '返回整理视图') toggle.click();
  await wait(80);
})()`);

const initial = await evaluate(`(() => {
  const organizer = document.querySelector('#codex-skill-organizer');
  const section = document.querySelector('#skills-installed');
  const extras = section ? [...section.parentElement.children].slice([...section.parentElement.children].indexOf(section) + 1) : [];
  return {
    organizer: !!organizer,
    title: organizer?.querySelector('h2')?.textContent,
    rows: organizer?.querySelectorAll('.codex-skill-row').length || 0,
    filters: organizer?.querySelectorAll('.codex-skill-filter').length || 0,
    installed: Number((organizer?.querySelector('.codex-skill-result-count')?.textContent || '').split('已安装').pop()?.trim() || 0),
    nativeHidden: section ? getComputedStyle(section).display === 'none' : false,
    extrasHidden: extras.every((node) => getComputedStyle(node).display === 'none'),
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  };
})()`);

assert.equal(initial.organizer, true, "skill organizer is missing");
assert.equal(initial.title, "Skill 工作台");
assert.ok(initial.rows >= 8 && initial.rows <= 12, `unexpected common skill count: ${initial.rows}`);
assert.equal(initial.filters, 8);
assert.ok(initial.installed >= 100, `installed catalog was not expanded: ${initial.installed}`);
assert.equal(initial.nativeHidden, true);
assert.equal(initial.extrasHidden, true);
assert.equal(initial.noHorizontalOverflow, true);

const keyboardFavorite = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const organizer = document.querySelector('#codex-skill-organizer');
  const favorite = organizer?.querySelector('.codex-skill-favorite');
  const name = favorite?.closest('.codex-skill-row')?.querySelector('.codex-skill-name')?.textContent;
  const before = favorite?.getAttribute('aria-pressed') === 'true';
  favorite?.focus();
  const focused = document.activeElement === favorite;
  const keyboardEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  const notIntercepted = favorite?.dispatchEvent(keyboardEvent) === true;
  await wait(30);
  const organizerPresentAfterKey = !!document.querySelector('#codex-skill-organizer');
  favorite?.click();
  await wait(40);
  const stored = JSON.parse(localStorage.getItem('codex-workspace-enhancer:skill-favorites-v1') || '[]');
  const toggled = name ? stored.includes(name) !== before : false;
  const restoredButton = [...(document.querySelectorAll('.codex-skill-row') || [])]
    .find((row) => row.querySelector('.codex-skill-name')?.textContent === name)
    ?.querySelector('.codex-skill-favorite');
  restoredButton?.click();
  await wait(30);
  return { focused, notIntercepted, organizerPresentAfterKey, toggled };
})()`);
assert.equal(keyboardFavorite.focused, true, "favorite button did not receive keyboard focus");
assert.equal(keyboardFavorite.notIntercepted, true, "favorite Enter key was intercepted by the Skill row");
assert.equal(keyboardFavorite.organizerPresentAfterKey, true, "favorite Enter key opened Skill details");
assert.equal(keyboardFavorite.toggled, true, "favorite button did not toggle after keyboard activation path");

const interaction = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const organizer = document.querySelector('#codex-skill-organizer');
  const search = organizer.querySelector('input[type="search"]');
  const filter = [...organizer.querySelectorAll('[data-codex-skill-filter]')].find((node) => node.textContent === '视频创作');
  filter.click();
  await wait(30);
  const filterFocusRetained = document.activeElement?.getAttribute('data-codex-skill-filter') === '视频创作';
  const videoCount = organizer.querySelectorAll('.codex-skill-row').length;
  const groupButtons = [...organizer.querySelectorAll('.codex-skill-group-toggle')];
  const groupLabels = groupButtons.map((node) => node.querySelector('.codex-skill-group-title')?.textContent);
  const collapsedByDefault = groupButtons.every((node) => node.getAttribute('aria-expanded') === 'false')
    && [...organizer.querySelectorAll('.codex-skill-group-items')].every((node) => node.hidden);
  const actionGroup = groupButtons.find((node) => node.querySelector('.codex-skill-group-title')?.textContent === '动作与打斗');
  actionGroup?.click();
  await wait(20);
  const actionExpanded = actionGroup?.getAttribute('aria-expanded') === 'true'
    && actionGroup?.nextElementSibling?.hidden === false
    && actionGroup?.nextElementSibling?.querySelectorAll('.codex-skill-row').length > 0;
  actionGroup?.click();
  await wait(20);
  const actionCollapsedAgain = actionGroup?.getAttribute('aria-expanded') === 'false'
    && actionGroup?.nextElementSibling?.hidden === true;
  search.value = '知识卡片生成器';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(30);
  const searchTitles = [...organizer.querySelectorAll('.codex-skill-name')].map((node) => node.textContent);
  organizer.querySelector('.codex-skill-search-clear').click();
  await wait(30);
  const queryCleared = search.value === '';

  const common = [...organizer.querySelectorAll('[data-codex-skill-filter]')].find((node) => node.textContent === '常用');
  common.click();
  await wait(30);
  const favorite = organizer.querySelector('.codex-skill-favorite');
  const favoriteName = favorite?.closest('.codex-skill-row')?.querySelector('.codex-skill-name')?.textContent;
  const before = favorite?.getAttribute('aria-pressed');
  favorite?.click();
  await wait(30);
  const storedAfterRemove = JSON.parse(localStorage.getItem('codex-workspace-enhancer:skill-favorites-v1') || '[]');
  const removed = favoriteName ? !storedAfterRemove.includes(favoriteName) : false;
  if (favoriteName) {
    const all = [...organizer.querySelectorAll('[data-codex-skill-filter]')].find((node) => node.textContent === '全部');
    all.click();
    await wait(30);
    const restoredButton = [...organizer.querySelectorAll('.codex-skill-row')]
      .find((row) => row.querySelector('.codex-skill-name')?.textContent === favoriteName)
      ?.querySelector('.codex-skill-favorite');
    restoredButton?.click();
    await wait(30);
  }
  const storedAfterRestore = JSON.parse(localStorage.getItem('codex-workspace-enhancer:skill-favorites-v1') || '[]');
  const restored = favoriteName ? storedAfterRestore.includes(favoriteName) : false;

  const nativeToggle = organizer.querySelector('.codex-skill-native-toggle');
  nativeToggle.click();
  await wait(30);
  const section = document.querySelector('#skills-installed');
  const extras = [...section.parentElement.children].slice([...section.parentElement.children].indexOf(section) + 1);
  const nativeShown = getComputedStyle(section).display !== 'none' && extras.some((node) => getComputedStyle(node).display !== 'none');
  nativeToggle.click();
  await wait(30);
  const nativeHiddenAgain = getComputedStyle(section).display === 'none' && extras.every((node) => getComputedStyle(node).display === 'none');
  return { videoCount, filterFocusRetained, groupLabels, collapsedByDefault, actionExpanded, actionCollapsedAgain, searchTitles, queryCleared, before, removed, restored, nativeShown, nativeHiddenAgain };
})()`);

assert.ok(interaction.videoCount > 0, "video category is empty");
assert.equal(interaction.filterFocusRetained, true, "filter focus was lost after switching categories");
assert.ok(interaction.groupLabels.length >= 4, `video category was not grouped: ${interaction.groupLabels.length}`);
assert.ok(interaction.groupLabels.includes("动作与打斗"), "action skills group is missing");
assert.equal(interaction.collapsedByDefault, true, "skill groups should start collapsed");
assert.equal(interaction.actionExpanded, true, "action skills group did not expand");
assert.equal(interaction.actionCollapsedAgain, true, "action skills group did not collapse again");
assert.deepEqual(interaction.searchTitles, ["知识卡片生成器"]);
assert.equal(interaction.queryCleared, true);
assert.equal(interaction.before, "true");
assert.equal(interaction.removed, true);
assert.equal(interaction.restored, true);
assert.equal(interaction.nativeShown, true);
assert.equal(interaction.nativeHiddenAgain, true);

const lateMount = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const organizer = document.querySelector('#codex-skill-organizer');
  const section = document.querySelector('#skills-installed');
  const lateExtra = document.createElement('div');
  lateExtra.dataset.codexSkillLateMountProbe = 'true';
  lateExtra.textContent = 'late source filter';
  section.parentElement.appendChild(lateExtra);
  await wait(350);
  const hiddenAfterMount = lateExtra.getAttribute('data-codex-skill-native-extra') === 'hidden'
    && getComputedStyle(lateExtra).display === 'none';
  const toggle = organizer.querySelector('.codex-skill-native-toggle');
  toggle.click();
  await wait(40);
  const shownWithNative = lateExtra.getAttribute('data-codex-skill-native-extra') === 'visible'
    && getComputedStyle(lateExtra).display !== 'none';
  toggle.click();
  await wait(40);
  const hiddenAgain = lateExtra.getAttribute('data-codex-skill-native-extra') === 'hidden'
    && getComputedStyle(lateExtra).display === 'none';
  lateExtra.remove();
  return { hiddenAfterMount, shownWithNative, hiddenAgain };
})()`);

assert.equal(lateMount.hiddenAfterMount, true, "late-mounted native source control was exposed");
assert.equal(lateMount.shownWithNative, true, "late-mounted native source control did not follow native toggle");
assert.equal(lateMount.hiddenAgain, true, "late-mounted native source control did not hide again");

const detail = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const organizer = document.querySelector('#codex-skill-organizer');
  const row = [...organizer.querySelectorAll('.codex-skill-row')]
    .find((candidate) => candidate.querySelector('.codex-skill-name')?.textContent === '知识卡片生成器');
  row?.click();
  await wait(160);
  const dialog = document.querySelector('[role="dialog"]');
  const opened = !!dialog && (dialog.textContent || '').includes('知识卡片生成器');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  return { opened };
})()`);

assert.equal(detail.opened, true, "custom skill row did not open the native detail dialog");
await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const organizer = document.querySelector('#codex-skill-organizer');
  const search = organizer?.querySelector('input[type="search"]');
  if (search?.value) {
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const common = [...(organizer?.querySelectorAll('[data-codex-skill-filter]') || [])]
    .find((node) => node.textContent === '常用');
  common?.click();
  const toggle = organizer?.querySelector('.codex-skill-native-toggle');
  if (toggle?.textContent === '返回整理视图') toggle.click();
  await wait(50);
})()`);
socket.close();
console.log(JSON.stringify({ status: "PASS", initial, interaction, lateMount, detail }, null, 2));
