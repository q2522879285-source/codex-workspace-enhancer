const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPLETED_STATUSES = new Set(["in_review", "done"]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringRecord(value) {
  return Object.fromEntries(Object.entries(record(value)).filter(([, item]) => typeof item === "string"));
}

function booleanRecord(value) {
  return Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [key, item === true]));
}

function completionRecord(value) {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([key, item]) => {
    if (!item || typeof item !== "object" || typeof item.token !== "string" || typeof item.taskId !== "string") {
      return [];
    }
    return [[key, { token: item.token, taskId: item.taskId }]];
  }));
}

function normalizeState(value) {
  const source = record(value);
  return {
    version: 1,
    initialized: source.initialized === true,
    lastSyncAt: typeof source.lastSyncAt === "string" ? source.lastSyncAt : null,
    activeByProject: booleanRecord(source.activeByProject),
    primaryTaskByProject: stringRecord(source.primaryTaskByProject),
    completionByProject: completionRecord(source.completionByProject),
    seenCompletionByProject: stringRecord(source.seenCompletionByProject),
    pinnedProjectIds: [...new Set(Array.isArray(source.pinnedProjectIds)
      ? source.pinnedProjectIds.filter((id) => typeof id === "string" && id)
      : [])].sort(),
  };
}

function taskTime(task) {
  const value = Date.parse(task?.updatedAt || "");
  return Number.isFinite(value) ? value : 0;
}

function compareTasks(left, right) {
  return taskTime(right) - taskTime(left)
    || Number(right?.version || 0) - Number(left?.version || 0)
    || String(right?.id || "").localeCompare(String(left?.id || ""));
}

function completionToken(task) {
  return [task.id, task.version || 0, task.updatedAt || ""].join(":");
}

function projectName(project, projectId) {
  const name = typeof project?.name === "string" ? project.name.trim() : "";
  return name || projectId;
}

export function threadRoute(rawThreadId) {
  const threadId = String(rawThreadId || "").trim().replace(/^(?:local|cloud):/i, "");
  return THREAD_ID_PATTERN.test(threadId) ? `/local/${threadId}` : null;
}

