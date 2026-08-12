import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

async function homeProjectsModule() {
  return import("../lib/home-projects.mjs").catch(() => ({}));
}

const project = {
  id: "project-a",
  name: "项目 A",
};

function task(overrides = {}) {
  return {
    id: "task-a",
    identifier: "PROJECTA-1",
    projectId: project.id,
    title: "实现首页项目展示",
    status: "in_progress",
    threadId: "019fe64a-ace1-7793-92aa-4d91195005ec",
    version: 1,
    updatedAt: "2026-08-10T03:00:00.000Z",
    ...overrides,
  };
}

test("first sync shows active projects but baselines historical completions as already viewed", async () => {
  const { buildHomeProjectShelf } = await homeProjectsModule();
  const result = buildHomeProjectShelf?.({
    projects: [project, { id: "project-b", name: "项目 B" }],
    tasks: [
      task(),
      task({
        id: "task-b",
        identifier: "PROJECTB-1",
        projectId: "project-b",
        title: "历史已完成任务",
        status: "in_review",
        version: 4,
        updatedAt: "2026-08-09T03:00:00.000Z",
      }),
    ],
    state: null,
    syncedAt: "2026-08-10T03:05:00.000Z",
  });

  assert.deepEqual(result?.cards.map((card) => card.projectId), ["project-a"]);
  assert.equal(result?.cards[0].phase, "active");
  assert.equal(result?.cards[0].statusLabel, "执行中");
  assert.equal(result?.state.initialized, true);
  assert.equal(
    result?.state.seenCompletionByProject["project-b"],
    result?.state.completionByProject["project-b"].token,
  );
});

test("a project stays visible after execution completes until its completion card is viewed", async () => {
  const { buildHomeProjectShelf, markHomeProjectViewed } = await homeProjectsModule();
  const initial = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [task()],
    state: null,
    syncedAt: "2026-08-10T03:05:00.000Z",
  });
  const completedTask = task({
    status: "in_review",
    version: 2,
    updatedAt: "2026-08-10T03:10:00.000Z",
  });
  const completed = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [completedTask],
    state: initial?.state,
    syncedAt: "2026-08-10T03:11:00.000Z",
  });

  assert.equal(completed?.cards.length, 1);
  assert.equal(completed?.cards[0].phase, "completed");
  assert.equal(completed?.cards[0].statusLabel, "待查看");
  assert.ok(completed?.cards[0].completionToken);

  const unchanged = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [completedTask],
    state: completed?.state,
    syncedAt: "2026-08-10T03:12:00.000Z",
  });
  assert.equal(unchanged?.cards.length, 1, "polling must not dismiss an unread completion");

  const viewedState = markHomeProjectViewed?.(unchanged?.state, unchanged?.cards[0]);
  const viewed = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [completedTask],
    state: viewedState,
    syncedAt: "2026-08-10T03:13:00.000Z",
  });
  assert.deepEqual(viewed?.cards, []);

  const accepted = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [task({
      status: "done",
      version: 3,
      updatedAt: "2026-08-10T03:14:00.000Z",
    })],
    state: viewed?.state,
    syncedAt: "2026-08-10T03:15:00.000Z",
  });
  assert.deepEqual(accepted?.cards, [], "in_review to done is not a second completion event");
});

test("a later execution cycle creates a new completion that must be viewed again", async () => {
  const { buildHomeProjectShelf, markHomeProjectViewed } = await homeProjectsModule();
  const firstActive = buildHomeProjectShelf?.({
    projects: [project], tasks: [task()], state: null, syncedAt: "2026-08-10T03:05:00.000Z",
  });
  const firstCompleted = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [task({ status: "done", version: 2, updatedAt: "2026-08-10T03:10:00.000Z" })],
    state: firstActive?.state,
    syncedAt: "2026-08-10T03:11:00.000Z",
  });
  const firstToken = firstCompleted?.cards[0].completionToken;
  const viewedState = markHomeProjectViewed?.(firstCompleted?.state, firstCompleted?.cards[0]);
  const reopened = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [task({ version: 3, updatedAt: "2026-08-10T03:20:00.000Z" })],
    state: viewedState,
    syncedAt: "2026-08-10T03:21:00.000Z",
  });
  const completedAgain = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [task({ status: "done", version: 4, updatedAt: "2026-08-10T03:30:00.000Z" })],
    state: reopened?.state,
    syncedAt: "2026-08-10T03:31:00.000Z",
  });

  assert.equal(completedAgain?.cards.length, 1);
  assert.equal(completedAgain?.cards[0].phase, "completed");
  assert.notEqual(completedAgain?.cards[0].completionToken, firstToken);
});

