#!/usr/bin/env node

import { createInstallPlan } from "../lib/install-config.mjs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

function parseArgs(argv) {
  const options = { dryRun: false, activate: false, skipLaunchctl: false, launchctlPath: "launchctl" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--activate") options.activate = true;
    else if (argument === "--skip-launchctl") options.skipLaunchctl = true;
    else if (argument === "--home") options.home = argv[++index];
    else if (argument === "--install-dir") options.installDir = argv[++index];
    else if (argument === "--node-path") options.nodePath = argv[++index];
    else if (argument === "--port") options.port = Number(argv[++index]);
    else if (argument === "--launchctl-path") options.launchctlPath = argv[++index];
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const plan = createInstallPlan(options);

if (options.dryRun) {
  process.stdout.write(`${JSON.stringify(plan)}\n`);
} else if (options.activate) {
  await access(path.join(plan.installDir, "scripts", "injector.mjs"));
  await mkdir(plan.launchAgentsDir, { recursive: true });
  await mkdir(plan.logsDir, { recursive: true });
  await mkdir(path.dirname(plan.launcherExecutablePath), { recursive: true });
  await writeFile(plan.plistPath, plan.plist, { mode: 0o644 });
  await writeFile(path.join(plan.launcherContentsDir, "Info.plist"), plan.launcherInfoPlist, { mode: 0o644 });
  await writeFile(plan.launcherExecutablePath, plan.launcherScript, { mode: 0o755 });
  const legacyPlistPath = path.join(plan.launchAgentsDir, "com.yubowen.codex-conversation-preview.plist");
  if (!options.skipLaunchctl) {
    const domain = `gui/${process.getuid()}`;
    spawnSync(options.launchctlPath, ["bootout", domain, plan.plistPath], { stdio: "ignore" });
    const loaded = spawnSync(options.launchctlPath, ["bootstrap", domain, plan.plistPath], { encoding: "utf8" });
    if (loaded.status !== 0) throw new Error(loaded.stderr || "launchctl bootstrap failed");
    const kicked = spawnSync(options.launchctlPath, ["kickstart", "-k", `${domain}/${plan.label}`], { encoding: "utf8" });
    if (kicked.status !== 0) throw new Error(kicked.stderr || "launchctl kickstart failed");
    spawnSync(options.launchctlPath, ["bootout", domain, legacyPlistPath], { stdio: "ignore" });
  }
  try { await unlink(legacyPlistPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  process.stdout.write(`${JSON.stringify({
    activated: true,
    launchctlSkipped: options.skipLaunchctl,
    label: plan.label,
    plistPath: plan.plistPath,
    logsDir: plan.logsDir,
    launcherPath: plan.launcherPath,
  })}\n`);
} else {
  throw new Error("Choose --dry-run or --activate");
}
