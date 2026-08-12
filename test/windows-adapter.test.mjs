import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const installer = await readFile(new URL("../install-windows.ps1", import.meta.url), "utf8");
const launcher = await readFile(new URL("../windows/launch.ps1", import.meta.url), "utf8");
const uninstaller = await readFile(new URL("../windows/uninstall.ps1", import.meta.url), "utf8");
const injection = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const injector = await readFile(new URL("../scripts/injector.mjs", import.meta.url), "utf8");
const cdpClient = await readFile(new URL("../scripts/cdp-client.mjs", import.meta.url), "utf8");
const removeInjection = await readFile(new URL("../scripts/remove-injection.mjs", import.meta.url), "utf8");

test("Windows launcher verifies that an occupied port belongs to Codex", () => {
  assert.match(launcher, /Test-CodexDebugPort/);
  assert.match(launcher, /\/json\/list/);
  assert.match(launcher, /app:\/\/-\/index\.html/);
  assert.match(launcher, /already in use by another application/);
});

test("Windows uninstall restores shortcuts that existed before a fresh install", () => {
  assert.match(installer, /persistentShortcutBackupDir/);
  assert.match(installer, /shortcut-backup/);
  assert.match(uninstaller, /shortcut-backup/);
  assert.match(uninstaller, /Copy-Item.+Destination \$shortcutPaths\[\$index\]/s);
  assert.match(installer, /if \(-not \(Test-Path -LiteralPath \$persistentShortcutBackupDir\)\)/);
  assert.doesNotMatch(installer, /if \(-not \$hadExisting -and -not \(Test-Path -LiteralPath \$persistentShortcutBackupDir\)\)/);
  assert.match(installer, /\$shortcut\.WorkingDirectory = \$env:LOCALAPPDATA/);
});

test("all supported native conversation rows receive complete cards", () => {
  assert.match(injection, /data-sidebar-chatgpt-conversation-key/);
  assert.match(injection, /CHATGPT_ROW_SELECTOR/);
  assert.match(injection, /\[data-codex-conversation-preview-enhanced="true"\]/);
  assert.match(injection, /暂无本地摘要/);
});

test("asset console is embedded in Codex through a reversible local CDP proxy", () => {
  assert.match(injection, /setAssetConsole/);
  assert.match(injection, /setAssetConsolePanel/);
  assert.match(injection, /codex-asset-console-panel/);
  assert.match(injection, /资产控制台/);
  assert.match(injection, /codexSidebarOpenAssetConsole/);
  assert.match(injector, /Runtime\.addBinding/);
  assert.match(injector, /Runtime\.enable/);
  assert.match(injector, /Fetch\.fulfillRequest/);
  assert.match(injector, /Target\.setAutoAttach/);
  assert.match(injector, /randomBytes\(24\)/);
  assert.match(injector, /allowedFrameId/);
  assert.match(injector, /BlockedByClient/);
  assert.match(injector, /Publish the provisional object before the first await/);
  assert.match(injector, /AssetBrowser/);
  assert.doesNotMatch(injector, /启动资产控制台-直连\.ps1/);
  assert.doesNotMatch(injector, /spawn\("powershell\.exe"/);
  assert.match(cdpClient, /eventListeners/);
  assert.match(cdpClient, /message\.sessionId/);
  assert.match(removeInjection, /Fetch\.disable/);
  assert.match(removeInjection, /Runtime\.removeBinding/);
});
