import assert from "node:assert/strict";
import { appendFile, mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cleanPreviewText,
  coreSummary,
  parsePreviewLines,
  PreviewRepository,
} from "../lib/preview-data.mjs";

test("preview cleanup removes automation transport markers", () => {
  const value = "<heartbeat> <automationid>automation</automationid> <decision>NOTIFY</decision> 已完成侧栏检查。";
  assert.equal(cleanPreviewText(value), "已完成侧栏检查。");
});

test("preview parsing prefers the latest real user and assistant events", () => {
  const lines = [
    JSON.stringify({
      timestamp: "2026-08-09T10:00:00Z",
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "旧任务已经完成。旧结果不应覆盖新一轮。" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T11:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "# My request:\n请增加对话核心总结和最近消息。" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T11:01:00Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "正在实现新的侧栏摘要和悬浮预览。后续状态。" },
    }),
  ];
  const preview = parsePreviewLines(lines, { title: "侧栏优化" });
  assert.equal(preview.recentInput, "请增加对话核心总结和最近消息。");
  assert.equal(preview.recentOutput, "正在实现新的侧栏摘要和悬浮预览。后续状态。");
  assert.equal(preview.summary, "正在实现新的侧栏摘要和悬浮预览。");
});

test("completed threads use their final result as the core summary", () => {
  const lines = [
    JSON.stringify({
      timestamp: "2026-08-09T10:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "修复播放器。" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T10:02:00Z",
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "定位完成：文件未损坏，问题是 HEVC 封装兼容性。\n更多细节。" },
    }),
  ];
  assert.equal(
    parsePreviewLines(lines).summary,
    "定位完成：文件未损坏，问题是 HEVC 封装兼容性。",
  );
});

test("text cleanup removes transport wrappers and clamps summaries", () => {
  assert.equal(
    cleanPreviewText("# My request:\n**更新侧栏**", { user: true }),
    "更新侧栏",
  );
  assert.ok(coreSummary("甲".repeat(200)).length <= 96);
});

test("repository resolves a client-new thread by the newest matching title", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-preview-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "09");
  await mkdir(sessions, { recursive: true });
  const oldId = "019fe61d-6a11-7cf1-926b-435b108624b5";
  const newId = "019fe61d-6a11-7cf1-926b-435b108624b6";
  await writeFile(path.join(sessions, `rollout-old-${oldId}.jsonl`), `${JSON.stringify({
    timestamp: "2026-08-09T09:00:00Z",
    type: "event_msg",
    payload: { type: "user_message", message: "旧输入" },
  })}\n`);
  await writeFile(path.join(sessions, `rollout-new-${newId}.jsonl`), [
    JSON.stringify({
      timestamp: "2026-08-09T10:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "新的输入" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T10:01:00Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "新的输出已经产生。" },
    }),
  ].join("\n"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: oldId, thread_name: "同名对话", updated_at: "2026-08-09T09:00:00Z" }),
    JSON.stringify({ id: newId, thread_name: "同名对话", updated_at: "2026-08-09T10:00:00Z" }),
  ].join("\n"));

  const repository = new PreviewRepository({ codexHome, maxTailBytes: 1024 * 1024 });
  const preview = await repository.readPreview("local:client-new-thread:temporary", "同名对话");
  assert.equal(preview.threadId, newId);
  assert.equal(preview.recentInput, "新的输入");
  assert.equal(preview.recentOutput, "新的输出已经产生。");
  assert.equal(preview.updatedAt, "2026-08-09T10:00:00.000Z");
  assert.equal(preview.tags.length, 3);
});

test("repository reads the latest real rate limit from the newest session", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-usage-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "09");
  await mkdir(sessions, { recursive: true });
  const threadId = "019fe61d-6a11-7cf1-926b-435b108624b6";
  await writeFile(path.join(sessions, `rollout-${threadId}.jsonl`), `${JSON.stringify({
    timestamp: "2026-08-09T12:22:49Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: 48, window_minutes: 10080, resets_at: 1786825820 },
        secondary: null,
        plan_type: "prolite",
      },
    },
  })}\n`);
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({
    id: threadId,
    thread_name: "侧栏优化",
    updated_at: "2026-08-09T12:22:49Z",
  }));

  const repository = new PreviewRepository({ codexHome, maxTailBytes: 1024 * 1024 });
  assert.deepEqual(await repository.readUsage?.(), {
    limitId: "codex",
    planType: "prolite",
    usedPercent: 48,
    remainingPercent: 52,
    windowMinutes: 10080,
    resetsAt: "2026-08-15T20:30:20.000Z",
  });
});