test("pinned projects remain visible after viewing and across non-executing statuses", async () => {
  const { buildHomeProjectShelf, markHomeProjectViewed, toggleHomeProjectPinned } = await homeProjectsModule();
  const active = buildHomeProjectShelf?.({
    projects: [project], tasks: [task()], state: null, syncedAt: "2026-08-10T03:05:00.000Z",
  });
  const completed = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [task({ status: "in_review", version: 2, updatedAt: "2026-08-10T03:10:00.000Z" })],
    state: active?.state,
    syncedAt: "2026-08-10T03:11:00.000Z",
  });
  const pinnedState = toggleHomeProjectPinned?.(completed?.state, project.id);
  const viewedState = markHomeProjectViewed?.(pinnedState, completed?.cards[0]);
  const pinned = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [task({ status: "todo", version: 3, updatedAt: "2026-08-10T03:20:00.000Z" })],
    state: viewedState,
    syncedAt: "2026-08-10T03:21:00.000Z",
  });

  assert.equal(pinned?.cards.length, 1);
  assert.equal(pinned?.cards[0].pinned, true);
  assert.equal(pinned?.cards[0].phase, "pinned");
  assert.equal(pinned?.cards[0].statusLabel, "已钉住");

  const unpinnedState = toggleHomeProjectPinned?.(pinned?.state, project.id);
  const unpinned = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [task({ status: "todo", version: 3, updatedAt: "2026-08-10T03:20:00.000Z" })],
    state: unpinnedState,
    syncedAt: "2026-08-10T03:22:00.000Z",
  });
  assert.deepEqual(unpinned?.cards, []);
});

test("projects aggregate active task count and choose the latest routable task", async () => {
  const { buildHomeProjectShelf } = await homeProjectsModule();
  const result = buildHomeProjectShelf?.({
    projects: [project],
    tasks: [
      task({ id: "older", identifier: "PROJECTA-1", updatedAt: "2026-08-10T02:00:00.000Z" }),
      task({
        id: "newer",
        identifier: "PROJECTA-2",
        title: "最新执行任务",
        threadId: "019fe61d-6a11-7cf1-926b-435b108624b6",
        updatedAt: "2026-08-10T03:00:00.000Z",
      }),
      task({ id: "broken", identifier: "PROJECTA-3", threadId: "not-a-thread-id" }),
    ],
    state: null,
    syncedAt: "2026-08-10T03:05:00.000Z",
  });

  assert.equal(result?.cards.length, 1);
  assert.equal(result?.cards[0].taskId, "newer");
  assert.equal(result?.cards[0].taskTitle, "最新执行任务");
  assert.equal(result?.cards[0].activeTaskCount, 2);
});

test("thread routes reject invalid ids and normalize local prefixes", async () => {
  const { threadRoute } = await homeProjectsModule();
  assert.equal(
    threadRoute?.("019fe64a-ace1-7793-92aa-4d91195005ec"),
    "/local/019fe64a-ace1-7793-92aa-4d91195005ec",
  );
  assert.equal(
    threadRoute?.("local:019fe64a-ace1-7793-92aa-4d91195005ec"),
    "/local/019fe64a-ace1-7793-92aa-4d91195005ec",
  );
  assert.equal(threadRoute?.("not-a-thread"), null);
});

test("taskboard snapshots use the real HTTP contract and degrade predictably when unavailable", async () => {
  const { readTaskboardSnapshot } = await homeProjectsModule();
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/projects") {
      response.end(JSON.stringify({ projects: [project] }));
      return;
    }
    if (request.url === "/api/tasks") {
      response.end(JSON.stringify({ tasks: [task()] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const available = await readTaskboardSnapshot?.({ origin, timeoutMs: 500 });
    assert.deepEqual(available, {
      available: true,
      projects: [project],
      tasks: [task()],
      message: "",
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  const unavailable = await readTaskboardSnapshot?.({ origin, timeoutMs: 100 });
  assert.deepEqual(unavailable, {
    available: false,
    projects: [],
    tasks: [],
    message: "项目动态暂不可用",
  });
});
