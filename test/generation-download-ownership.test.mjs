import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { DownloadAutomation, normalizeAutomation } from "../asset-browser/download-automation.js";
import { GenerationPipeline } from "../asset-browser/generation-pipeline.js";

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "asset-ownership-"));
  const inbox = path.join(root, "Downloads");
  const project = path.join(root, "Project");
  const pending = path.join(root, "Pending");
  await Promise.all([mkdir(inbox), mkdir(project), mkdir(pending)]);
  const config = {
    projects: [
      { id: "project-a", name: "Project A", path: project, scanRoots: ["."] },
      { id: "pending-review", name: "待确认", path: pending, scanRoots: ["."] }
    ],
    automation: normalizeAutomation({
      inbox: { enabled: true, sourcePath: inbox, transferMode: "move" },
      routing: {
        enabled: true,
        profiles: [
          { id: "project-a", name: "Project A", projectId: "project-a", keywords: ["project a"] },
          { id: "pending-review", name: "待确认", projectId: "pending-review", keywords: [] }
        ]
      }
    })
  };
  const pipeline = new GenerationPipeline({
    registryPath: path.join(root, "tickets.json"),
    bindingsPath: path.join(root, "bindings.json")
  });
  return { root, inbox, project, pending, config, pipeline };
}

async function oldEnough(filePath) {
  const then = new Date(Date.now() - 5000);
  await utimes(filePath, then, then);
}

test("safe inbox policy never scans or moves ordinary downloads", async (t) => {
  const { root, inbox, config } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ordinary = path.join(inbox, "ordinary-download.zip");
  await writeFile(ordinary, "keep me", "utf8");
  const automation = new DownloadAutomation({ ledgerPath: path.join(root, "ledger.json") });

  const result = await automation.runOrganizer(config.automation, config.projects);

  assert.equal(config.automation.inbox.capturePolicy, "ticketed-only");
  assert.equal(result.imported.length, 0);
  assert.match(result.disabledReason, /普通下载文件保持原位/);
  assert.equal((await readFile(ordinary, "utf8")), "keep me");
});

test("thread-bound generated image routes to that task project", async (t) => {
  const { root, config, pipeline } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await pipeline.bindThread({ threadId: "task-123", projectId: "project-a", sourceTask: "当前任务" }, config);

  const ticket = await pipeline.create({
    kind: "image",
    generator: "codex-image",
    prompt: "test",
    sourceContext: { threadId: "task-123", taskTitle: "当前任务" }
  }, config);

  assert.equal(ticket.projectId, "project-a");
  assert.equal(ticket.routingResolution.source, "thread-binding");
});

test("unmatched generated video falls back to pending review", async (t) => {
  const { root, config, pipeline } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const ticket = await pipeline.create({
    kind: "video",
    generator: "tapnow",
    prompt: "unmatched generation",
    sourceContext: { threadId: "unbound-task", taskTitle: "无项目任务" }
  }, config);

  assert.equal(ticket.projectId, "pending-review");
  assert.equal(ticket.routingResolution.source, "pending-fallback");
});

test("armed watcher claims only the exact generated filename", async (t) => {
  const { root, inbox, config, pipeline } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ticket = await pipeline.create({ kind: "video", projectId: "project-a", generator: "tapnow" }, config);
  await pipeline.arm(ticket.id, { sourcePath: inbox, expectedName: "tapnow-result.mp4" });
  const unrelated = path.join(inbox, "family-video.mp4");
  const generated = path.join(inbox, "tapnow-result.mp4");
  await writeFile(unrelated, "unrelated", "utf8");
  await writeFile(generated, "generated", "utf8");
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const claims = await pipeline.claimArmedDownloads(config, { settleSeconds: 1 });

  assert.equal(claims.length, 1);
  assert.equal((await readFile(unrelated, "utf8")), "unrelated");
  await assert.rejects(stat(generated), { code: "ENOENT" });
  assert.equal((await readFile(claims[0].output.path, "utf8")), "generated");
});

test("unnamed watcher fails closed and leaves every download untouched", async (t) => {
  const { root, inbox, config, pipeline } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ticket = await pipeline.create({ kind: "video", projectId: "project-a", generator: "tapnow" }, config);
  await pipeline.arm(ticket.id, { sourcePath: inbox });
  const candidate = path.join(inbox, "unknown.mp4");
  await writeFile(candidate, "do not guess", "utf8");
  await oldEnough(candidate);

  const claims = await pipeline.claimArmedDownloads(config, { settleSeconds: 1 });
  const current = await pipeline.get(ticket.id);

  assert.equal(claims.length, 0);
  assert.equal((await readFile(candidate, "utf8")), "do not guess");
  assert.equal(current.status, "awaiting_download");
  assert.equal(current.claimObservation.state, "identity-required");
});