test("usage follows the newest rate-limit event instead of stale session metadata or preview cache", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-usage-sync-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "11");
  await mkdir(sessions, { recursive: true });
  const staleId = "019fe61d-6a11-7cf1-926b-435b108624b7";
  const freshId = "019fe61d-6a11-7cf1-926b-435b108624b8";
  const stalePath = path.join(sessions, `rollout-${staleId}.jsonl`);
  const freshPath = path.join(sessions, `rollout-${freshId}.jsonl`);
  const rateEvent = (timestamp, usedPercent) => JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: usedPercent, window_minutes: 10080, resets_at: 1787014835 },
        secondary: null,
        plan_type: "pro",
      },
    },
  });
  await writeFile(stalePath, `${rateEvent("2026-08-11T00:00:00Z", 55)}\n`);
  await writeFile(freshPath, `${rateEvent("2026-08-11T03:44:14Z", 2)}\n`);
  await utimes(stalePath, new Date("2026-08-11T00:00:01Z"), new Date("2026-08-11T00:00:01Z"));
  await utimes(freshPath, new Date("2026-08-11T03:44:15Z"), new Date("2026-08-11T03:44:15Z"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: staleId, thread_name: "索引看似最新但额度已旧", updated_at: "2026-08-11T05:00:00Z" }),
    JSON.stringify({ id: freshId, thread_name: "实际额度最新", updated_at: "2026-08-10T05:00:00Z" }),
  ].join("\n"));

  const repository = new PreviewRepository({ codexHome, usageIndexRefreshIntervalMs: 0 });
  await repository.readPreview(freshId, "实际额度最新");
  assert.equal((await repository.readUsage()).remainingPercent, 98, "session-index ordering cannot revive a pre-reset value");

  await appendFile(freshPath, `${rateEvent("2026-08-11T03:50:00Z", 3)}\n`);
  await utimes(freshPath, new Date("2026-08-11T03:50:01Z"), new Date("2026-08-11T03:50:01Z"));
  assert.equal((await repository.readUsage()).remainingPercent, 97, "a changed session file invalidates the cached snapshot");
});

test("repository search catalog includes every indexed thread assigned to a saved project", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-search-catalog-test-"));
  const targetId = "019f0d8f-9645-75a0-87f7-6e5cf6328ba6";
  const unassignedId = "019f0d8f-9645-75a0-87f7-6e5cf6328ba7";
  await writeFile(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: targetId, thread_name: "旧知识卡名称", updated_at: "2026-06-27T09:00:00Z" }),
    JSON.stringify({ id: targetId, thread_name: "整理项目资料", updated_at: "2026-06-28T09:29:06Z" }),
    JSON.stringify({ id: unassignedId, thread_name: "未分配项目的对话", updated_at: "2026-06-29T09:00:00Z" }),
  ].join("\n"));
  await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
    "local-projects": {
      "project-innovation": {
        id: "project-innovation",
        name: "示例项目",
        rootPaths: ["/Users/test/Documents/ExampleProject"],
      },
    },
    "thread-project-assignments": {
      [targetId]: {
        projectKind: "local",
        projectId: "project-innovation",
        cwd: "/Users/test/Documents/ExampleProject",
      },
    },
  }));

  const repository = new PreviewRepository({ codexHome });
  assert.equal(typeof repository.readSearchCatalog, "function");
  assert.deepEqual(await repository.readSearchCatalog(), [{
    threadId: targetId,
    title: "整理项目资料",
    updatedAt: "2026-06-28T09:29:06.000Z",
    projectId: "project-innovation",
    projectName: "示例项目",
  }]);
});