export function buildHomeProjectShelf({ projects = [], tasks = [], state = null, syncedAt = new Date().toISOString() } = {}) {
  const previous = normalizeState(state);
  const next = normalizeState(previous);
  const firstSync = !previous.initialized;
  const projectById = new Map((Array.isArray(projects) ? projects : [])
    .filter((project) => project && typeof project.id === "string")
    .map((project) => [project.id, project]));
  const routableTasks = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => task && typeof task.projectId === "string" && threadRoute(task.threadId));
  const tasksByProject = new Map();

  for (const task of routableTasks) {
    const group = tasksByProject.get(task.projectId) || [];
    group.push(task);
    tasksByProject.set(task.projectId, group);
  }

  const projectIds = new Set([
    ...projectById.keys(),
    ...tasksByProject.keys(),
    ...previous.pinnedProjectIds,
    ...Object.keys(previous.activeByProject),
    ...Object.keys(previous.completionByProject),
  ]);

  for (const projectId of projectIds) {
    const projectTasks = (tasksByProject.get(projectId) || []).sort(compareTasks);
    const activeTasks = projectTasks.filter((task) => task.status === "in_progress");
    const completionTask = projectTasks.find((task) => COMPLETED_STATUSES.has(task.status));
    const primaryTask = activeTasks[0] || projectTasks[0] || null;
    const wasActive = previous.activeByProject[projectId] === true;
    const isActive = activeTasks.length > 0;

    next.activeByProject[projectId] = isActive;
    if (primaryTask) next.primaryTaskByProject[projectId] = primaryTask.id;

    if (!completionTask) continue;
    const candidate = { token: completionToken(completionTask), taskId: completionTask.id };
    const priorCompletion = previous.completionByProject[projectId];
    const completedSinceLastSync = previous.lastSyncAt
      && taskTime(completionTask) > Date.parse(previous.lastSyncAt);
    const newTaskCompletedWhileAway = !isActive
      && !wasActive
      && completedSinceLastSync
      && priorCompletion?.taskId !== completionTask.id;

    if (firstSync) {
      next.completionByProject[projectId] = candidate;
      next.seenCompletionByProject[projectId] = candidate.token;
    } else if (!isActive && (wasActive || newTaskCompletedWhileAway)) {
      next.completionByProject[projectId] = candidate;
    } else if (!priorCompletion) {
      next.completionByProject[projectId] = candidate;
      next.seenCompletionByProject[projectId] = candidate.token;
    }
  }

  next.initialized = true;
  next.lastSyncAt = syncedAt;
  const pinned = new Set(next.pinnedProjectIds);
  const cards = [];

  for (const projectId of projectIds) {
    const projectTasks = (tasksByProject.get(projectId) || []).sort(compareTasks);
    const activeTasks = projectTasks.filter((task) => task.status === "in_progress");
    const isActive = activeTasks.length > 0;
    const isPinned = pinned.has(projectId);
    const completion = next.completionByProject[projectId] || null;
    const completionUnread = Boolean(completion && next.seenCompletionByProject[projectId] !== completion.token);
    if (!isActive && !isPinned && !completionUnread) continue;

    const preferredTaskId = isActive ? activeTasks[0]?.id : completion?.taskId || next.primaryTaskByProject[projectId];
    const primaryTask = projectTasks.find((task) => task.id === preferredTaskId) || activeTasks[0] || projectTasks[0];
    if (!primaryTask) continue;

    const phase = isActive ? "active" : isPinned ? "pinned" : "completed";
    cards.push({
      projectId,
      projectName: projectName(projectById.get(projectId), projectId),
      taskId: primaryTask.id,
      taskIdentifier: primaryTask.identifier || "",
      taskTitle: primaryTask.title || "未命名任务",
      threadId: String(primaryTask.threadId).replace(/^(?:local|cloud):/i, ""),
      updatedAt: primaryTask.updatedAt || "",
      activeTaskCount: activeTasks.length,
      phase,
      statusLabel: phase === "active" ? "执行中" : phase === "pinned" ? "已钉住" : "待查看",
      completionToken: completionUnread ? completion.token : null,
      pinned: isPinned,
    });
  }

  const phaseRank = { active: 0, completed: 1, pinned: 2 };
  cards.sort((left, right) => Number(right.pinned) - Number(left.pinned)
    || phaseRank[left.phase] - phaseRank[right.phase]
    || taskTime(right) - taskTime(left)
    || left.projectName.localeCompare(right.projectName, "zh-CN"));

  return { cards, state: next };
}

export function markHomeProjectViewed(state, card) {
  const next = normalizeState(state);
  if (card?.projectId && card?.completionToken) {
    next.seenCompletionByProject[card.projectId] = card.completionToken;
  }
  return next;
}

export function toggleHomeProjectPinned(state, projectId) {
  const next = normalizeState(state);
  if (typeof projectId !== "string" || !projectId) return next;
  const pinned = new Set(next.pinnedProjectIds);
  if (pinned.has(projectId)) pinned.delete(projectId);
  else pinned.add(projectId);
  next.pinnedProjectIds = [...pinned].sort();
  return next;
}

export async function readTaskboardSnapshot({ origin = "http://127.0.0.1:47823", timeoutMs = 1_500 } = {}) {
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const [projectResponse, taskResponse] = await Promise.all([
      fetch(`${origin}/api/projects`, { signal }),
      fetch(`${origin}/api/tasks`, { signal }),
    ]);
    if (!projectResponse.ok || !taskResponse.ok) throw new Error("Taskboard request failed");
    const [projectPayload, taskPayload] = await Promise.all([projectResponse.json(), taskResponse.json()]);
    if (!Array.isArray(projectPayload?.projects) || !Array.isArray(taskPayload?.tasks)) {
      throw new Error("Invalid Taskboard response");
    }
    return {
      available: true,
      projects: projectPayload.projects,
      tasks: taskPayload.tasks,
      message: "",
    };
  } catch {
    return {
      available: false,
      projects: [],
      tasks: [],
      message: "项目动态暂不可用",
    };
  }
}