test("prompt-only project words are suggestions, not automatic routing", async (t) => {
  const { root, config, pipeline } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const ticket = await pipeline.create({
    kind: "image",
    generator: "codex-image",
    prompt: "compare Project A with an older style",
    sourceContext: { threadId: "unbound-prompt-task", taskTitle: "generic task" }
  }, config);

  assert.equal(ticket.projectId, "pending-review");
  assert.equal(ticket.routingResolution.source, "pending-fallback");
});

test("structured task context may route a generated asset", async (t) => {
  const { root, config, pipeline } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const ticket = await pipeline.create({
    kind: "image",
    generator: "codex-image",
    prompt: "neutral prompt",
    sourceContext: { projectName: "Project A", taskTitle: "current task" }
  }, config);

  assert.equal(ticket.projectId, "project-a");
  assert.equal(ticket.routingResolution.source, "keyword");
  assert.equal(ticket.routingResolution.matchedOn, "context");
});

test("ticketed-only cleanup ignores legacy ledgers and leaves ordinary files in place", async (t) => {
  const { root, inbox, config } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ordinary = path.join(inbox, "legacy-ordinary.mp4");
  const ledgerPath = path.join(root, "legacy-ledger.json");
  await writeFile(ordinary, "ordinary", "utf8");
  await writeFile(ledgerPath, "this deliberately is not valid JSON", "utf8");
  const automation = new DownloadAutomation({ ledgerPath });
  config.automation.cleanup.enabled = true;
  config.automation.cleanup.dryRun = false;
  config.automation.cleanup.approvedAt = new Date().toISOString();

  const preview = await automation.previewCleanup(config.automation);
  const run = await automation.runCleanup(config.automation);

  assert.equal(preview.candidates.length, 0);
  assert.match(preview.disabledReason, /disabled/);
  assert.equal(run.quarantined.length, 0);
  assert.match(run.disabledReason, /disabled/);
  assert.equal(await readFile(ordinary, "utf8"), "ordinary");
});

test("concurrent claims reserve an exact generated file only once", async (t) => {
  const { root, inbox, config, pipeline } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ticket = await pipeline.create({ kind: "video", projectId: "project-a", generator: "tapnow" }, config);
  await pipeline.arm(ticket.id, { sourcePath: inbox, expectedName: "one-result.mp4" });
  const generated = path.join(inbox, "one-result.mp4");
  await writeFile(generated, "generated once", "utf8");
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const results = await Promise.all([
    pipeline.claimArmedDownloads(config, { settleSeconds: 1 }),
    pipeline.claimArmedDownloads(config, { settleSeconds: 1 })
  ]);
  const current = await pipeline.get(ticket.id);

  assert.equal(results.flat().length, 1);
  assert.equal(current.status, "archived");
  assert.equal(current.outputs.length, 1);
});

test("expected generated file identity rejects paths", async (t) => {
  const { root, inbox, config, pipeline } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ticket = await pipeline.create({ kind: "image", projectId: "project-a", generator: "codex-image" }, config);
  await assert.rejects(
    pipeline.arm(ticket.id, { sourcePath: inbox, expectedName: `..${path.sep}ordinary.png` }),
    /exact file name/
  );
});

test("generation CLI can remove a task binding", async (t) => {
  const { root, config, pipeline } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.json");
  const registryPath = path.join(root, "tickets.json");
  const bindingsPath = path.join(root, "bindings.json");
  await writeFile(configPath, JSON.stringify(config), "utf8");
  const cliPipeline = new GenerationPipeline({ registryPath, bindingsPath });
  await cliPipeline.bindThread({ threadId: "task-to-unbind", projectId: "project-a" }, config);

  const { stdout } = await execFileAsync(process.execPath, [
    path.resolve("asset-browser/generation-cli.js"), "unbind", "--thread", "task-to-unbind"
  ], {
    env: {
      ...process.env,
      ASSET_BROWSER_CONFIG: configPath,
      GENERATION_TICKETS: registryPath,
      GENERATION_THREAD_BINDINGS: bindingsPath
    }
  });

  assert.equal(JSON.parse(stdout).removed, true);
});
