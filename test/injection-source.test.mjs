import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");

test("injection uses stable Codex sidebar and tooltip anchors", () => {
  assert.match(source, /data-app-action-sidebar-thread-row/);
  assert.match(source, /data-app-action-sidebar-thread-id/);
  assert.match(source, /data-app-action-sidebar-thread-title/);
  assert.match(source, /role=\\?"tooltip/);
});

test("hover previews contain all requested fields and clamp message bodies to three lines", () => {
  assert.match(source, /核心总结/);
  assert.match(source, /最近输入/);
  assert.match(source, /最近输出/);
  assert.match(source, /-webkit-line-clamp:\s*3/);
});

test("injection is idempotent and reversible", () => {
  assert.match(source, /__codexConversationPreviewInjection__/);
  assert.match(source, /destroy/);
  assert.match(source, /\.remove\(\)/);
});

test("renderer receives host-pushed previews without a local HTTP fetch", () => {
  assert.match(source, /setPreviews/);
  assert.match(source, /setHomeProjects/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test("home project cards are accessible, pinnable, and use Codex internal navigation", () => {
  assert.match(source, /aria-label", "当前项目"/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /codex-conversation-preview:home-projects-state/);
  assert.match(source, /navigate-to-route/);
  assert.match(source, /data-codex-home-project-open/);
});

test("sidebar groups use accessible tabs and preserve native project actions", () => {
  assert.match(source, /role", "tablist"/);
  assert.match(source, /role", "tab"/);
  assert.match(source, /role", "tabpanel"/);
  assert.match(source, /aria-selected/);
  assert.match(source, /data-codex-sidebar-project-actions/);
  assert.match(source, /codexSidebarProjectActionSource/);
  assert.match(source, /ArrowRight/);
});

test("shortcut grid and section tabs occupy a fixed layout region above the task scroller", () => {
  assert.match(source, /SIDEBAR_CONTROLS_ID\s*=\s*"codex-sidebar-fixed-controls"/);
  assert.match(source, /navigation\.insertBefore\(host, scroll\)/);
  assert.match(source, /data-codex-sidebar-native-header-stable/);
  assert.match(source, /min-height: 44px !important/);
  assert.match(source, /controls\.insertBefore\(grid, controls\.firstChild\)/);
  assert.match(source, /controls\.appendChild\(bar\)/);
  assert.match(source, /host\.addEventListener\("wheel", forwardWheel, \{ passive: false \}\)/);
  assert.doesNotMatch(source, /#\$\{SHORTCUT_GRID_ID\}\s*\{[^}]*position:\s*sticky;/);
  assert.doesNotMatch(source, /#\$\{SECTION_TABS_ID\}\s*\{[^}]*position:\s*sticky;/);
});

test("focused shortcuts replace rarely used Sites and Plugins with direct Skill management", () => {
  assert.match(source, /name: "Skill 管理"/);
  assert.match(source, /button\.textContent\?\.trim\(\) === "技能"/);
  assert.match(source, /pluginsTab\?\.getAttribute\("aria-pressed"\) === "true"/);
  assert.match(source, /skillsTab\.click\(\)/);
  assert.doesNotMatch(source, /\? \{ name: "站点", button: site/);
  assert.doesNotMatch(source, /plugins \? \{ name: "插件", button: plugins/);
  assert.match(source, /--codex-sidebar-shortcut-columns/);
});

test("skill management expands, organizes, searches, favorites, and restores the native page", () => {
  assert.match(source, /SKILL_ORGANIZER_ID\s*=\s*"codex-skill-organizer"/);
  assert.match(source, /section#skills-installed/);
  assert.match(source, /expandButton\.click\(\)/);
  assert.match(source, /Skill 工作台/);
  assert.match(source, /视频创作/);
  assert.match(source, /导演镜头/);
  assert.match(source, /资产工作台/);
  assert.match(source, /写作研究/);
  assert.match(source, /SKILL_SUBGROUPS/);
  assert.match(source, /动作与打斗/);
  assert.match(source, /codex-skill-group-toggle/);
  assert.match(source, /aria-controls/);
  assert.match(source, /skillOrganizerExpandedGroups/);
  assert.match(source, /codex-skill-filter-list" role="group"/);
  assert.match(source, /button\.setAttribute\("aria-pressed", label === skillOrganizerFilter/);
  assert.match(source, /if \(event\.target !== row\) return;/);
  assert.match(source, /SKILL_FAVORITES_KEY/);
  assert.match(source, /localStorage\.setItem\(SKILL_FAVORITES_KEY/);
  assert.match(source, /entry\.card\.click\(\)/);
  assert.match(source, /clearSkillOrganizer\(\)/);
  assert.match(source, /removeAttribute\(SKILL_NATIVE_SECTION_ATTR\)/);
  assert.match(source, /removeAttribute\(SKILL_NATIVE_SEARCH_ATTR\)/);
});
