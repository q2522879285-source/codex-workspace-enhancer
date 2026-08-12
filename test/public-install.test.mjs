import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(".");
const macTest = process.platform === "darwin" ? test : test.skip;

macTest("public installer copies a portable runtime and activates it under the current user", async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-public-install-"));
  const installDir = path.join(testHome, "Library", "Application Support", "Codex Sidebar Enhancer");
  try {
    const result = spawnSync("/bin/bash", ["install.sh"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: testHome,
        CODEX_SIDEBAR_SOURCE_DIR: projectRoot,
        CODEX_SIDEBAR_INSTALL_DIR: installDir,
        CODEX_SIDEBAR_NODE: process.execPath,
        CODEX_SIDEBAR_SKIP_LAUNCHCTL: "1",
        CODEX_SIDEBAR_SKIP_OPEN: "1",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex Sidebar Enhancer installed/);
    await access(path.join(installDir, "scripts", "injector.mjs"));
    await access(path.join(installDir, "inject", "conversation-preview.user.js"));
    const plistPath = path.join(testHome, "Library", "LaunchAgents", "com.yubowen.codex-sidebar-enhancer.plist");
    const plist = await readFile(plistPath, "utf8");
    assert.match(plist, new RegExp(installDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(plist, /\/Users\/yubowen/);
    await assert.rejects(access(path.join(installDir, ".git")));
    await assert.rejects(access(path.join(installDir, "codex-folder-switcher-verification.png")));
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});

macTest("public uninstaller removes only the installed runtime, LaunchAgent, launcher, and logs", async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-public-uninstall-"));
  const installDir = path.join(testHome, "Library", "Application Support", "Codex Sidebar Enhancer");
  const sharedEnv = {
    ...process.env,
    HOME: testHome,
    CODEX_SIDEBAR_SOURCE_DIR: projectRoot,
    CODEX_SIDEBAR_INSTALL_DIR: installDir,
    CODEX_SIDEBAR_NODE: process.execPath,
    CODEX_SIDEBAR_SKIP_LAUNCHCTL: "1",
    CODEX_SIDEBAR_SKIP_OPEN: "1",
  };
  try {
    const installed = spawnSync("/bin/bash", ["install.sh"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: sharedEnv,
    });
    assert.equal(installed.status, 0, installed.stderr);

    const removed = spawnSync("/bin/bash", ["uninstall.sh"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: sharedEnv,
    });
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /Codex Sidebar Enhancer uninstalled/);
    await assert.rejects(access(installDir));
    await assert.rejects(access(path.join(testHome, "Library", "LaunchAgents", "com.yubowen.codex-sidebar-enhancer.plist")));
    await assert.rejects(access(path.join(testHome, "Applications", "Codex Sidebar Enhancer.app")));
    await assert.rejects(access(path.join(testHome, "Library", "Logs", "CodexSidebarEnhancer")));
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});
