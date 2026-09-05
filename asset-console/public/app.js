import { ASSET_GROUPS, classifyAsset } from "./asset-classification.js";

const codexParams = new URLSearchParams(window.location.search);
const codexEmbedded = codexParams.get("embed") === "codex";

const state = {
  projectRoot: "",
  configEnabled: true,
  projects: [],
  selectedProject: "",
  cases: [],
  selectedCase: "",
  assets: [],
  selectedAsset: null,
  movingAsset: null,
  movingAssets: [],
  renamingFolder: null,
  renameFolderReturnFocus: null,
  multiSelect: false,
  compareMode: false,
  selectedAssetKeys: new Set(),
  selectionAnchorKey: "",
  batchBusy: false,
  projectOrganizeBusy: false,
  categoryFilter: "",
  smartGroupFilter: "",
  statusFilter: "",
  typeFilter: "",
  query: "",
  sort: "newest",
  compactReverse: true,
  automation: null,
  generationTickets: [],
  rhythmTracks: [],
  activeRhythmTrackId: "",
  rhythmCapabilities: null,
  promptItems: [],
  promptCounts: {},
  editingPromptItem: null,
  promptSearchTimer: null,
  assetSearchTimer: null,
  threeDTasks: [],
  threeDStatus: null,
  midjourney: { candidates: [], profiles: [], observedProfiles: [], imports: [], selected: new Set(), editingId: "" },
  autoRefreshTimer: null,
  deferredRefresh: null,
  caseGroupOpen: {},
  draggedProjectId: "",
  suppressProjectClick: false,
  codexEmbedded,
  codexThreadId: codexParams.get("threadId") || "",
  codexThreadTitle: codexParams.get("threadTitle") || "当前 Codex 任务",
  codexBindings: [],
  codexBoundProject: "",
  codexScope: "project",
  codexSharedProject: "ai-reference-library",
  codexExcludedTypes: ["code"],
  codexView: "grid",
  codexWorkspaceMessage: "",
  workspaceSwitchGeneration: 0,
  caseLoadGeneration: 0,
  assetLoadGeneration: 0,
  moveFolderLoadGeneration: 0,
  caseCache: new Map(),
  assetCache: new Map(),
  caseCacheRequestGeneration: new Map(),
  assetCacheRequestGeneration: new Map(),
  workspaceCacheEpoch: 0,
  workspaceCacheRequestSerial: 0
};

const workspaceCacheLimit = 24;

function workspaceCacheKey(projectId, caseId = "") {
  return `${projectId}\u0000${caseId}`;
}

function readWorkspaceCache(cache, key) {
  const value = cache.get(key);
  if (!value) return null;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function rememberWorkspaceCache(cache, key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > workspaceCacheLimit) cache.delete(cache.keys().next().value);
}

function clearWorkspaceCaches() {
  state.caseCache.clear();
  state.assetCache.clear();
  state.workspaceCacheEpoch += 1;
  state.caseCacheRequestGeneration.clear();
  state.assetCacheRequestGeneration.clear();
}

function beginWorkspaceCacheRequest(requests, key) {
  const request = {
    epoch: state.workspaceCacheEpoch,
    token: ++state.workspaceCacheRequestSerial
  };
  requests.set(key, request.token);
  return request;
}

function isCurrentWorkspaceCacheRequest(requests, key, request) {
  return request.epoch === state.workspaceCacheEpoch && requests.get(key) === request.token;
}

function finishWorkspaceCacheRequest(requests, key, request) {
  if (requests.get(key) === request.token) requests.delete(key);
}

function mutatesWorkspace(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (method === "GET") return false;
  return /^\/api\/(?:batch-move|trash-assets|restore-trash|folders(?:\/|$)|projects(?:\/|$)|midjourney(?:\/|$))/.test(path);
}

document.body.classList.toggle("codex-embedded", codexEmbedded);

const els = {
  codexTaskBar: document.querySelector("#codexTaskBar"),
  codexTaskTitle: document.querySelector("#codexTaskTitle"),
  codexBindingState: document.querySelector("#codexBindingState"),
  codexProjectSelect: document.querySelector("#codexProjectSelect"),
  codexBindProject: document.querySelector("#codexBindProject"),
  codexBindingMenu: document.querySelector("#codexBindingMenu"),
  codexNewProjectButton: document.querySelector("#codexNewProjectButton"),
  codexNewProjectDialog: document.querySelector("#codexNewProjectDialog"),
  codexNewProjectForm: document.querySelector("#codexNewProjectForm"),
  codexNewProjectName: document.querySelector("#codexNewProjectName"),
  codexNewProjectPath: document.querySelector("#codexNewProjectPath"),
  codexNewProjectScanRoots: document.querySelector("#codexNewProjectScanRoots"),
  codexCreateProject: document.querySelector("#codexCreateProject"),
  codexNewProjectMessage: document.querySelector("#codexNewProjectMessage"),
  sidebar: document.querySelector(".sidebar"),
  sidebarLayout: document.querySelector("#sidebarLayout"),
  projectList: document.querySelector("#projectList"),
  projectNameInput: document.querySelector("#projectNameInput"),
  projectPathInput: document.querySelector("#projectPathInput"),
  projectScanRootsInput: document.querySelector("#projectScanRootsInput"),
  addProjectButton: document.querySelector("#addProjectButton"),
  caseList: document.querySelector("#caseList"),
  categoryFilters: document.querySelector("#categoryFilters"),
  smartGroupFilters: document.querySelector("#smartGroupFilters"),
  statusFilters: document.querySelector("#statusFilters"),
  typeFilters: document.querySelector("#typeFilters"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshStatus: document.querySelector("#refreshStatus"),
  workflowEnabled: document.querySelector("#workflowEnabled"),
  autoRefresh: document.querySelector("#autoRefresh"),
  compactReverse: document.querySelector("#compactReverse"),
  caseTitle: document.querySelector("#caseTitle"),
  assetCount: document.querySelector("#assetCount"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  newFolderButton: document.querySelector("#newFolderButton"),
  newFolderDialog: document.querySelector("#newFolderDialog"),
  newFolderForm: document.querySelector("#newFolderForm"),
  newFolderContext: document.querySelector("#newFolderContext"),
  newFolderName: document.querySelector("#newFolderName"),
  newFolderMessage: document.querySelector("#newFolderMessage"),
  createFolderButton: document.querySelector("#createFolderButton"),
  renameFolderDialog: document.querySelector("#renameFolderDialog"),
  renameFolderForm: document.querySelector("#renameFolderForm"),
  renameFolderContext: document.querySelector("#renameFolderContext"),
  renameFolderName: document.querySelector("#renameFolderName"),
  renameFolderMessage: document.querySelector("#renameFolderMessage"),
  confirmRenameFolder: document.querySelector("#confirmRenameFolder"),
  organizeProjectButton: document.querySelector("#organizeProjectButton"),
  selectionModeButton: document.querySelector("#selectionModeButton"),
  embeddedFilterMenu: document.querySelector("#embeddedFilterMenu"),
  embeddedFilterCount: document.querySelector("#embeddedFilterCount"),
  embeddedCategoryFilter: document.querySelector("#embeddedCategoryFilter"),
  embeddedSmartGroupFilter: document.querySelector("#embeddedSmartGroupFilter"),
  embeddedStatusFilter: document.querySelector("#embeddedStatusFilter"),
  embeddedTypeFilter: document.querySelector("#embeddedTypeFilter"),
  clearEmbeddedFilters: document.querySelector("#clearEmbeddedFilters"),
  batchBar: document.querySelector("#batchBar"),
  batchCount: document.querySelector("#batchCount"),
  selectVisibleAssets: document.querySelector("#selectVisibleAssets"),
  batchStatusSelect: document.querySelector("#batchStatusSelect"),
  batchTaskAction: document.querySelector("#batchTaskAction"),
  batchDiscardAssets: document.querySelector("#batchDiscardAssets"),
  batchUseInCodex: document.querySelector("#batchUseInCodex"),
  batchCompareAssets: document.querySelector("#batchCompareAssets"),
  batchCurateAssets: document.querySelector("#batchCurateAssets"),
  batchMoveAssets: document.querySelector("#batchMoveAssets"),
  batchDeleteAssets: document.querySelector("#batchDeleteAssets"),
  batchMoreButton: document.querySelector("#batchMoreButton"),
  batchMorePopover: document.querySelector("#batchMorePopover"),
  clearAssetSelection: document.querySelector("#clearAssetSelection"),
  codexAttachResult: document.querySelector("#codexAttachResult"),
  codexAttachResultTitle: document.querySelector("#codexAttachResultTitle"),
  codexAttachResultDetail: document.querySelector("#codexAttachResultDetail"),
  codexContinueChoosing: document.querySelector("#codexContinueChoosing"),
  codexReturnToComposer: document.querySelector("#codexReturnToComposer"),
  comparePanel: document.querySelector("#comparePanel"),
  compareTitle: document.querySelector("#compareTitle"),
  compareGrid: document.querySelector("#compareGrid"),
  closeComparePanel: document.querySelector("#closeComparePanel"),
  assetGrid: document.querySelector("#assetGrid"),
  detailName: document.querySelector("#detailName"),
  detailPreview: document.querySelector("#detailPreview"),
  detailBody: document.querySelector("#detailBody"),
  closeDetail: document.querySelector("#closeDetail"),
  quickMoveAsset: document.querySelector("#quickMoveAsset"),
  promptLibraryButton: document.querySelector("#promptLibraryButton"),
  promptLibraryDialog: document.querySelector("#promptLibraryDialog"),
  promptCaptureCount: document.querySelector("#promptCaptureCount"),
  promptTermCount: document.querySelector("#promptTermCount"),
  promptRecipeCount: document.querySelector("#promptRecipeCount"),
  promptReadyCount: document.querySelector("#promptReadyCount"),
  promptPendingCount: document.querySelector("#promptPendingCount"),
  promptEditorTitle: document.querySelector("#promptEditorTitle"),
  promptAssetLinkHint: document.querySelector("#promptAssetLinkHint"),
  promptCancelEdit: document.querySelector("#promptCancelEdit"),
  promptKind: document.querySelector("#promptKind"),
  promptTitle: document.querySelector("#promptTitle"),
  promptCategory: document.querySelector("#promptCategory"),
  promptVisualRole: document.querySelector("#promptVisualRole"),
  promptTags: document.querySelector("#promptTags"),
  promptRecipeTermsLabel: document.querySelector("#promptRecipeTermsLabel"),
  promptRecipeTerms: document.querySelector("#promptRecipeTerms"),
  promptText: document.querySelector("#promptText"),
  promptSaveMessage: document.querySelector("#promptSaveMessage"),
  promptSaveItem: document.querySelector("#promptSaveItem"),
  promptSearch: document.querySelector("#promptSearch"),
  promptKindFilter: document.querySelector("#promptKindFilter"),
  promptCategoryFilter: document.querySelector("#promptCategoryFilter"),
  promptRefresh: document.querySelector("#promptRefresh"),
  promptCompile: document.querySelector("#promptCompile"),
  promptLibraryList: document.querySelector("#promptLibraryList"),
  threeDWorkbenchButton: document.querySelector("#threeDWorkbenchButton"),
  threeDWorkbenchDialog: document.querySelector("#threeDWorkbenchDialog"),
  threeDTotalCount: document.querySelector("#threeDTotalCount"),
  threeDActiveCount: document.querySelector("#threeDActiveCount"),
  threeDAttentionCount: document.querySelector("#threeDAttentionCount"),
  threeDCompletedCount: document.querySelector("#threeDCompletedCount"),
  threeDSkillState: document.querySelector("#threeDSkillState"),
  threeDAssetHint: document.querySelector("#threeDAssetHint"),
  threeDAssetPath: document.querySelector("#threeDAssetPath"),
  threeDTargetName: document.querySelector("#threeDTargetName"),
  threeDSubjectType: document.querySelector("#threeDSubjectType"),
  threeDIntendedUse: document.querySelector("#threeDIntendedUse"),
  threeDComplexity: document.querySelector("#threeDComplexity"),
  threeDNotes: document.querySelector("#threeDNotes"),
  threeDCreateMessage: document.querySelector("#threeDCreateMessage"),
  threeDCreateTask: document.querySelector("#threeDCreateTask"),
  threeDProjectFilter: document.querySelector("#threeDProjectFilter"),
  threeDRefresh: document.querySelector("#threeDRefresh"),
  threeDTaskList: document.querySelector("#threeDTaskList"),
  moveAssetDialog: document.querySelector("#moveAssetDialog"),
  moveAssetSummary: document.querySelector("#moveAssetSummary"),
  moveTargetProject: document.querySelector("#moveTargetProject"),
  moveTargetFolder: document.querySelector("#moveTargetFolder"),
  moveCustomFolder: document.querySelector("#moveCustomFolder"),
  moveTargetName: document.querySelector("#moveTargetName"),
  moveTargetNameField: document.querySelector("#moveTargetNameField"),
  autoOrganizeMoveAsset: document.querySelector("#autoOrganizeMoveAsset"),
  confirmMoveAsset: document.querySelector("#confirmMoveAsset"),
  cancelMoveAsset: document.querySelector("#cancelMoveAsset"),
  moveAssetMessage: document.querySelector("#moveAssetMessage"),
  batchDeleteDialog: document.querySelector("#batchDeleteDialog"),
  batchDeleteTitle: document.querySelector("#batchDeleteTitle"),
  batchDeleteSummary: document.querySelector("#batchDeleteSummary"),
  confirmBatchDelete: document.querySelector("#confirmBatchDelete"),
  cancelBatchDelete: document.querySelector("#cancelBatchDelete"),
  toastRegion: document.querySelector("#toastRegion"),
  generationButton: document.querySelector("#generationButton"),
  midjourneyButton: document.querySelector("#midjourneyButton"),
  midjourneyDialog: document.querySelector("#midjourneyDialog"),
  midjourneyCandidateCount: document.querySelector("#midjourneyCandidateCount"),
  midjourneySelectedCount: document.querySelector("#midjourneySelectedCount"),
  midjourneyTargetProject: document.querySelector("#midjourneyTargetProject"),
  midjourneyCandidateGrid: document.querySelector("#midjourneyCandidateGrid"),
  refreshMidjourney: document.querySelector("#refreshMidjourney"),
  importMidjourney: document.querySelector("#importMidjourney"),
  midjourneyProfileCount: document.querySelector("#midjourneyProfileCount"),
  midjourneyProfileList: document.querySelector("#midjourneyProfileList"),
  newMidjourneyProfile: document.querySelector("#newMidjourneyProfile"),
  midjourneyProfileForm: document.querySelector("#midjourneyProfileForm"),
  midjourneyProfileId: document.querySelector("#midjourneyProfileId"),
  midjourneyProfileCode: document.querySelector("#midjourneyProfileCode"),
  midjourneyProfileName: document.querySelector("#midjourneyProfileName"),
  midjourneyProfileRating: document.querySelector("#midjourneyProfileRating"),
  midjourneyProfileSource: document.querySelector("#midjourneyProfileSource"),
  midjourneyProfileTags: document.querySelector("#midjourneyProfileTags"),
  midjourneyProfileNote: document.querySelector("#midjourneyProfileNote"),
  cancelMidjourneyProfile: document.querySelector("#cancelMidjourneyProfile"),
  generationDialog: document.querySelector("#generationDialog"),
  generationProject: document.querySelector("#generationProject"),
  generationProfile: document.querySelector("#generationProfile"),
  generationKind: document.querySelector("#generationKind"),
  generationGenerator: document.querySelector("#generationGenerator"),
  generationEpisode: document.querySelector("#generationEpisode"),
  generationScene: document.querySelector("#generationScene"),
  generationShot: document.querySelector("#generationShot"),
  generationRole: document.querySelector("#generationRole"),
  generationVersion: document.querySelector("#generationVersion"),
  generationModel: document.querySelector("#generationModel"),
  generationDestination: document.querySelector("#generationDestination"),
  generationNameStem: document.querySelector("#generationNameStem"),
  generationPrompt: document.querySelector("#generationPrompt"),
  generationNegative: document.querySelector("#generationNegative"),
  generationRhythmTrack: document.querySelector("#generationRhythmTrack"),
  generationRhythmHint: document.querySelector("#generationRhythmHint"),
  createGenerationTicket: document.querySelector("#createGenerationTicket"),
  createAndArmGeneration: document.querySelector("#createAndArmGeneration"),
  refreshGenerationTickets: document.querySelector("#refreshGenerationTickets"),
  generationSummary: document.querySelector("#generationSummary"),
  generationTickets: document.querySelector("#generationTickets"),
  rhythmControlButton: document.querySelector("#rhythmControlButton"),
  rhythmControlDialog: document.querySelector("#rhythmControlDialog"),
  rhythmProject: document.querySelector("#rhythmProject"),
  rhythmProfile: document.querySelector("#rhythmProfile"),
  rhythmDuration: document.querySelector("#rhythmDuration"),
  rhythmMode: document.querySelector("#rhythmMode"),
  rhythmBpm: document.querySelector("#rhythmBpm"),
  rhythmKeyScale: document.querySelector("#rhythmKeyScale"),
  rhythmName: document.querySelector("#rhythmName"),
  rhythmDestination: document.querySelector("#rhythmDestination"),
  rhythmDescription: document.querySelector("#rhythmDescription"),
  rhythmCues: document.querySelector("#rhythmCues"),
  rhythmMusicPrompt: document.querySelector("#rhythmMusicPrompt"),
  rhythmCapability: document.querySelector("#rhythmCapability"),
  rhythmMessage: document.querySelector("#rhythmMessage"),
  createRhythmTrack: document.querySelector("#createRhythmTrack"),
  refreshRhythmTracks: document.querySelector("#refreshRhythmTracks"),
  rhythmTracks: document.querySelector("#rhythmTracks"),
  automationButton: document.querySelector("#automationButton"),
  automationDialog: document.querySelector("#automationDialog"),
  inboxEnabled: document.querySelector("#inboxEnabled"),
  activeProfile: document.querySelector("#activeProfile"),
  moveAfterArchive: document.querySelector("#moveAfterArchive"),
  inboxSourcePath: document.querySelector("#inboxSourcePath"),
  inboxProject: document.querySelector("#inboxProject"),
  inboxPollSeconds: document.querySelector("#inboxPollSeconds"),
  inboxBasePath: document.querySelector("#inboxBasePath"),
  useCurrentCase: document.querySelector("#useCurrentCase"),
  routeImage: document.querySelector("#routeImage"),
  routeVideo: document.querySelector("#routeVideo"),
  routeAudio: document.querySelector("#routeAudio"),
  routeOther: document.querySelector("#routeOther"),
  cleanupEnabled: document.querySelector("#cleanupEnabled"),
  retentionDays: document.querySelector("#retentionDays"),
  cleanupIntervalHours: document.querySelector("#cleanupIntervalHours"),
  quarantinePath: document.querySelector("#quarantinePath"),
  cleanupDryRun: document.querySelector("#cleanupDryRun"),
  purgeEnabled: document.querySelector("#purgeEnabled"),
  quarantineDays: document.querySelector("#quarantineDays"),
  saveAutomation: document.querySelector("#saveAutomation"),
  previewOrganizer: document.querySelector("#previewOrganizer"),
  runOrganizer: document.querySelector("#runOrganizer"),
  previewCleanup: document.querySelector("#previewCleanup"),
  runCleanup: document.querySelector("#runCleanup"),
  automationSummary: document.querySelector("#automationSummary"),
  automationResult: document.querySelector("#automationResult"),
  governanceButton: document.querySelector("#governanceButton"),
  governanceDialog: document.querySelector("#governanceDialog"),
  governanceCacheSize: document.querySelector("#governanceCacheSize"),
  governanceActiveCount: document.querySelector("#governanceActiveCount"),
  governanceArchiveCount: document.querySelector("#governanceArchiveCount"),
  governanceModuleCount: document.querySelector("#governanceModuleCount"),
  governanceMessage: document.querySelector("#governanceMessage"),
  governanceSnapshots: document.querySelector("#governanceSnapshots"),
  governanceHistory: document.querySelector("#governanceHistory"),
  refreshGovernance: document.querySelector("#refreshGovernance"),
  createGovernanceSnapshot: document.querySelector("#createGovernanceSnapshot"),
  clearGovernanceCache: document.querySelector("#clearGovernanceCache")
};

const userStatuses = ["可用", "局部可用", "参考可用", "暂存", "丢弃"];
const categoryLabels = {
  videoResult: "视频结果",
  generatedAsset: "生成资产",
  reference: "输入参考",
  reverse: "视频反推/抽帧",
  audio: "音频资产",
  "": "全部资产"
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function classificationOf(asset) {
  return classifyAsset(asset);
}

function statusClass(status) {
  if (status === "可用") return "good";
  if (status === "可用但需优化" || status === "局部可用") return "partial";
  if (status === "参考可用" || status === "不通过但有参考价值") return "ref";
  if (status === "暂存" || status === "未评估") return "hold";
  if (status === "丢弃" || status === "不通过") return "drop";
  return "unknown";
}

function displayStatus(asset) {
  return asset.userStatus || asset.initialStatus || "待用户判断";
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function slashPath(text) {
  return String(text || "").replaceAll("\\", "/");
}

function pathTokens(asset) {
  const casePath = slashPath(`${asset.caseId}/${asset.caseRelPath || ""}/${asset.name || ""}`);
  const projectPath = slashPath(`${asset.relPath || ""}/${asset.name || ""}`);
  return {
    original: `${casePath} ${projectPath}`,
    lower: `${casePath} ${projectPath}`.toLowerCase()
  };
}

function assetCategory(asset) {
  const { original, lower } = pathTokens(asset);
  if (
    asset.kind === "contact" ||
    asset.kind === "frame" ||
    includesAny(original, ["反推", "抽帧", "拆帧", "视频学习", "contact_sheet", "逐帧"]) ||
    includesAny(lower, ["/frames/", "/frame_extract", "/reverse", "/storyboard_reverse", "/video_reverse", "frame_", "contact_sheet"])
  ) {
    return "reverse";
  }

  if (asset.kind === "audio") {
    return "audio";
  }

  if (
    includesAny(lower, [
      "/input/",
      "/inputs/",
      "/source/",
      "/sources/",
      "/reference/",
      "/references/",
      "/refs/",
      "/samples/",
      "/raw/",
      "/原始素材/",
      "/输入参考/",
      "/参考素材/"
    ]) ||
    includesAny(original, ["输入参考", "参考素材", "原始素材", "外部参考", "源素材"]) ||
    includesAny(lower, ["source_", "input_", "ref_", "_ref."])
  ) {
    return "reference";
  }

  if (
    asset.kind === "video" ||
    includesAny(lower, [
      "/videos/",
      "/video_results/",
      "/video-result/",
      "/video-result",
      "/final_videos/",
      "/exports/",
      "/renders/",
      "/rendered/"
    ]) ||
    includesAny(original, ["成片", "视频结果", "最终视频", "可用版", "实测"]) ||
    includesAny(lower, ["seedance", "dreamina", "higgsfield"])
  ) {
    return "videoResult";
  }

  if (
    includesAny(lower, [
      "/generated_covers/",
      "/generated/",
      "/generations/",
      "/outputs/",
      "/output/",
      "/assets/",
      "/images/",
      "/covers/",
      "/candidates/"
    ]) ||
    includesAny(original, ["母版", "机制母版", "首帧", "尾帧", "角色卡", "设定", "候选", "测试图", "资产图", "封面", "道具", "场景"]) ||
    includesAny(lower, ["generated", "candidate", "cover", "final", "regen", "character_design"])
  ) {
    return "generatedAsset";
  }

  if (asset.kind === "image") return "generatedAsset";
  return "generatedAsset";
}

function enrichAsset(asset) {
  if (asset.category) {
    return {
      ...asset,
      categoryLabel: asset.categoryLabel || categoryLabels[asset.category] || "全部资产"
    };
  }
  const category = assetCategory(asset);
  return {
    ...asset,
    category,
    categoryLabel: categoryLabels[category] || "全部资产"
  };
}

function absolutePath(asset) {
  if (asset.absolutePath) return asset.absolutePath;
  if (asset.isGroup) return `${state.projectRoot}/${asset.groupDir}`;
  if (asset.managed && asset.resolvedPath) return asset.resolvedPath;
  return `${state.projectRoot}/${asset.relPath}`;
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      throw new Error(data.error || text);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(text);
      throw error;
    }
  }
  const data = await response.json();
  if (mutatesWorkspace(path, options)) clearWorkspaceCaches();
  return data;
}

function showToast(message, options = {}) {
  const toast = document.createElement("div");
  toast.className = `toast ${options.tone === "error" ? "error" : ""}`;
  const text = document.createElement("span");
  text.textContent = String(message || "操作完成");
  toast.append(text);
  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 180);
  };
  if (options.actionLabel && typeof options.onAction === "function") {
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = options.actionLabel;
    action.addEventListener("click", async () => {
      action.disabled = true;
      try {
        await options.onAction();
        dismiss();
      } catch (error) {
        action.disabled = false;
        showToast(error.message || error, { tone: "error", duration: 6000 });
      }
    });
    toast.append(action);
  }
  els.toastRegion.append(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  timer = setTimeout(dismiss, options.duration || 4200);
  return { dismiss, element: toast };
}

function showError(error) {
  showToast(error?.message || error || "操作失败", { tone: "error", duration: 6000 });
}

function codexProjectName(projectId) {
  return state.projects.find((project) => project.id === projectId)?.name || "";
}

function isAbsoluteWindowsProjectPath(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return /^[A-Za-z]:[\\/](?:[^\\/]+(?:[\\/][^\\/]*)*)?$/u.test(normalized)
    || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/].*)?$/u.test(normalized);
}

function normalizeWindowsProjectPath(value) {
  let normalized = String(value || "").trim().replaceAll("/", "\\");
  if (/^[A-Za-z]:\\+$/u.test(normalized)) return `${normalized[0].toLowerCase()}:\\`;
  normalized = normalized.replace(/\\+$/u, "");
  return normalized.toLowerCase();
}

function findCreatedProject(projects, expectedId, projectPath) {
  const list = Array.isArray(projects) ? projects : [];
  const byId = expectedId ? list.find((project) => project.id === expectedId) : null;
  if (byId) return byId;
  const normalizedPath = normalizeWindowsProjectPath(projectPath);
  return list.find((project) => normalizeWindowsProjectPath(project.path) === normalizedPath) || null;
}

function resolveUsableCreatedProject(projects, expectedId, projectPath) {
  const project = findCreatedProject(projects, expectedId, projectPath);
  if (project?.exists) return project;
  throw new Error("项目已创建，但刷新后尚未出现在可用项目列表中");
}

function renderCodexTaskContext() {
  if (!state.codexEmbedded) return;
  if (els.codexTaskBar) els.codexTaskBar.hidden = false;
  const project = state.projects.find((item) => item.id === state.selectedProject);
  const title = document.querySelector("#codexResourceTitle");
  if (title) {
    title.textContent = state.codexScope === "shared" ? (state.codexSharedProject === "mj-library" ? "MJ 素材库" : "精选参考") : project?.name || "项目资产";
    title.title = project?.path || title.textContent;
  }
  const subtitle = document.querySelector("#codexResourceSubtitle");
  if (subtitle) {
    subtitle.textContent = state.codexScope === "project" ? state.codexWorkspaceMessage || "" : "";
    subtitle.hidden = !subtitle.textContent;
  }
  if (els.codexTaskTitle) els.codexTaskTitle.textContent = state.codexThreadTitle;
  if (els.codexBindingState) els.codexBindingState.textContent = "";
  document.querySelectorAll("[data-codex-scope]").forEach((button) => {
    const active = button.dataset.codexScope === state.codexScope;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const sharedSources = document.querySelector("#codexSharedSources");
  if (sharedSources) sharedSources.hidden = state.codexScope !== "shared";
  document.querySelectorAll("[data-codex-shared-project]").forEach((button) => {
    const active = button.dataset.codexSharedProject === state.codexSharedProject;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function loadCodexBinding() {
  if (!state.codexEmbedded) return;
  const data = await api(`/api/codex/workspace?threadId=${encodeURIComponent(state.codexThreadId)}`);
  state.codexWorkspaceMessage = data.message || "";
  state.codexBoundProject = data.project?.id || "";
  if (data.project) {
    const index = state.projects.findIndex((item) => item.id === data.project.id);
    if (index < 0) state.projects.push(data.project);
    else state.projects[index] = { ...state.projects[index], ...data.project };
  }
  // A refresh follows the selected scope, not a default project shortcut.
  const projectId = state.codexScope === "shared" ? state.codexSharedProject || "ai-reference-library" : state.codexBoundProject;
  if (state.selectedProject !== projectId) state.selectedCase = "";
  state.selectedProject = projectId;
}

function normalizeCodexExcludedTypes(types) {
  return [...new Set(types.filter((type) => ["image", "video", "audio", "document", "web", "code", "other"].includes(type)))];
}

function readCodexExcludedTypes() {
  try {
    const saved = JSON.parse(window.localStorage.getItem("codex-asset-console:excluded-types-v1"));
    if (Array.isArray(saved)) return normalizeCodexExcludedTypes(saved);
  } catch {}
  return ["code"];
}

function setCodexExcludedTypes(types) {
  state.codexExcludedTypes = normalizeCodexExcludedTypes(types);
  const activeKind = { archive: "other", frame: "image", contact: "image" }[state.typeFilter] || state.typeFilter;
  if (state.codexExcludedTypes.includes(activeKind)) {
    state.typeFilter = "";
    if (els.typeFilter) els.typeFilter.value = "";
  }
  if (state.selectedAsset && state.codexExcludedTypes.includes(resourceFilterKind(state.selectedAsset))) state.selectedAsset = null;
  exitSelectionMode();
  try {
    window.localStorage.setItem("codex-asset-console:excluded-types-v1", JSON.stringify(state.codexExcludedTypes));
  } catch {}
  render();
}

function renderCodexExclusions() {
  const excluded = state.codexExcludedTypes || [];
  document.querySelectorAll("[data-codex-exclude]").forEach((input) => {
    input.checked = excluded.includes(input.dataset.codexExclude);
  });
  const count = document.querySelector("#codexExclusionsCount");
  if (count) count.textContent = String(excluded.length);
  document.querySelectorAll("[data-codex-type]").forEach((button) => {
    button.hidden = excluded.includes(button.dataset.codexType);
  });
}

function renderCodexResourceControls() {
  if (!state.codexEmbedded) return;
  renderCodexExclusions();
  const back = document.querySelector("#codexFolderBack");
  if (back) back.hidden = state.codexScope !== "shared" || state.selectedCase === "__all__";
  const folders = document.querySelector("#codexFolderFilter");
  if (folders) {
    folders.replaceChildren(...state.cases.map((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.id === "__all__" ? (state.codexScope === "shared" ? "全部合集" : "全部目录") : item.relPath || item.name || item.id;
      return option;
    }));
    folders.value = state.selectedCase;
  }
  els.assetGrid.dataset.view = state.codexView;
  document.querySelectorAll("[data-codex-type]").forEach((button) => {
    const active = button.dataset.codexType === state.typeFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-codex-view]").forEach((button) => {
    const active = button.dataset.codexView === state.codexView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function selectCodexScope(scope, sharedProject = state.codexSharedProject || "ai-reference-library") {
  if (!["project", "shared"].includes(scope)) return;
  if (scope === "shared" && !["ai-reference-library", "mj-library"].includes(sharedProject)) return;
  const projectId = scope === "shared" ? sharedProject : state.codexBoundProject;
  if (scope === state.codexScope && projectId === state.selectedProject) return;
  if (!projectId || !state.projects.some((item) => item.id === projectId && item.exists)) {
    showToast(scope === "shared" ? "公用资产位置不可用" : state.codexWorkspaceMessage || "当前任务项目暂不可用", { tone: "error" });
    return;
  }
  state.codexScope = scope;
  if (scope === "shared") state.codexSharedProject = sharedProject;
  await selectProject(projectId);
  renderCodexTaskContext();
}

async function selectProject(projectId) {
  if (!state.projects.some((project) => project.id === projectId && project.exists)) return;
  if (projectId === state.selectedProject) return;
  const generation = ++state.workspaceSwitchGeneration;
  const transition = await beginWorkspaceSwitch(generation);
  if (generation !== state.workspaceSwitchGeneration) {
    releaseWorkspaceSwitch(transition);
    return;
  }
  try {
    state.selectedProject = projectId;
    state.selectedCase = "";
    state.selectedAsset = null;
    state.cases = [];
    renderCases();
    exitSelectionMode();
    setCategoryFilter("");
    renderProjects();
    renderCodexTaskContext();
    const casesLoaded = await loadCases({ workspaceGeneration: generation });
    if (!casesLoaded) return;
    await loadAssets({ workspaceGeneration: generation });
  } finally {
    finishWorkspaceSwitch(transition);
  }
}

async function saveCodexProjectBinding(projectId) {
  if (!state.codexThreadId || !projectId || ["ai-reference-library", "mj-library"].includes(projectId)) return;
  const data = await api("/api/generation/bindings", {
    method: "POST",
    body: JSON.stringify({
      threadId: state.codexThreadId,
      projectId,
      source: "codex-embedded",
      sourceTask: state.codexThreadTitle
    })
  });
  state.codexBoundProject = data.binding?.projectId || projectId;
  return state.codexBoundProject;
}

async function bindCurrentCodexProject() {
  const projectId = els.codexProjectSelect.value;
  if (!state.codexThreadId || !projectId || ["ai-reference-library", "mj-library"].includes(projectId)) return;
  els.codexBindProject.disabled = true;
  try {
    await saveCodexProjectBinding(projectId);
    renderCodexTaskContext();
    els.codexBindingMenu?.removeAttribute("open");
    showToast(`已把任务关联到「${codexProjectName(projectId)}」`);
  } catch (error) {
    showError(error);
  } finally {
    renderCodexTaskContext();
  }
}

function openCodexNewProjectDialog() {
  if (!state.codexEmbedded || !els.codexNewProjectDialog) return;
  els.codexBindingMenu?.removeAttribute("open");
  els.codexNewProjectMessage.textContent = "新建后会自动切换到该项目。";
  els.codexNewProjectDialog.showModal();
  requestAnimationFrame(() => els.codexNewProjectName?.focus());
}

function closeCodexNewProjectDialog() {
  if (!els.codexNewProjectDialog?.open) return;
  els.codexNewProjectDialog.close();
  els.codexNewProjectButton?.focus();
}

async function createCodexProject(event) {
  event?.preventDefault();
  const name = els.codexNewProjectName.value.trim();
  const projectPath = els.codexNewProjectPath.value.trim();
  const scanRoots = els.codexNewProjectScanRoots.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!name || !projectPath) {
    els.codexNewProjectMessage.textContent = "请填写项目名称和已有文件夹的绝对路径。";
    (!name ? els.codexNewProjectName : els.codexNewProjectPath).focus();
    return;
  }
  if (!isAbsoluteWindowsProjectPath(projectPath)) {
    els.codexNewProjectMessage.textContent = "请填写完整的 Windows 绝对路径，例如 D:\\Projects\\ExampleProject。";
    els.codexNewProjectPath.focus();
    return;
  }

  els.codexCreateProject.disabled = true;
  els.codexNewProjectMessage.textContent = "正在新建并关联…";
  let projectId = "";
  let projectLabel = name;
  let creationError = null;
  try {
    try {
      const data = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name, path: projectPath, scanRoots })
      });
      projectId = data.project?.id || "";
      if (!projectId) creationError = new Error("服务没有返回项目编号");
    } catch (error) {
      creationError = error;
    }

    if (!projectId) {
      try {
        const recovery = await api("/api/projects");
        const recoveredProject = findCreatedProject(recovery.projects, "", projectPath);
        if (!recoveredProject) throw new Error("没有找到新项目");
        state.projects = recovery.projects;
        projectId = recoveredProject.id;
        projectLabel = recoveredProject.name || name;
      } catch {
        els.codexNewProjectMessage.textContent = `新建失败：${creationError?.message || "没有找到新项目"}`;
        return;
      }
    }

    let followUpError = null;
    try {
      await loadProjects();
      const createdProject = resolveUsableCreatedProject(state.projects, projectId, projectPath);
      projectId = createdProject.id;
      projectLabel = createdProject.name || name;
      await selectProject(projectId);
      if (state.selectedProject !== projectId) throw new Error("未能切换到新项目");
      if (state.codexThreadId) await saveCodexProjectBinding(projectId);
    } catch (error) {
      followUpError = error;
    }

    els.codexNewProjectName.value = "";
    els.codexNewProjectPath.value = "";
    els.codexNewProjectDialog.close();
    if (followUpError) {
      showToast(`项目「${codexProjectName(projectId) || projectLabel}」已新建，但自动关联失败：${followUpError.message}`, {
        tone: "error",
        duration: 7000
      });
      return;
    }
    showToast(state.codexThreadId
      ? `已新建「${codexProjectName(projectId) || projectLabel}」并关联当前任务`
      : `已新建「${codexProjectName(projectId) || projectLabel}」`);
  } finally {
    els.codexCreateProject.disabled = false;
    renderCodexTaskContext();
  }
}

function currentFolderCreationContext() {
  const project = state.projects.find((item) => item.id === state.selectedProject && item.exists);
  const currentCase = state.cases.find((item) => item.id === state.selectedCase);
  if (!project || !currentCase) return null;
  const parts = pathParts(currentCase.relPath || currentCase.id);
  return {
    project,
    currentCase,
    parentPath: parts.join("\\"),
    label: [project.name, ...parts].join(" › "),
  };
}

function syncNewFolderButton() {
  if (!els.newFolderButton) return;
  if (state.codexEmbedded) { els.newFolderButton.hidden = true; return; }
  const context = currentFolderCreationContext();
  els.newFolderButton.hidden = !context;
  els.newFolderButton.disabled = !context;
  els.newFolderButton.title = context ? `在“${context.label}”中新建文件夹` : "请先选择一个可用项目";
}

function openNewFolderDialog() {
  const context = currentFolderCreationContext();
  if (!context) return showToast("请先选择一个可用项目", { tone: "error" });
  els.newFolderContext.textContent = `创建位置：${context.label}`;
  els.newFolderMessage.textContent = "名称不能包含 \\ / : * ? \" < > |";
  els.newFolderName.value = "";
  els.newFolderDialog.showModal();
  els.newFolderName.focus({ preventScroll: true });
  requestAnimationFrame(() => els.newFolderName.focus({ preventScroll: true }));
}

function closeNewFolderDialog() {
  if (els.newFolderDialog?.open) els.newFolderDialog.close();
}

async function createFolderInCurrentLevel(event) {
  event.preventDefault();
  const context = currentFolderCreationContext();
  if (!context) {
    els.newFolderMessage.textContent = "当前项目或文件夹已经不可用，请刷新后重试。";
    return;
  }
  const name = els.newFolderName.value.trim();
  if (!name) {
    els.newFolderName.focus();
    return;
  }

  els.createFolderButton.disabled = true;
  els.newFolderName.disabled = true;
  els.newFolderMessage.textContent = "正在创建…";
  let folder;
  try {
    const data = await api("/api/folders", {
      method: "POST",
      body: JSON.stringify({
        projectId: context.project.id,
        parentPath: context.parentPath,
        name,
      }),
    });
    folder = data.folder;
  } catch (error) {
    els.newFolderMessage.textContent = `创建失败：${error.message}`;
    return;
  } finally {
    els.createFolderButton.disabled = false;
    els.newFolderName.disabled = false;
  }

  const generation = ++state.workspaceSwitchGeneration;
  const transition = await beginWorkspaceSwitch(generation);
  try {
    await loadProjects();
    if (state.selectedProject !== context.project.id) throw new Error("当前项目已经切换");
    state.selectedCase = folder.path;
    state.query = "";
    els.searchInput.value = "";
    const casesLoaded = await loadCases({ workspaceGeneration: generation });
    if (!casesLoaded || !state.cases.some((item) => item.id === folder.path)) throw new Error("新文件夹尚未出现在列表中");
    await loadAssets({ workspaceGeneration: generation });
    closeNewFolderDialog();
    showToast(`已新建并打开“${folder.name}”`);
  } catch (error) {
    closeNewFolderDialog();
    showToast(`文件夹“${folder.name}”已创建，但自动打开失败：${error.message}`, { tone: "error", duration: 7000 });
  } finally {
    finishWorkspaceSwitch(transition);
  }
}

function openRenameFolderDialog(item, trigger = document.activeElement) {
  const project = state.projects.find((candidate) => candidate.id === state.selectedProject && candidate.exists);
  if (!project || !item) return showToast("这个文件夹已经不可用，请刷新后重试。", { tone: "error" });
  const parts = pathParts(item.relPath || item.id);
  if (!parts.length) return showToast("项目根目录不能改名。", { tone: "error" });
  state.renamingFolder = {
    projectId: project.id,
    path: parts.join("\\"),
    previousName: parts.at(-1),
    parentCaseId: state.selectedCase,
  };
  state.renameFolderReturnFocus = trigger instanceof HTMLElement ? trigger : null;
  els.renameFolderContext.textContent = `当前位置：${[project.name, ...parts].join(" › ")}`;
  els.renameFolderName.value = parts.at(-1);
  els.renameFolderMessage.textContent = "只修改文件夹名称，里面的素材保持不变。";
  els.renameFolderDialog.showModal();
  els.renameFolderName.focus({ preventScroll: true });
  els.renameFolderName.select();
  requestAnimationFrame(() => {
    els.renameFolderName.focus({ preventScroll: true });
    els.renameFolderName.select();
  });
}

function closeRenameFolderDialog() {
  if (els.renameFolderDialog?.open) els.renameFolderDialog.close();
}

async function renameSelectedFolder(event) {
  event.preventDefault();
  const context = state.renamingFolder;
  if (!context || context.projectId !== state.selectedProject) {
    els.renameFolderMessage.textContent = "当前项目已经切换，请关闭后重试。";
    return;
  }
  const name = els.renameFolderName.value.trim();
  if (!name) {
    els.renameFolderName.focus();
    return;
  }

  els.confirmRenameFolder.disabled = true;
  els.renameFolderName.disabled = true;
  els.renameFolderMessage.textContent = "正在改名…";
  let folder;
  try {
    const data = await api("/api/folders", {
      method: "PATCH",
      body: JSON.stringify({ projectId: context.projectId, path: context.path, name }),
    });
    folder = data.folder;
  } catch (error) {
    els.renameFolderMessage.textContent = `改名失败：${error.message}`;
    return;
  } finally {
    els.confirmRenameFolder.disabled = false;
    els.renameFolderName.disabled = false;
  }

  if (folder.unchanged) {
    closeRenameFolderDialog();
    showToast("名称没有变化");
    return;
  }

  const generation = ++state.workspaceSwitchGeneration;
  const transition = await beginWorkspaceSwitch(generation);
  try {
    await loadProjects();
    if (state.selectedProject !== context.projectId) throw new Error("当前项目已经切换");
    state.selectedCase = context.parentCaseId;
    const casesLoaded = await loadCases({ workspaceGeneration: generation });
    if (!casesLoaded) throw new Error("文件夹列表刷新失败");
    if (state.cases.some((item) => item.id === context.parentCaseId)) state.selectedCase = context.parentCaseId;
    await loadAssets({ workspaceGeneration: generation });
    closeRenameFolderDialog();
    showToast(`已将“${folder.previousName}”改为“${folder.name}”`);
  } catch (error) {
    closeRenameFolderDialog();
    showToast(`文件夹已改名，但列表刷新失败：${error.message}`, { tone: "error", duration: 7000 });
  } finally {
    finishWorkspaceSwitch(transition);
  }
}

function sendAssetToCodex(asset) {
  if (!state.codexEmbedded || !asset || asset.isGroup || window.parent === window) return;
  window.parent.postMessage({
    source: "asset-console",
    action: "use-in-codex",
    path: absolutePath(asset),
    name: asset.name,
    kind: resourceKind(asset)
  }, "*");
}

function sendSelectedAssetsToCodex() {
  const assets = selectedAssets().slice(0, 8);
  if (!state.codexEmbedded || !assets.length || window.parent === window) return;
  window.parent.postMessage({
    source: "asset-console",
    action: "use-many-in-codex",
    paths: assets.map(absolutePath),
    names: assets.map((asset) => asset.name),
    kinds: assets.map(resourceKind)
  }, "*");
}

function showCodexAttachResult(count = 1) {
  hideCodexAttachResult();
  showToast(`已添加 ${count} 项引用到输入框上方`);
}

function hideCodexAttachResult({ focusGrid = false } = {}) {
  if (!els.codexAttachResult) return;
  els.codexAttachResult.hidden = true;
  if (focusGrid) {
    const target = els.assetGrid.querySelector(".asset-card") || els.searchInput;
    target?.focus();
  }
}

function returnToCodexComposer() {
  if (!state.codexEmbedded || window.parent === window) return;
  window.parent.postMessage({
    source: "asset-console",
    action: "return-to-codex"
  }, "*");
}

function wireCodexIntegration() {
  if (!state.codexEmbedded) return;
  state.codexExcludedTypes = readCodexExcludedTypes();
  document.querySelectorAll("[data-codex-exclude]").forEach((input) => {
    input.addEventListener("change", () => {
      const types = new Set(state.codexExcludedTypes);
      if (input.checked) types.add(input.dataset.codexExclude);
      else types.delete(input.dataset.codexExclude);
      setCodexExcludedTypes([...types]);
    });
  });
  document.querySelector("#codexRestoreTypes")?.addEventListener("click", () => setCodexExcludedTypes([]));
  document.querySelectorAll("[data-codex-scope]").forEach((button) => {
    button.addEventListener("click", () => selectCodexScope(button.dataset.codexScope).catch(showError));
  });
  document.querySelectorAll("[data-codex-shared-project]").forEach((button) => {
    button.addEventListener("click", () => selectCodexScope("shared", button.dataset.codexSharedProject).catch(showError));
  });
  document.querySelector("#codexFolderFilter")?.addEventListener("change", (event) => {
    activateCase(event.target.value);
  });
  document.querySelector("#codexFolderBack")?.addEventListener("click", () => activateCase(sharedParentCaseId()));
  document.querySelectorAll("[data-codex-type]").forEach((button) => {
    button.addEventListener("click", () => { state.typeFilter = button.dataset.codexType; render(); });
  });
  document.querySelectorAll("[data-codex-view]").forEach((button) => {
    button.addEventListener("click", () => { state.codexView = button.dataset.codexView; render(); });
  });
  els.codexNewProjectButton?.addEventListener("click", openCodexNewProjectDialog);
  els.codexNewProjectForm?.addEventListener("submit", createCodexProject);
  els.codexNewProjectDialog?.querySelectorAll("[data-codex-project-cancel]").forEach((button) => {
    button.addEventListener("click", closeCodexNewProjectDialog);
  });
  els.codexNewProjectDialog?.addEventListener("close", () => els.codexNewProjectButton?.focus());
  els.codexProjectSelect.addEventListener("change", () => {
    renderCodexTaskContext();
    selectProject(els.codexProjectSelect.value).catch(showError);
  });
  document.querySelectorAll("[data-codex-workspace]").forEach((button) => {
    button.addEventListener("click", () => {
      const projectId = button.dataset.codexWorkspace === "bound"
        ? state.codexBoundProject
        : button.dataset.codexWorkspace;
      if (projectId) selectProject(projectId).catch(showError);
    });
  });
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.data?.source !== "codex-sidebar-enhancer") return;
    if (event.data.action === "asset-added") showCodexAttachResult(1);
    if (event.data.action === "assets-added") showCodexAttachResult(Number(event.data.count) || 1);
    if (event.data.action === "asset-add-failed") showToast("没有找到当前任务输入框", { tone: "error" });
  });
  els.codexContinueChoosing?.addEventListener("click", () => hideCodexAttachResult({ focusGrid: true }));
  els.codexReturnToComposer?.addEventListener("click", returnToCodexComposer);
}

async function loadConfig() {
  const data = await api("/api/config");
  state.configEnabled = data.enabled !== false;
  state.automation = data.automation || state.automation;
  els.workflowEnabled.checked = state.configEnabled;
  renderAutomationForm();
}

async function loadProjects() {
  const data = await api("/api/projects");
  state.projects = data.projects;
  if (!state.codexEmbedded && !state.selectedProject) {
    const dailyEntry = state.projects.find((project) => project.id === "pending-review" && project.exists);
    state.selectedProject = state.codexEmbedded && dailyEntry ? dailyEntry.id : state.projects[0]?.id || "";
  }
  await loadCodexBinding();
  renderProjects();
  renderAutomationProjects();
  renderCodexTaskContext();
}

function renderAutomationProjects() {
  if (!els.inboxProject) return;
  const selected = state.automation?.inbox?.projectId || els.inboxProject.value || state.selectedProject;
  els.inboxProject.innerHTML = "";
  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = `${project.name}${project.exists ? "" : "（路径缺失）"}`;
    els.inboxProject.append(option);
  }
  if (state.projects.some((project) => project.id === selected)) els.inboxProject.value = selected;
}

function renderAutomationForm() {
  const automation = state.automation;
  if (!automation || !els.inboxSourcePath) return;
  const inbox = automation.inbox || {};
  const ticketedOnly = inbox.capturePolicy !== "all-downloads";
  const cleanup = automation.cleanup || {};
  document.querySelectorAll(".legacy-route-field").forEach((element) => {
    element.hidden = Boolean(automation.routing?.enabled);
  });
  document.querySelectorAll(".active-project-field").forEach((element) => {
    element.hidden = ticketedOnly;
  });
  els.previewOrganizer.hidden = ticketedOnly;
  els.runOrganizer.hidden = ticketedOnly;
  els.inboxEnabled.checked = Boolean(inbox.enabled);
  els.moveAfterArchive.checked = false;
  renderAutomationProfiles();
  els.inboxSourcePath.value = inbox.sourcePath || "";
  els.inboxPollSeconds.value = inbox.pollSeconds || 15;
  els.inboxBasePath.value = inbox.basePath || "";
  els.routeImage.value = inbox.routes?.image ?? "assets/inbox/images";
  els.routeVideo.value = inbox.routes?.video ?? "assets/inbox/videos";
  els.routeAudio.value = inbox.routes?.audio ?? "assets/inbox/audio";
  els.routeOther.value = inbox.routes?.other ?? "";
  els.cleanupEnabled.checked = Boolean(cleanup.enabled);
  els.retentionDays.value = cleanup.retentionDays || 30;
  els.cleanupIntervalHours.value = cleanup.intervalHours || 24;
  els.quarantinePath.value = cleanup.quarantinePath || "";
  els.cleanupDryRun.checked = cleanup.dryRun !== false;
  els.purgeEnabled.checked = Boolean(cleanup.purgeEnabled);
  els.quarantineDays.value = cleanup.quarantineDays || 14;
  renderAutomationProjects();
}

function renderAutomationProfiles() {
  if (!els.activeProfile) return;
  const routing = state.automation?.routing;
  els.activeProfile.innerHTML = "";
  if (!routing?.enabled || !routing.profiles?.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "未启用多项目分流";
    els.activeProfile.append(option);
    els.activeProfile.disabled = true;
    els.automationButton.textContent = "生成收件箱";
    return;
  }
  els.activeProfile.disabled = false;
  for (const profile of routing.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    els.activeProfile.append(option);
  }
  els.activeProfile.value = routing.activeProfileId;
  const active = routing.profiles.find((profile) => profile.id === routing.activeProfileId);
  els.automationButton.textContent = "生成收件箱";
}

function numericValue(element, fallback) {
  const value = Number(element.value);
  return Number.isFinite(value) ? value : fallback;
}

function collectAutomationForm() {
  return {
    inbox: {
      enabled: els.inboxEnabled.checked,
      capturePolicy: state.automation?.inbox?.capturePolicy || "ticketed-only",
      sourcePath: els.inboxSourcePath.value.trim(),
      projectId: els.inboxProject.value,
      basePath: els.inboxBasePath.value.trim(),
      startedAt: state.automation?.inbox?.startedAt || null,
      transferMode: "copy",
      moveApprovedAt: state.automation?.inbox?.moveApprovedAt || null,
      settleSeconds: state.automation?.inbox?.settleSeconds || 8,
      pollSeconds: numericValue(els.inboxPollSeconds, 15),
      routes: {
        image: els.routeImage.value.trim(),
        video: els.routeVideo.value.trim(),
        audio: els.routeAudio.value.trim(),
        other: els.routeOther.value.trim()
      }
    },
    routing: state.automation?.routing ? {
      ...state.automation.routing,
      activeProfileId: els.activeProfile.value || state.automation.routing.activeProfileId
    } : { enabled: false, profiles: [] },
    cleanup: {
      enabled: els.cleanupEnabled.checked,
      dryRun: els.cleanupDryRun.checked,
      intervalHours: numericValue(els.cleanupIntervalHours, 24),
      retentionDays: numericValue(els.retentionDays, 30),
      quarantinePath: els.quarantinePath.value.trim(),
      purgeEnabled: els.purgeEnabled.checked,
      quarantineDays: numericValue(els.quarantineDays, 14),
      onlyImported: true
    }
  };
}

async function saveAutomationSettings({ quiet = false } = {}) {
  const automation = collectAutomationForm();
  let confirmCleanup = false;
  let confirmPurge = false;
  let confirmMove = false;
  if (automation.cleanup.enabled && !automation.cleanup.dryRun) {
    confirmCleanup = window.confirm("确认启用实际清理？到期文件会先移入隔离区；只处理已归档且内容核对一致的原文件。");
    if (!confirmCleanup) return false;
  }
  if (automation.cleanup.purgeEnabled) {
    confirmPurge = window.confirm(`确认允许隔离区中的文件在 ${automation.cleanup.quarantineDays} 天后永久清空？`);
    if (!confirmPurge) return false;
  }
  const data = await api("/api/automation/settings", {
    method: "POST",
    body: JSON.stringify({ automation, confirmMove, confirmCleanup, confirmPurge })
  });
  state.automation = data.automation;
  renderAutomationForm();
  if (!quiet) showAutomationMessage("设置已保存", "自动归档和清理策略已经更新。");
  return true;
}

function showAutomationMessage(title, message, isError = false) {
  els.automationSummary.textContent = title;
  els.automationResult.innerHTML = "";
  const paragraph = document.createElement("p");
  paragraph.className = isError ? "result-error" : "";
  paragraph.textContent = message;
  els.automationResult.append(paragraph);
}

function showAutomationResult(title, data) {
  const groups = [
    ["planned", "准备归档"],
    ["imported", "已归档"],
    ["alreadyImported", "已归档过"],
    ["pending", "等待下载完成"],
    ["ignored", "已忽略"],
    ["candidates", "准备移入隔离区"],
    ["quarantined", "已移入隔离区"],
    ["purged", "已清空"],
    ["protectedItems", "受保护未处理"],
    ["failed", "失败"]
  ].filter(([key]) => Array.isArray(data[key]));
  const total = groups.reduce((sum, [key]) => sum + data[key].length, 0);
  els.automationSummary.textContent = `${title} · ${groups.map(([key, label]) => `${label} ${data[key].length}`).join(" / ")}`;
  els.automationResult.innerHTML = "";
  if (data.disabledReason) {
    const note = document.createElement("p");
    note.textContent = data.disabledReason;
    els.automationResult.append(note);
  }
  if (!total) {
    const empty = document.createElement("p");
    empty.textContent = data.disabledReason ? "没有已登记的生成结果需要处理。" : "没有需要处理的文件。";
    els.automationResult.append(empty);
    return;
  }
  for (const [key, label] of groups) {
    if (!data[key].length) continue;
    const section = document.createElement("section");
    const heading = document.createElement("h4");
    heading.textContent = `${label}（${data[key].length}）`;
    section.append(heading);
    const list = document.createElement("ul");
    for (const item of data[key].slice(0, 50)) {
      const row = document.createElement("li");
      const destination = item.destinationPath ? ` → ${item.destinationPath}` : "";
      const profile = item.profileName ? `[${item.profileName}] ` : "";
      row.textContent = `${profile}${item.name || item.sourcePath || "文件"}${destination}${item.reason ? ` · ${item.reason}` : ""}`;
      list.append(row);
    }
    if (data[key].length > 50) {
      const row = document.createElement("li");
      row.textContent = `其余 ${data[key].length - 50} 项未展开`;
      list.append(row);
    }
    section.append(list);
    els.automationResult.append(section);
  }
}

async function runAutomationAction(path, title, { saveFirst = false, confirmRun = false } = {}) {
  try {
    if (saveFirst && !await saveAutomationSettings({ quiet: true })) return;
    if (confirmRun && !window.confirm("确认执行本轮实际清理？符合条件的文件会移入隔离区。")) return;
    showAutomationMessage("正在处理", "正在核对文件，请稍候……");
    const data = await api(path, {
      method: "POST",
      body: JSON.stringify({ automation: collectAutomationForm(), confirm: confirmRun })
    });
    showAutomationResult(data.dryRun ? `${title}（仅预演）` : title, data);
    await loadAssets();
  } catch (error) {
    showAutomationMessage("操作未完成", error.message, true);
  }
}

async function openAutomationDialog() {
  await loadConfig();
  await loadProjects();
  els.automationDialog.showModal();
  try {
    const status = await api("/api/automation/status");
    if (status.organizerPreview) showAutomationResult("当前收件箱", status.organizerPreview);
    else if (status.organizerError) showAutomationMessage("需要设置", status.organizerError);
  } catch (error) {
    showAutomationMessage("状态读取失败", error.message, true);
  }
}

function governanceActionLabel(action) {
  return {
    "snapshot.created": "建立恢复点",
    "snapshot.restored": "恢复活动数据",
    "module.restored": "回滚工作台模块",
    "cache.cleared": "清理工作台缓存",
    "cache.auto-cleaned": "自动整理临时缓存",
    "workspace.mutation": "工作台变更"
  }[action] || action || "工作台变更";
}

function governanceDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { hour12: false });
}

function renderGovernanceStatus(data) {
  const tiers = data.tiers || {};
  els.governanceCacheSize.textContent = formatSize(tiers.cache?.bytes || 0);
  els.governanceActiveCount.textContent = `${(tiers.active?.items || []).filter((item) => item.exists).length} 项状态`;
  els.governanceArchiveCount.textContent = `${(tiers.archive?.items || []).filter((item) => item.exists).length} 个项目`;
  els.governanceModuleCount.textContent = `${(tiers.system?.modules || []).filter((item) => item.exists).length} 个模块`;

  els.governanceSnapshots.replaceChildren();
  const snapshots = data.snapshots || [];
  if (!snapshots.length) {
    els.governanceSnapshots.textContent = "尚未建立恢复点。";
  } else {
    for (const snapshot of snapshots.slice(0, 10)) {
      const row = document.createElement("article");
      row.className = "governance-list-row";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = snapshot.label || "恢复点";
      const meta = document.createElement("span");
      const stateCount = (snapshot.files || []).filter((item) => item.tier === "active").length;
      const moduleCount = (snapshot.files || []).filter((item) => item.tier === "system").length;
      meta.textContent = `${governanceDate(snapshot.createdAt)} · ${stateCount} 项状态${moduleCount ? ` · ${moduleCount} 个模块` : ""}`;
      copy.append(title, meta);
      const actions = document.createElement("div");
      actions.className = "governance-row-actions";
      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = "恢复状态";
      restore.addEventListener("click", async () => {
        if (!window.confirm(`恢复到“${snapshot.label || "这个恢复点"}”？恢复前会再自动建立一个安全恢复点。`)) return;
        restore.disabled = true;
        els.governanceMessage.textContent = "正在安全恢复活动数据……";
        try {
          const result = await api("/api/workspace-governance/restore", {
            method: "POST",
            body: JSON.stringify({ snapshotId: snapshot.id, confirm: true })
          });
          clearWorkspaceCaches();
          els.governanceMessage.textContent = `已恢复 ${result.result.restored.length} 项状态，并保留恢复前安全点。`;
          await loadGovernanceStatus();
        } catch (error) {
          els.governanceMessage.textContent = `恢复失败：${error.message}`;
        } finally {
          restore.disabled = false;
        }
      });
      actions.append(restore);
      if (snapshot.includesModules) {
        for (const [component, label] of [["frontend", "回滚界面"], ["backend", "回滚后端"]]) {
          const rollback = document.createElement("button");
          rollback.type = "button";
          rollback.textContent = label;
          rollback.addEventListener("click", async () => {
            const suffix = component === "backend" ? "服务会安全退出，关闭资产控制台后重新打开即可生效。" : "重新打开资产控制台后生效。";
            if (!window.confirm(`${label}到“${snapshot.label || "这个恢复点"}”？当前版本会先自动保存。${suffix}`)) return;
            rollback.disabled = true;
            els.governanceMessage.textContent = `正在${label}……`;
            try {
              const data = await api("/api/workspace-governance/modules/restore", {
                method: "POST",
                body: JSON.stringify({ snapshotId: snapshot.id, components: [component], confirm: true })
              });
              const count = data.result?.restored?.length || 0;
              els.governanceMessage.textContent = component === "backend"
                ? `已回滚 ${count} 个后端模块。请关闭资产控制台，再重新打开。`
                : `已回滚 ${count} 个界面模块。重新打开资产控制台即可看到旧版本。`;
              if (component !== "backend") await loadGovernanceStatus();
            } catch (error) {
              els.governanceMessage.textContent = `${label}失败：${error.message}`;
              rollback.disabled = false;
            }
          });
          actions.append(rollback);
        }
      }
      row.append(copy, actions);
      els.governanceSnapshots.append(row);
    }
  }

  els.governanceHistory.replaceChildren();
  const history = data.history || [];
  if (!history.length) {
    els.governanceHistory.textContent = "尚无工作台变更记录。";
  } else {
    for (const entry of history.slice(0, 12)) {
      const row = document.createElement("article");
      row.className = "governance-history-row";
      const label = document.createElement("strong");
      label.textContent = governanceActionLabel(entry.action);
      const detail = document.createElement("span");
      const route = entry.detail?.route ? ` · ${entry.detail.route.replace(/^\/api\//, "")}` : "";
      detail.textContent = `${governanceDate(entry.at)}${route}`;
      row.append(label, detail);
      els.governanceHistory.append(row);
    }
  }
}

async function loadGovernanceStatus() {
  const data = await api("/api/workspace-governance/status");
  renderGovernanceStatus(data);
  els.governanceMessage.textContent = "状态已同步。缓存超过 7 天或 512 MB 会自动整理，项目素材不会被自动处理。";
  return data;
}

async function openGovernanceDialog() {
  els.governanceDialog.showModal();
  els.governanceMessage.textContent = "正在读取工作台状态……";
  try {
    await loadGovernanceStatus();
  } catch (error) {
    els.governanceMessage.textContent = `状态读取失败：${error.message}`;
  }
}

async function createGovernanceSnapshot() {
  els.createGovernanceSnapshot.disabled = true;
  els.governanceMessage.textContent = "正在建立恢复点……";
  try {
    const data = await api("/api/workspace-governance/snapshots", {
      method: "POST",
      body: JSON.stringify({ label: `手动恢复点 ${new Date().toLocaleString("zh-CN", { hour12: false })}`, reason: "manual", includeModules: true })
    });
    const stateCount = data.snapshot.files.filter((item) => item.tier === "active").length;
    const moduleCount = data.snapshot.files.filter((item) => item.tier === "system").length;
    els.governanceMessage.textContent = `恢复点已建立：${stateCount} 项活动状态、${moduleCount} 个模块；未复制项目素材。`;
    await loadGovernanceStatus();
  } catch (error) {
    els.governanceMessage.textContent = `建立失败：${error.message}`;
  } finally {
    els.createGovernanceSnapshot.disabled = false;
  }
}

async function clearGovernanceCache() {
  if (!window.confirm("清理工作台拥有的临时缓存？项目素材、任务记录、配置和归档不会被删除。")) return;
  els.clearGovernanceCache.disabled = true;
  els.governanceMessage.textContent = "正在清理可重建缓存……";
  try {
    const data = await api("/api/workspace-governance/cache/clear", {
      method: "POST",
      body: JSON.stringify({ confirm: true })
    });
    clearWorkspaceCaches();
    const bytes = (data.result.cleared || []).reduce((sum, item) => sum + (item.bytes || 0), 0);
    els.governanceMessage.textContent = `缓存已清理，共释放 ${formatSize(bytes)}；活动数据和项目素材未改动。`;
    await loadGovernanceStatus();
  } catch (error) {
    els.governanceMessage.textContent = `清理失败：${error.message}`;
  } finally {
    els.clearGovernanceCache.disabled = false;
  }
}

function parseRhythmCues(value) {
  const cues = [];
  const invalid = [];
  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+(?:\.\d+)?)\s*(?:[|｜,，:：-]\s*)?(.+)$/);
    if (!match) {
      invalid.push(line);
      continue;
    }
    cues.push({ time: Number(match[1]), label: match[2].trim() });
  }
  if (invalid.length) throw new Error(`这些节奏点没有识别到秒数：${invalid.slice(0, 3).join("；")}`);
  return cues;
}

function renderRhythmSelectors() {
  const projectValue = els.rhythmProject.value || state.selectedProject || state.projects[0]?.id || "";
  els.rhythmProject.innerHTML = "";
  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    els.rhythmProject.append(option);
  }
  if (state.projects.some((project) => project.id === projectValue)) els.rhythmProject.value = projectValue;

  const currentProfile = els.rhythmProfile.value;
  const profiles = (state.automation?.routing?.profiles || []).filter((profile) => profile.projectId === els.rhythmProject.value);
  els.rhythmProfile.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "按项目自动安排";
  els.rhythmProfile.append(none);
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    els.rhythmProfile.append(option);
  }
  const suggested = profiles.find((profile) => profile.id === currentProfile)
    || profiles.find((profile) => profile.id === state.automation?.routing?.activeProfileId)
    || null;
  els.rhythmProfile.value = suggested?.id || "";
}

function renderGenerationRhythmSelector() {
  const previous = els.generationRhythmTrack.value || state.activeRhythmTrackId;
  const tracks = state.rhythmTracks.filter((track) => track.projectId === els.generationProject.value);
  els.generationRhythmTrack.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "不使用参考节奏音频";
  els.generationRhythmTrack.append(none);
  for (const track of tracks) {
    const option = document.createElement("option");
    option.value = track.id;
    option.textContent = `${track.name} · ${track.duration}秒 · ${track.mode === "sfx" ? "音效卡点" : track.mode === "hybrid" ? "音乐＋音效" : "音乐结构"}`;
    els.generationRhythmTrack.append(option);
  }
  if (tracks.some((track) => track.id === previous)) els.generationRhythmTrack.value = previous;
  updateGenerationRhythmHint();
}

function selectedRhythmTrack() {
  return state.rhythmTracks.find((track) => track.id === els.generationRhythmTrack.value) || null;
}

function updateGenerationRhythmHint() {
  const track = selectedRhythmTrack();
  if (!track) {
    els.generationRhythmHint.textContent = "选择后会把音频路径、节奏点和使用说明一起写进本次任务。";
    return;
  }
  els.generationRhythmHint.textContent = `将使用 ${track.duration} 秒控制轨；登记时自动追加画面节奏说明，但不要求最终成片保留这条音频。`;
}

async function revealRhythmTrack(track) {
  await api("/api/reveal", {
    method: "POST",
    body: JSON.stringify({ projectId: track.projectId, path: track.relativePath })
  });
}

function renderRhythmTracks() {
  els.rhythmTracks.innerHTML = "";
  if (!state.rhythmTracks.length) {
    els.rhythmTracks.textContent = "这个项目还没有控制轨。";
    return;
  }
  for (const track of state.rhythmTracks) {
    const card = document.createElement("article");
    card.className = `rhythm-track-card${track.id === state.activeRhythmTrackId ? " active" : ""}`;
    const head = document.createElement("div");
    head.className = "generation-ticket-head";
    const title = document.createElement("strong");
    title.textContent = track.name;
    const badge = document.createElement("span");
    badge.className = "generation-ticket-badge";
    badge.textContent = `${track.duration} 秒`;
    head.append(title, badge);
    const meta = document.createElement("p");
    meta.textContent = `${track.mode === "sfx" ? "音效卡点" : track.mode === "hybrid" ? "音乐底轨＋音效" : "音乐结构"} · ${track.bpm} BPM · ${track.cues?.length || 0} 个节奏点`;
    const player = document.createElement("audio");
    player.controls = true;
    player.preload = "metadata";
    player.src = track.mediaUrl || `/media?project=${encodeURIComponent(track.projectId)}&path=${encodeURIComponent(track.relativePath)}`;
    const actions = document.createElement("div");
    actions.className = "generation-ticket-actions";
    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.className = "primary";
    useButton.textContent = track.id === state.activeRhythmTrackId ? "已用于下一任务" : "用于下一任务";
    useButton.addEventListener("click", () => {
      state.activeRhythmTrackId = track.id;
      renderRhythmTracks();
      els.rhythmMessage.textContent = `已选择：${track.name}。打开“生成任务”后会自动带入。`;
    });
    const revealButton = document.createElement("button");
    revealButton.type = "button";
    revealButton.textContent = "打开位置";
    revealButton.addEventListener("click", () => revealRhythmTrack(track).catch(showError));
    actions.append(useButton, revealButton);
    card.append(head, meta, player, actions);
    els.rhythmTracks.append(card);
  }
}

async function loadRhythmTracks(projectId = "") {
  const targetProject = projectId || els.rhythmProject.value || els.generationProject.value || state.selectedProject;
  if (!targetProject) return;
  const data = await api(`/api/rhythm-control/status?project=${encodeURIComponent(targetProject)}`);
  state.rhythmTracks = data.tracks || [];
  state.rhythmCapabilities = data.capabilities || {};
  state.activeRhythmTrackId = data.activeTrackId || state.activeRhythmTrackId || "";
  const caps = state.rhythmCapabilities;
  els.rhythmCapability.textContent = `本地音效库 ${caps.sfxReady ? `可用（${caps.sfxCount} 条）` : "不可用"}；本地音乐 ${caps.musicReady ? "已启动" : caps.musicCanAutoStart ? "可自动启动" : "不可用"}。`;
  renderRhythmTracks();
  renderGenerationRhythmSelector();
}

async function createRhythmTrack() {
  const payload = {
    projectId: els.rhythmProject.value,
    profileId: els.rhythmProfile.value,
    duration: Number(els.rhythmDuration.value || 0),
    mode: els.rhythmMode.value,
    bpm: Number(els.rhythmBpm.value || 96),
    keyScale: els.rhythmKeyScale.value.trim(),
    name: els.rhythmName.value.trim(),
    destinationPath: els.rhythmDestination.value.trim(),
    description: els.rhythmDescription.value.trim(),
    musicPrompt: els.rhythmMusicPrompt.value.trim(),
    cues: parseRhythmCues(els.rhythmCues.value)
  };
  if (!payload.projectId) throw new Error("请选择归属项目");
  if (!payload.description) throw new Error("请先写清楚这段画面要发生什么");
  const originalLabel = els.createRhythmTrack.textContent;
  els.createRhythmTrack.disabled = true;
  els.createRhythmTrack.textContent = payload.mode === "sfx" ? "正在拼接控制轨…" : "正在生成音乐并拼接…";
  els.rhythmMessage.textContent = "正在制作，完成前不要关闭工作台。";
  try {
    const data = await api("/api/rhythm-control/create", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.activeRhythmTrackId = data.track.id;
    await loadRhythmTracks(payload.projectId);
    els.rhythmMessage.textContent = `已生成并选中：${data.track.name}。现在可以试听，之后打开“生成任务”会自动带入。`;
  } finally {
    els.createRhythmTrack.disabled = false;
    els.createRhythmTrack.textContent = originalLabel;
  }
}

async function openRhythmControlDialog() {
  await loadConfig();
  await loadProjects();
  renderRhythmSelectors();
  await loadRhythmTracks(els.rhythmProject.value);
  els.rhythmControlDialog.showModal();
}

function generationStatusLabel(status) {
  return {
    draft: "已登记",
    awaiting_download: "等待下一个下载",
    generated: "已生成，待归档",
    archived: "已归档",
    cancelled: "已取消"
  }[status] || status || "未知";
}

function renderGenerationSelectors() {
  const projectValue = els.generationProject.value || state.selectedProject;
  els.generationProject.innerHTML = "";
  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    els.generationProject.append(option);
  }
  if (state.projects.some((project) => project.id === projectValue)) {
    els.generationProject.value = projectValue;
  }

  const profiles = state.automation?.routing?.profiles || [];
  const requestedProfile = els.generationProfile.value || state.automation?.routing?.activeProfileId || "";
  const requestedProfileData = profiles.find((profile) => profile.id === requestedProfile);
  const profileValue = requestedProfileData?.projectId === els.generationProject.value ? requestedProfile : "";
  els.generationProfile.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "按项目自动安排";
  els.generationProfile.append(none);
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    els.generationProfile.append(option);
  }
  if ([...els.generationProfile.options].some((option) => option.value === profileValue)) {
    els.generationProfile.value = profileValue;
  }
}

function collectGenerationForm() {
  const rhythmTrack = selectedRhythmTrack();
  const basePrompt = els.generationPrompt.value.trim();
  const rhythmBlock = rhythmTrack
    ? `\n\n[参考音频节奏约束]\n本次同时提供参考音频“${rhythmTrack.name}”（${rhythmTrack.duration} 秒）。${rhythmTrack.roleContract}`
    : "";
  return {
    projectId: els.generationProject.value,
    profileId: els.generationProfile.value,
    kind: els.generationKind.value,
    generator: els.generationGenerator.value,
    episode: els.generationEpisode.value.trim(),
    scene: els.generationScene.value.trim(),
    shot: els.generationShot.value.trim(),
    role: els.generationRole.value.trim(),
    version: Number(els.generationVersion.value || 1),
    model: els.generationModel.value.trim(),
    destinationPath: els.generationDestination.value.trim(),
    nameStem: els.generationNameStem.value.trim(),
    prompt: `${basePrompt}${rhythmBlock}`.trim(),
    negativePrompt: els.generationNegative.value.trim(),
    references: rhythmTrack ? [rhythmTrack.absolutePath] : [],
    settings: rhythmTrack ? {
      referenceAudio: {
        id: rhythmTrack.id,
        path: rhythmTrack.absolutePath,
        relativePath: rhythmTrack.relativePath,
        sha256: rhythmTrack.sha256,
        targetDuration: rhythmTrack.duration,
        bpm: rhythmTrack.bpm,
        mode: rhythmTrack.mode,
        cueMap: rhythmTrack.cues,
        role: "visual-rhythm-control",
        retainInFinalAudio: false
      }
    } : {},
    sourceContext: {
      createdFrom: "asset-browser-ui",
      ...(state.codexEmbedded && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(state.codexThreadId || "")
        ? { threadId: state.codexThreadId, taskTitle: state.codexThreadTitle }
        : {})
    }
  };
}

async function generationAction(ticketId, action, body = {}) {
  await api(`/api/generation/tickets/${encodeURIComponent(ticketId)}/${action}`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  await loadGenerationTickets();
}

async function revealGenerationOutput(ticket, output) {
  await api("/api/reveal", {
    method: "POST",
    body: JSON.stringify({ projectId: ticket.projectId, path: output.relativePath, outputId: output.outputId || "" })
  });
}

function renderGenerationTickets() {
  els.generationTickets.innerHTML = "";
  const tickets = state.generationTickets;
  const activeCount = tickets.filter((ticket) => ["draft", "awaiting_download", "generated"].includes(ticket.status)).length;
  els.generationSummary.textContent = `${tickets.length} 个最近任务 · ${activeCount} 个进行中`;
  if (!tickets.length) {
    els.generationTickets.textContent = "尚无生成任务。";
    return;
  }

  for (const ticket of tickets) {
    const card = document.createElement("article");
    card.className = `generation-ticket status-${ticket.status}`;
    const head = document.createElement("div");
    head.className = "generation-ticket-head";
    const title = document.createElement("strong");
    title.textContent = ticket.nameStem;
    const badge = document.createElement("span");
    badge.className = "generation-ticket-badge";
    badge.textContent = generationStatusLabel(ticket.status);
    head.append(title, badge);

    const meta = document.createElement("p");
    meta.textContent = `${ticket.projectName} · ${ticket.kind === "video" ? "视频" : "图片"} · ${ticket.generator}${ticket.scene ? ` · ${ticket.scene}` : ""}${ticket.shot ? ` · ${ticket.shot}` : ""}`;
    const pathLine = document.createElement("p");
    pathLine.className = "mono generation-path";
    pathLine.textContent = ticket.outputs?.[0]?.relativePath || `${ticket.destinationRelativePath}\\${ticket.nameStem}`;
    card.append(head, meta, pathLine);

    const actions = document.createElement("div");
    actions.className = "generation-ticket-actions";
    if (ticket.status === "draft" || ticket.status === "generated") {
      const arm = document.createElement("button");
      arm.type = "button";
      arm.textContent = "等待下一个下载";
      arm.addEventListener("click", () => generationAction(ticket.id, "arm").catch(showError));
      actions.append(arm);
    }
    if (ticket.status === "awaiting_download") {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "停止等待";
      cancel.addEventListener("click", () => generationAction(ticket.id, "cancel", { reason: "用户停止等待" }).catch(showError));
      actions.append(cancel);
    }
    if (ticket.outputs?.length) {
      const revealButton = document.createElement("button");
      revealButton.type = "button";
      revealButton.textContent = "在文件夹中查看";
      revealButton.addEventListener("click", () => revealGenerationOutput(ticket, ticket.outputs[0]).catch(showError));
      actions.append(revealButton);
    }
    if (actions.childElementCount) card.append(actions);
    els.generationTickets.append(card);
  }
}

async function loadGenerationTickets() {
  const data = await api("/api/generation/tickets?limit=60");
  state.generationTickets = data.tickets || [];
  renderGenerationTickets();
}

async function createGenerationTicket({ arm = false } = {}) {
  const payload = collectGenerationForm();
  if (!payload.projectId) throw new Error("请选择归属项目");
  if (!els.generationPrompt.value.trim()) throw new Error("请写入本次实际使用的画面提示词");
  const data = await api("/api/generation/tickets", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  if (arm) await generationAction(data.ticket.id, "arm");
  else await loadGenerationTickets();
  return data.ticket;
}

async function openGenerationDialog() {
  await loadConfig();
  await loadProjects();
  renderGenerationSelectors();
  await loadRhythmTracks(els.generationProject.value);
  await loadGenerationTickets();
  els.generationDialog.showModal();
}

function commitCases(entry, projectId) {
  state.projectRoot = entry.projectRoot;
  state.cases = state.codexEmbedded
    ? [{ id: "__all__", name: "全部目录" }, ...entry.cases.filter((item) => item.id !== "__all__")]
    : entry.cases;
  if (!state.cases.some((item) => item.id === state.selectedCase)) {
    const defaultCase = state.codexEmbedded ? state.cases[0] : projectId === "dated-workspace"
      ? latestDailyCase(state.cases)
      : state.cases[0];
    state.selectedCase = defaultCase?.id || "";
  }
  renderCases();
}

function prepareAssetsForCaseChange(projectId) {
  const nextAssets = readWorkspaceCache(
    state.assetCache,
    workspaceCacheKey(projectId, state.selectedCase)
  );
  if (nextAssets) commitAssets(nextAssets.assets, { cached: true });
  else commitAssets([], { status: "文件夹已更新 · 正在读取素材" });
}

async function loadCases(options = {}) {
  if (!state.selectedProject) {
    if (state.codexEmbedded) { state.cases = []; state.selectedCase = ""; state.projectRoot = ""; }
    return;
  }
  const projectId = state.selectedProject;
  const workspaceGeneration = options.workspaceGeneration ?? state.workspaceSwitchGeneration;
  const isCurrentWorkspace = () => projectId === state.selectedProject
    && workspaceGeneration === state.workspaceSwitchGeneration;
  const cacheKey = workspaceCacheKey(projectId);
  if (!options.forceRefresh) {
    const cached = readWorkspaceCache(state.caseCache, cacheKey);
    if (cached && isCurrentWorkspace()) {
      commitCases(cached, projectId);
      void loadCases({ ...options, forceRefresh: true, revalidateAssetsOnCaseChange: true }).catch((error) => {
        if (isCurrentWorkspace()) els.refreshStatus.textContent = `已显示缓存，文件夹更新失败：${error.message}`;
      });
      return true;
    }
  }
  const loadGeneration = ++state.caseLoadGeneration;
  const cacheRequest = beginWorkspaceCacheRequest(state.caseCacheRequestGeneration, cacheKey);
  let data;
  let folderData;
  try {
    [data, folderData] = await Promise.all([
      api(`/api/cases?project=${encodeURIComponent(projectId)}`),
      api(`/api/folders?project=${encodeURIComponent(projectId)}`),
    ]);
  } catch (error) {
    finishWorkspaceCacheRequest(state.caseCacheRequestGeneration, cacheKey, cacheRequest);
    if (loadGeneration !== state.caseLoadGeneration
      || projectId !== state.selectedProject
      || workspaceGeneration !== state.workspaceSwitchGeneration) return false;
    throw error;
  }
  const project = state.projects.find((item) => item.id === projectId);
  const entry = {
    projectRoot: data.projectRoot,
    cases: completeCaseHierarchy(data.cases, project, folderData?.folders)
  };
  if (isCurrentWorkspaceCacheRequest(state.caseCacheRequestGeneration, cacheKey, cacheRequest)) {
    rememberWorkspaceCache(state.caseCache, cacheKey, entry);
  }
  finishWorkspaceCacheRequest(state.caseCacheRequestGeneration, cacheKey, cacheRequest);
  if (cacheRequest.epoch !== state.workspaceCacheEpoch
      || loadGeneration !== state.caseLoadGeneration
      || !isCurrentWorkspace()) return false;
  const previousCaseId = state.selectedCase;
  commitCases(entry, projectId);
  if ((options.prepareAssetsOnCaseChange || options.revalidateAssetsOnCaseChange)
      && previousCaseId !== state.selectedCase) {
    prepareAssetsForCaseChange(projectId);
  }
  if (options.revalidateAssetsOnCaseChange && previousCaseId !== state.selectedCase) {
    void loadAssets({ workspaceGeneration, forceRefresh: true }).catch((error) => {
      if (isCurrentWorkspace()) els.refreshStatus.textContent = `文件夹已更新，素材读取失败：${error.message}`;
    });
  }
  return true;
}

function commitAssets(assets, { cached = false, status = "" } = {}) {
  state.assets = assets;
  const availableKeys = new Set(state.assets.map(assetSelectionKey));
  state.selectedAssetKeys = new Set([...state.selectedAssetKeys].filter((key) => availableKeys.has(key)));
  if (state.selectedAsset) {
    state.selectedAsset = state.assets.find((asset) => asset.id === state.selectedAsset.id) || null;
  }
  render();
  updateBatchBar();
  els.refreshStatus.textContent = status || (cached ? "已显示缓存 · 正在后台更新" : `上次刷新 ${new Date().toLocaleTimeString()}`);
}

async function loadAssets(options = {}) {
  const projectId = state.selectedProject;
  const caseId = state.selectedCase;
  const sharedMidjourney = state.codexEmbedded && state.codexScope === "shared" && projectId === "mj-library";
  const casePath = sharedMidjourney && caseId !== "__all__"
    ? pathParts(state.cases.find((item) => item.id === caseId)?.relPath || caseId) : [];
  const workspaceGeneration = options.workspaceGeneration ?? state.workspaceSwitchGeneration;
  const isCurrentWorkspace = () => projectId === state.selectedProject
    && caseId === state.selectedCase
    && workspaceGeneration === state.workspaceSwitchGeneration;
  if (!caseId) {
    if (!isCurrentWorkspace()) return false;
    state.assets = [];
    render();
    updateBatchBar();
    return true;
  }
  state.deferredRefresh = null;
  const cacheKey = workspaceCacheKey(projectId, caseId);
  if (!options.forceRefresh) {
    const cached = readWorkspaceCache(state.assetCache, cacheKey);
    if (cached && isCurrentWorkspace()) {
      commitAssets(cached.assets, { cached: true });
      void loadAssets({ ...options, forceRefresh: true }).catch((error) => {
        if (isCurrentWorkspace()) els.refreshStatus.textContent = `缓存可用，后台更新失败：${error.message}`;
      });
      return true;
    }
  }
  const loadGeneration = ++state.assetLoadGeneration;
  const cacheRequest = beginWorkspaceCacheRequest(state.assetCacheRequestGeneration, cacheKey);
  const isCurrentLoad = () => cacheRequest.epoch === state.workspaceCacheEpoch
    && loadGeneration === state.assetLoadGeneration
    && isCurrentWorkspace();
  let data;
  try {
    data = await api(`/api/assets?project=${encodeURIComponent(projectId)}&case=${encodeURIComponent(sharedMidjourney ? "__all__" : caseId)}`);
    if (casePath.length) data.assets = data.assets.filter((asset) => {
      const parts = pathParts(asset.relPath).slice(0, -1);
      return casePath.every((part, index) => parts[index] === part);
    });
  } catch (error) {
    finishWorkspaceCacheRequest(state.assetCacheRequestGeneration, cacheKey, cacheRequest);
    if (!isCurrentLoad()) return false;
    throw error;
  }
  if (isCurrentWorkspaceCacheRequest(state.assetCacheRequestGeneration, cacheKey, cacheRequest)) {
    rememberWorkspaceCache(state.assetCache, cacheKey, { assets: data.assets });
  }
  finishWorkspaceCacheRequest(state.assetCacheRequestGeneration, cacheKey, cacheRequest);
  if (!isCurrentLoad()) return false;
  commitAssets(data.assets);
  return true;
}

function activeDetailMedia() {
  const media = els.detailPreview.querySelector("video, audio");
  return media && !media.paused && !media.ended ? media : null;
}

function resumeDeferredRefreshWhenPlaybackStops() {
  const media = els.detailPreview.querySelector("video, audio");
  if (!media || media.dataset.refreshResumeBound) return;
  media.dataset.refreshResumeBound = "true";
  const resume = () => {
    if (!activeDetailMedia()) flushDeferredRefresh().catch((error) => {
      els.refreshStatus.textContent = `刷新失败：${error.message}`;
    });
  };
  media.addEventListener("pause", resume);
  media.addEventListener("ended", resume);
}

async function performBackgroundRefresh(options = {}) {
  if (options.reloadProjects) await loadProjects();
  if (options.reloadCases) await loadCases({ forceRefresh: true });
  await loadAssets({ forceRefresh: true });
}

async function performManualRefresh() {
  const workspaceGeneration = state.workspaceSwitchGeneration;
  await loadProjects();
  if (workspaceGeneration !== state.workspaceSwitchGeneration) return false;
  const casesLoaded = await loadCases({
    workspaceGeneration,
    forceRefresh: true,
    prepareAssetsOnCaseChange: true
  });
  if (!casesLoaded) return false;
  return loadAssets({ workspaceGeneration, forceRefresh: true });
}

function deferBackgroundRefresh(options = {}) {
  const previous = state.deferredRefresh || {};
  state.deferredRefresh = {
    reloadProjects: Boolean(previous.reloadProjects || options.reloadProjects),
    reloadCases: Boolean(previous.reloadCases || options.reloadCases || options.reloadProjects)
  };
  els.refreshStatus.textContent = "预览打开期间已暂停自动刷新";
}

async function requestBackgroundRefresh(options = {}) {
  const media = activeDetailMedia();
  if (media) {
    deferBackgroundRefresh(options);
    return false;
  }
  await performBackgroundRefresh(options);
  return true;
}

async function flushDeferredRefresh() {
  const pending = state.deferredRefresh;
  if (!pending) return;
  state.deferredRefresh = null;
  await performBackgroundRefresh(pending);
}

function renderProjects() {
  els.projectList.innerHTML = "";
  for (const item of state.projects) {
    const button = document.createElement("button");
    button.className = `project-item${item.id === state.selectedProject ? " active" : ""}`;
    button.dataset.projectId = item.id;
    button.draggable = true;
    const handle = document.createElement("span");
    handle.className = "project-drag-handle";
    handle.textContent = "⠿";
    handle.title = "拖动调整顺序";
    handle.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "project-name";
    name.textContent = item.name;
    const status = document.createElement("span");
    status.className = `project-status ${item.exists ? "online" : "missing"}`;
    status.textContent = item.exists ? "可用" : "缺失";
    button.append(handle, name, status);
    button.title = item.path;
    button.addEventListener("dragstart", (event) => {
      state.draggedProjectId = item.id;
      state.suppressProjectClick = true;
      button.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
      }
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("dragging");
      state.draggedProjectId = "";
      window.setTimeout(() => {
        state.suppressProjectClick = false;
      }, 120);
    });
    button.addEventListener("click", () => {
      if (state.suppressProjectClick) return;
      void selectProject(item.id).catch(showError);
    });
    els.projectList.append(button);
  }
}

async function saveProjectOrder() {
  const projectIds = [...els.projectList.querySelectorAll(".project-item")]
    .map((item) => item.dataset.projectId)
    .filter(Boolean);
  const data = await api("/api/projects/reorder", {
    method: "POST",
    body: JSON.stringify({ projectIds })
  });
  state.projects = data.projects;
  renderProjects();
  renderAutomationProjects();
  els.refreshStatus.textContent = "项目顺序已保存";
}

function wireProjectReorder() {
  els.projectList.addEventListener("dragover", (event) => {
    const dragging = els.projectList.querySelector(".project-item.dragging");
    if (!dragging) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const target = event.target.closest(".project-item");
    if (!target) {
      els.projectList.append(dragging);
      return;
    }
    if (target === dragging) return;
    const rect = target.getBoundingClientRect();
    const placeAfter = event.clientY > rect.top + rect.height / 2;
    els.projectList.insertBefore(dragging, placeAfter ? target.nextSibling : target);
  });
  els.projectList.addEventListener("drop", (event) => {
    event.preventDefault();
    saveProjectOrder().catch(async (error) => {
      els.refreshStatus.textContent = `顺序保存失败：${error.message}`;
      await loadProjects();
    });
  });
}

const sidebarLayoutStorageKey = "asset-browser.sidebar-layout.v1";

function readSidebarLayout() {
  try {
    return JSON.parse(window.localStorage.getItem(sidebarLayoutStorageKey) || "{}") || {};
  } catch {
    return {};
  }
}

function saveSidebarLayout() {
  if (!els.sidebarLayout) return;
  const modules = [...els.sidebarLayout.querySelectorAll(".sidebar-module")];
  const payload = {
    order: modules.map((module) => module.dataset.sectionId).filter(Boolean),
    open: Object.fromEntries(modules.map((module) => [module.dataset.sectionId, module.open]))
  };
  try {
    window.localStorage.setItem(sidebarLayoutStorageKey, JSON.stringify(payload));
  } catch {
    // The layout still works for the current page even when local storage is unavailable.
  }
}

function wireSidebarLayout() {
  if (!els.sidebar || !els.sidebarLayout) return;
  const saved = readSidebarLayout();
  const modules = [...els.sidebarLayout.querySelectorAll(".sidebar-module")];
  const byId = new Map(modules.map((module) => [module.dataset.sectionId, module]));
  for (const id of saved.order || []) {
    const module = byId.get(id);
    if (!module) continue;
    els.sidebarLayout.append(module);
    byId.delete(id);
  }
  for (const module of modules) {
    if (byId.has(module.dataset.sectionId)) els.sidebarLayout.append(module);
  }

  for (const module of modules) {
    const id = module.dataset.sectionId;
    if (saved.open && Object.prototype.hasOwnProperty.call(saved.open, id)) {
      module.open = Boolean(saved.open[id]);
    }
    module.addEventListener("toggle", saveSidebarLayout);
    const handle = module.querySelector(":scope > .section-summary .sidebar-module-grip");
    if (!handle) continue;
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("dragstart", (event) => {
      module.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
      }
    });
    handle.addEventListener("dragend", () => {
      module.classList.remove("dragging");
      saveSidebarLayout();
    });
  }

  els.sidebarLayout.addEventListener("dragover", (event) => {
    const dragging = els.sidebarLayout.querySelector(".sidebar-module.dragging");
    if (!dragging) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const eventElement = event.target instanceof Element ? event.target : null;
    const target = eventElement?.closest(".sidebar-module");
    if (!target) {
      els.sidebarLayout.append(dragging);
      return;
    }
    if (target === dragging) return;
    const rect = target.getBoundingClientRect();
    const placeAfter = event.clientY > rect.top + rect.height / 2;
    els.sidebarLayout.insertBefore(dragging, placeAfter ? target.nextSibling : target);
  });
  els.sidebarLayout.addEventListener("drop", (event) => {
    const dragging = els.sidebarLayout.querySelector(".sidebar-module.dragging");
    if (!dragging) return;
    event.preventDefault();
    saveSidebarLayout();
    els.refreshStatus.textContent = "左栏布局已保存";
  });

  els.sidebar.addEventListener("wheel", (event) => {
    if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const scale = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? els.sidebar.clientHeight : 1;
    const previous = els.sidebar.scrollTop;
    els.sidebar.scrollTop += event.deltaY * scale;
    if (els.sidebar.scrollTop !== previous) event.preventDefault();
  }, { passive: false });
}

function pathParts(value) {
  return String(value || "").split(/[\\/]+/).filter(Boolean).filter((part) => part !== ".");
}

function isDailyDateCase(item) {
  const parts = pathParts(item?.relPath || item?.id);
  if (parts.length !== 1) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parts[0]);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function latestDailyCase(cases) {
  const topLevelCases = (cases || []).filter((item) => pathParts(item?.relPath || item?.id).length === 1);
  return topLevelCases
    .filter(isDailyDateCase)
    .sort((a, b) => String(b.relPath || b.id).localeCompare(String(a.relPath || a.id)))[0]
    || topLevelCases[0]
    || cases?.[0];
}

function completeCaseHierarchy(cases, project, folders = []) {
  const originalCases = (cases || []).map((item) => ({ ...item }));
  const entries = new Map();
  const keyFor = (value) => pathParts(value).join("/");
  for (const item of originalCases) entries.set(keyFor(item.relPath || item.id), item);

  const originalPaths = originalCases.map((item) => ({ item, parts: pathParts(item.relPath || item.id) }));
  const descendantCount = (parts) => {
    const descendants = originalPaths.filter((entry) => entry.parts.length > parts.length
      && parts.every((part, index) => entry.parts[index] === part));
    const topLevelDescendants = descendants.filter((entry) => !descendants.some((candidate) => (
      candidate !== entry
      && candidate.parts.length < entry.parts.length
      && candidate.parts.every((part, index) => entry.parts[index] === part)
    )));
    return topLevelDescendants.reduce((sum, entry) => sum + Number(entry.item.mediaCount || 0), 0);
  };
  const addSyntheticPath = (parts, scanRoot = ".") => {
    const key = parts.join("/");
    if (entries.has(key)) return;
    const relPath = parts.length ? parts.join("\\") : ".";
    entries.set(key, {
      id: relPath,
      name: parts.at(-1) || project?.name || "全部素材",
      relPath,
      scanRoot,
      mediaCount: descendantCount(parts),
      synthetic: true,
    });
  };

  addSyntheticPath([], ".");
  for (const root of projectScanRootDirectories(project || {})) {
    const parts = pathParts(root);
    for (let depth = 1; depth <= parts.length; depth += 1) {
      addSyntheticPath(parts.slice(0, depth), parts[0] || ".");
    }
  }
  for (const { parts, item } of originalPaths) {
    for (let depth = 1; depth < parts.length; depth += 1) {
      addSyntheticPath(parts.slice(0, depth), item.scanRoot || parts[0] || ".");
    }
  }
  const scanRoots = projectScanRootDirectories(project || {});
  for (const folder of folders || []) {
    const directory = normalizeProjectDirectory(folder?.path);
    if (directory === null || !directory) continue;
    const insideScanRoot = !scanRoots.length || scanRoots.includes("")
      || scanRoots.some((root) => directory === root || directory.startsWith(`${root}/`));
    if (!insideScanRoot) continue;
    const parts = pathParts(directory);
    const scanRoot = scanRoots.find((root) => directory === root || directory.startsWith(`${root}/`)) || parts[0] || ".";
    for (let depth = 1; depth <= parts.length; depth += 1) addSyntheticPath(parts.slice(0, depth), scanRoot);
  }
  return [...entries.values()];
}

function episodeRank(name) {
  const ranks = ["第一集", "第二集", "第三集", "第四集", "第五集", "第六集"];
  const rank = ranks.findIndex((label) => String(name || "").startsWith(label));
  return rank === -1 ? 999 : rank;
}

function caseRank(name) {
  const order = new Map([["参考", 0], ["生成视频", 1], ["成片", 2]]);
  return order.has(name) ? order.get(name) : 100;
}

function makeCaseButton(item, label) {
  const button = document.createElement("button");
  button.className = `tree-item${item.id === state.selectedCase ? " active" : ""}`;
  if (item.id === state.selectedCase) button.setAttribute("aria-current", "page");
  const name = document.createElement("span");
  name.className = "tree-item-name";
  name.textContent = label;
  const count = document.createElement("span");
  count.className = "tree-item-count";
  count.textContent = String(item.mediaCount ?? 0);
  button.append(name, count);
  button.title = item.relPath || item.id;
  button.addEventListener("click", () => activateCase(item.id));
  return button;
}

function activateCase(caseId) {
  void selectCase(caseId).catch(showError);
}

async function selectCase(caseId) {
  if (!caseId || caseId === state.selectedCase || !state.cases.some((item) => item.id === caseId)) return;
  const previousCase = state.selectedCase;
  const previousCategoryFilter = state.categoryFilter;
  const generation = ++state.workspaceSwitchGeneration;
  const transition = await beginWorkspaceSwitch(generation);
  if (generation !== state.workspaceSwitchGeneration) {
    releaseWorkspaceSwitch(transition);
    return;
  }
  state.selectedCase = caseId;
  state.selectedAsset = null;
  exitSelectionMode();
  setCategoryFilter("");
  renderCases();
  try {
    await loadAssets({ workspaceGeneration: generation });
  } catch (error) {
    if (generation === state.workspaceSwitchGeneration && state.selectedCase === caseId) {
      state.selectedCase = previousCase;
      setCategoryFilter(previousCategoryFilter);
      renderCases();
      render();
    }
    throw error;
  } finally {
    finishWorkspaceSwitch(transition);
  }
}

function configureCaseGroup(group, key, defaultOpen = false) {
  const hasSavedState = Object.prototype.hasOwnProperty.call(state.caseGroupOpen, key);
  group.open = hasSavedState ? state.caseGroupOpen[key] : defaultOpen;
  group.addEventListener("toggle", () => {
    state.caseGroupOpen[key] = group.open;
  });
}

function renderSeriesCases() {
  for (const { episode, entries, rootItem, total } of seriesEpisodeGroups(state.cases)) {
    const hasActive = rootItem?.id === state.selectedCase || entries.some(({ item }) => item.id === state.selectedCase);
    const group = document.createElement("details");
    group.className = `case-group${hasActive ? " has-active" : ""}`;
    configureCaseGroup(group, `${state.selectedProject}:${episode}`, hasActive);
    const head = document.createElement("summary");
    head.className = "case-group-head";
    const title = document.createElement("strong");
    title.textContent = episode;
    const count = document.createElement("span");
    count.textContent = `${total} 个素材`;
    head.append(title, count);
    const children = document.createElement("div");
    children.className = "case-group-children";
    if (rootItem) children.append(makeCaseButton(rootItem, "全部"));
    for (const { item, parts } of entries) children.append(makeCaseButton(item, parts.slice(1).join(" / ")));
    group.append(head, children);
    els.caseList.append(group);
  }
}

function seriesEpisodeGroups(cases) {
  const episodeRoots = new Map();
  const grouped = new Map();
  for (const item of cases || []) {
    const parts = pathParts(item.relPath || item.id);
    if (parts.length === 1) {
      episodeRoots.set(parts[0], item);
      continue;
    }
    if (parts.length < 2) continue;
    const episode = parts[0];
    if (!grouped.has(episode)) grouped.set(episode, []);
    grouped.get(episode).push({ item, parts });
  }
  const episodes = [...new Set([...episodeRoots.keys(), ...grouped.keys()])]
    .sort((a, b) => episodeRank(a) - episodeRank(b) || a.localeCompare(b, "zh-CN"));
  return episodes.map((episode) => {
    const entries = grouped.get(episode) || [];
    entries.sort((a, b) => caseRank(a.parts[1]) - caseRank(b.parts[1]) || a.parts.slice(1).join("/").localeCompare(b.parts.slice(1).join("/"), "zh-CN"));
    const rootItem = episodeRoots.get(episode);
    const total = rootItem
      ? Number(rootItem.mediaCount || 0)
      : entries.reduce((sum, { item }) => sum + Number(item.mediaCount || 0), 0);
    return { episode, entries, rootItem, total };
  });
}

function appendDailyCaseGroup(titleText, items, key, countSuffix, defaultOpen) {
  if (!items.length) return;
  const hasActive = items.some((item) => item.id === state.selectedCase);
  const group = document.createElement("details");
  group.className = `case-group daily-group${hasActive ? " has-active" : ""}`;
  configureCaseGroup(group, `${state.selectedProject}:${key}`, defaultOpen || hasActive);
  const head = document.createElement("summary");
  head.className = "case-group-head";
  const title = document.createElement("strong");
  title.textContent = titleText;
  const total = document.createElement("span");
  total.textContent = `${items.length} ${countSuffix}`;
  head.append(title, total);
  const children = document.createElement("div");
  children.className = "case-group-children";
  for (const item of items) {
    children.append(makeCaseButton(item, pathParts(item.relPath || item.id).join(" / ") || item.name));
  }
  group.append(head, children);
  els.caseList.append(group);
}

function renderDailyCases() {
  const topLevelCases = state.cases.filter((item) => pathParts(item.relPath || item.id).length === 1);
  const dateCases = topLevelCases
    .filter(isDailyDateCase)
    .sort((a, b) => String(b.relPath || b.id).localeCompare(String(a.relPath || a.id)));
  const otherCases = topLevelCases
    .filter((item) => !isDailyDateCase(item))
    .sort((a, b) => String(a.name || a.relPath || a.id).localeCompare(String(b.name || b.relPath || b.id), "zh-CN"));
  appendDailyCaseGroup("按日期", dateCases, "dates", "天", true);
  appendDailyCaseGroup("其他文件夹", otherCases, "other-folders", "个", false);
}

function renderHierarchicalCases() {
  const entries = state.cases.map((item) => ({ item, parts: pathParts(item.relPath || item.id) }));
  const roots = entries.filter(({ parts }) => parts.length === 1);
  for (const root of roots) {
    const descendants = entries
      .filter(({ parts }) => parts.length > 1 && parts[0] === root.parts[0])
      .sort((a, b) => a.parts.length - b.parts.length || a.parts.slice(1).join("/").localeCompare(b.parts.slice(1).join("/"), "zh-CN"));
    if (!descendants.length) {
      els.caseList.append(makeCaseButton(root.item, root.item.name));
      continue;
    }
    const hasActive = state.selectedCase === root.item.id || descendants.some(({ item }) => item.id === state.selectedCase);
    const group = document.createElement("details");
    group.className = `case-group${hasActive ? " has-active" : ""}`;
    configureCaseGroup(group, `${state.selectedProject}:${root.item.id}`, true);
    const head = document.createElement("summary");
    head.className = "case-group-head";
    const title = document.createElement("strong");
    title.textContent = root.item.name;
    const total = document.createElement("span");
    total.textContent = `${root.item.mediaCount || 0} 个素材`;
    head.append(title, total);
    const children = document.createElement("div");
    children.className = "case-group-children";
    children.append(makeCaseButton(root.item, "全部"));
    for (const { item, parts } of descendants) {
      children.append(makeCaseButton(item, parts.slice(1).join(" / ")));
    }
    group.append(head, children);
    els.caseList.append(group);
  }
}

function folderOverviewContext() {
  if (state.codexEmbedded) return null;
  const root = state.cases.find((item) => item.id === state.selectedCase);
  if (!root) return null;
  const rootParts = pathParts(root.relPath || root.id);
  const children = state.cases
    .map((item) => ({ item, parts: pathParts(item.relPath || item.id) }))
    .filter(({ parts }) => parts.length === rootParts.length + 1 && rootParts.every((part, index) => parts[index] === part))
    .sort((a, b) => a.parts.at(-1).localeCompare(b.parts.at(-1), "zh-CN"));
  return children.length ? { root, rootParts, children } : null;
}

function pickFolderPreviewAssets(assets, limit = 4) {
  const sorted = [...assets].sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name, "zh-CN"));
  if (sorted.length <= limit) return sorted;
  const indexes = new Set();
  for (let index = 0; index < limit; index += 1) {
    indexes.add(Math.round(index * (sorted.length - 1) / (limit - 1)));
  }
  return [...indexes].map((index) => sorted[index]);
}

function sharedParentCaseId() {
  const current = state.cases.find((item) => item.id === state.selectedCase);
  const parts = pathParts(current?.relPath || state.selectedCase).slice(0, -1);
  if (!parts.length) return "__all__";
  return state.cases.find((item) => pathParts(item.relPath || item.id).join("/") === parts.join("/"))?.id || "__all__";
}

function sharedAssetCollections(assets) {
  if (!state.codexEmbedded || state.codexScope !== "shared" || state.query.trim() || state.multiSelect) return null;
  const current = state.cases.find((item) => item.id === state.selectedCase);
  const rootParts = state.selectedCase === "__all__" ? [] : pathParts(current?.relPath || state.selectedCase);
  const cases = new Map(state.cases.filter((item) => item.id !== "__all__")
    .map((item) => [pathParts(item.relPath || item.id).join("/"), item]));
  const folders = new Map();
  const loose = [];
  for (const asset of assets) {
    const assetParts = pathParts(asset.relPath).slice(0, -1);
    if (!rootParts.every((part, index) => assetParts[index] === part) || assetParts.length <= rootParts.length) {
      loose.push(asset); continue;
    }
    const parts = assetParts.slice(0, rootParts.length + 1);
    const key = parts.join("/");
    const item = key && cases.get(key);
    if (!item) { loose.push(asset); continue; }
    if (!folders.has(key)) folders.set(key, { entry: { item, parts }, assets: [] });
    folders.get(key).assets.push(asset);
  }
  return folders.size ? { folders: [...folders.values()].sort((a, b) => a.entry.parts.at(-1).localeCompare(b.entry.parts.at(-1), "zh-CN")), loose } : null;
}

function renderSharedCollections(collections) {
  const sections = new Map();
  for (const folder of collections.folders) {
    const section = folder.entry.parts.length > 1 ? folder.entry.parts.at(-2) : state.selectedProject === "mj-library" ? "P值" : "分类";
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push(folder);
  }
  for (const [name, folders] of sections) {
    const mjProfileGroup = state.selectedProject === "mj-library" && folders[0].entry.parts.length === 1;
    const heading = document.createElement("h3");
    heading.className = "resource-collection-section";
    heading.textContent = `${name} · ${folders.length} 个${mjProfileGroup ? "组合" : "合集"}`;
    els.assetGrid.append(heading);
    if (mjProfileGroup) {
      const note = document.createElement("p");
      note.className = "resource-collection-section";
      note.textContent = "按文件名记录的 P 组合";
      els.assetGrid.append(note);
    }
    for (const folder of folders) els.assetGrid.append(renderFolderPreviewCard(folder.entry, folder.assets));
  }
  if (collections.loose.length) {
    const heading = document.createElement("h3");
    heading.className = "resource-collection-section";
    heading.textContent = "独立文件";
    els.assetGrid.append(heading);
    for (const asset of collections.loose) els.assetGrid.append(renderAssetCard(asset));
  }
}

function renderFolderPreviewCard(entry, assets) {
  const card = document.createElement("article");
  card.className = "style-folder-card";
  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.className = "folder-card-preview-button";
  const previewAssets = pickFolderPreviewAssets(assets);
  const preview = document.createElement("div");
  preview.className = `folder-preview-grid folder-preview-count-${previewAssets.length}`;
  if (previewAssets.length) {
    preview.innerHTML = previewAssets.map((asset) => mediaPreview(asset)).join("");
  } else {
    preview.innerHTML = '<div class="folder-preview-empty">暂无预览</div>';
  }
  const body = document.createElement("div");
  body.className = "folder-card-body";
  const heading = document.createElement("div");
  heading.className = "folder-card-heading";
  const title = document.createElement("strong");
  title.textContent = entry.parts.at(-1) || entry.item.name;
  title.title = entry.item.relPath || entry.item.id;
  if (state.codexEmbedded && state.selectedProject === "mj-library") {
    title.textContent = title.textContent.replaceAll("+", " + ");
    title.style.webkitLineClamp = "unset";
  }
  const actions = document.createElement("div");
  actions.className = "folder-card-actions";
  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.className = "folder-card-rename";
  renameButton.textContent = "改名";
  renameButton.title = `修改“${title.textContent}”的名称`;
  renameButton.addEventListener("click", () => openRenameFolderDialog(entry.item, renameButton));
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "folder-card-open-button";
  openButton.textContent = "打开";
  openButton.title = `打开 ${title.textContent}`;
  openButton.addEventListener("click", () => activateCase(entry.item.id));
  if (!state.codexEmbedded) actions.append(renameButton);
  actions.append(openButton);
  heading.append(title, actions);
  const meta = document.createElement("p");
  const parent = entry.parts.slice(1, -1).join(" / ");
  meta.textContent = state.codexEmbedded
    ? `${assets.length} 项${parent ? ` · ${parent}` : ""}`
    : `${entry.item.mediaCount ?? assets.length} 个素材`;
  body.append(heading);
  const profileName = entry.parts.at(-1) || "";
  if (state.codexEmbedded && state.selectedProject === "mj-library" && /^P-[a-z0-9]+(?:\+[a-z0-9]+)*$/i.test(profileName)) {
    const parameter = `--p ${profileName.slice(2).replaceAll("+", " ")}`;
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "folder-card-copy-p";
    copyButton.textContent = "复制 P";
    copyButton.title = `复制 ${parameter}`;
    copyButton.setAttribute("aria-label", `复制 P 值参数 ${parameter}`);
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(parameter);
        showToast("已复制 P 值参数");
      } catch (error) {
        showError(error);
      }
    });
    const footer = document.createElement("div");
    footer.className = "folder-card-actions folder-card-footer";
    footer.append(meta, copyButton);
    body.append(footer);
  } else {
    body.append(meta);
  }
  previewButton.append(preview);
  previewButton.title = `打开 ${title.textContent}`;
  previewButton.setAttribute("aria-label", `打开文件夹 ${title.textContent}`);
  previewButton.addEventListener("click", () => activateCase(entry.item.id));
  card.append(previewButton, body);
  return card;
}

function renderFolderOverview(context) {
  const query = state.query.trim().toLowerCase();
  const folders = context.children.map((entry) => {
    const childName = entry.parts[context.rootParts.length];
    const assets = state.assets.filter((asset) => pathParts(asset.caseRelPath)[0] === childName);
    return { entry, assets };
  }).filter(({ entry, assets }) => {
    if (!query) return true;
    const haystack = [entry.parts.at(-1), ...assets.map((asset) => asset.name)].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  renderCategoryCounts();
  els.assetCount.textContent = `文件夹：${folders.length} / ${context.children.length} 个，共 ${state.assets.length} 个素材`;
  els.assetGrid.classList.add("folder-overview-grid");
  deferredMediaObserver?.disconnect();
  els.assetGrid.innerHTML = "";
  if (!folders.length) {
    els.assetGrid.innerHTML = `
      <div class="empty-state">
        <h3>没有匹配的风格文件夹</h3>
        <p>清空搜索词后可查看全部风格目录。</p>
      </div>
    `;
  } else {
    const fragment = document.createDocumentFragment();
    for (const folder of folders) fragment.append(renderFolderPreviewCard(folder.entry, folder.assets));
    els.assetGrid.append(fragment);
  }
  observeDeferredMedia();
  renderDetail();
}

function renderCases() {
  els.caseList.innerHTML = "";
  if (state.selectedProject === "episode-series") return renderSeriesCases();
  if (state.selectedProject === "dated-workspace") return renderDailyCases();
  if (state.cases.some((item) => pathParts(item.relPath || item.id).length > 1)) return renderHierarchicalCases();
  for (const item of state.cases) {
    const label = pathParts(item.relPath || item.id).join(" / ") || item.name;
    els.caseList.append(makeCaseButton(item, label));
  }
}

function renderCategoryCounts() {
  const counts = { videoResult: 0, generatedAsset: 0, reference: 0, reverse: 0, audio: 0, "": state.assets.length };
  for (const asset of state.assets.map(enrichAsset)) {
    counts[asset.category] = (counts[asset.category] || 0) + 1;
  }
  els.categoryFilters.querySelectorAll("[data-category]").forEach((button) => {
    const category = button.dataset.category;
    const label = categoryLabels[category] || "全部资产";
    button.innerHTML = `<span>${label}</span><small>${counts[category] || 0}</small>`;
  });
}

function renderSmartGroupCounts() {
  const counts = { official: 0, review: 0, noise: 0, "": state.assets.length };
  for (const asset of state.assets.map(enrichAsset)) counts[classificationOf(asset).group] += 1;
  els.smartGroupFilters?.querySelectorAll("[data-smart-group]").forEach((button) => {
    const group = button.dataset.smartGroup;
    button.innerHTML = `<span>${ASSET_GROUPS[group] || "全部分组"}</span><small>${counts[group] || 0}</small>`;
  });
}

function setCategoryFilter(category) {
  state.categoryFilter = category;
  els.categoryFilters.querySelectorAll("[data-category]").forEach((button) => {
    button.classList.toggle("active", button.dataset.category === category);
  });
  if (els.embeddedCategoryFilter) els.embeddedCategoryFilter.value = category;
  syncEmbeddedFilterControls();
}

function syncEmbeddedFilterControls() {
  if (!state.codexEmbedded || !els.embeddedFilterCount) return;
  if (els.embeddedCategoryFilter) els.embeddedCategoryFilter.value = state.categoryFilter;
  if (els.embeddedSmartGroupFilter) els.embeddedSmartGroupFilter.value = state.smartGroupFilter;
  if (els.embeddedStatusFilter) els.embeddedStatusFilter.value = state.statusFilter;
  if (els.embeddedTypeFilter) els.embeddedTypeFilter.value = state.typeFilter;
  const count = [state.categoryFilter, state.smartGroupFilter, state.statusFilter, state.typeFilter].filter(Boolean).length;
  els.embeddedFilterCount.textContent = String(count);
  els.embeddedFilterCount.hidden = count === 0;
  els.embeddedFilterMenu?.classList.toggle("has-filters", count > 0);
}

function clearAssetDiscoveryFilters() {
  state.query = "";
  state.smartGroupFilter = "";
  state.statusFilter = "";
  state.typeFilter = "";
  if (els.searchInput) els.searchInput.value = "";
  setCategoryFilter("");
  els.smartGroupFilters?.querySelectorAll("[data-smart-group]").forEach((button) => button.classList.toggle("active", !button.dataset.smartGroup));
  els.statusFilters.querySelectorAll("[data-status]").forEach((button) => button.classList.toggle("active", !button.dataset.status));
  els.typeFilters.querySelectorAll("[data-type]").forEach((button) => button.classList.toggle("active", !button.dataset.type));
  els.embeddedFilterMenu?.removeAttribute("open");
  render();
  els.searchInput?.focus();
}

function filteredAssets() {
  const q = state.query.trim().toLowerCase();
  const enriched = state.assets.map(enrichAsset);
  let assets = enriched.filter((asset) => {
    if (state.codexEmbedded && state.codexExcludedTypes?.includes(resourceFilterKind(asset))) return false;
    const status = displayStatus(asset);
    const classification = classificationOf(asset);
    if (state.categoryFilter && asset.category !== state.categoryFilter) return false;
    if (state.smartGroupFilter && classification.group !== state.smartGroupFilter) return false;
    if (state.typeFilter) {
      const kind = state.codexEmbedded
        ? (["archive", "frame", "contact"].includes(state.typeFilter) ? (state.typeFilter === "archive" ? resourceKind(asset) : asset.kind) : resourceFilterKind(asset))
        : asset.kind;
      if (kind !== state.typeFilter) return false;
    }
    if (state.statusFilter) {
      if (state.statusFilter === "待用户判断") {
        if (asset.userStatus) return false;
      } else if (status !== state.statusFilter) {
        return false;
      }
    }
    if (!q) return true;
    const haystack = [
      asset.name,
      asset.version,
      asset.relPath,
      asset.notes,
      asset.initialStatus,
      asset.userStatus,
      asset.kind,
      asset.smartGroup,
      Array.isArray(asset.tags) ? asset.tags.join(" ") : asset.tags,
      classification.label,
      classification.source,
      classification.reason
    ].join(" ").toLowerCase();
    return haystack.includes(q);
  });

  if (state.compactReverse && state.categoryFilter === "reverse" && !state.typeFilter) {
    assets = compactReverseAssets(assets);
  }

  assets = [...assets].sort((a, b) => {
    if (state.sort === "oldest") return a.mtimeMs - b.mtimeMs;
    if (state.sort === "name") return a.name.localeCompare(b.name);
    if (state.sort === "size") return b.size - a.size;
    return b.mtimeMs - a.mtimeMs;
  });
  return assets;
}

function compactReverseAssets(assets) {
  const standalone = [];
  const groups = new Map();

  for (const asset of assets) {
    if (!["frame", "contact", "image"].includes(asset.kind)) {
      standalone.push(asset);
      continue;
    }
    const key = `${asset.caseId}/${asset.dir}`;
    const group = groups.get(key) || {
      key,
      assets: [],
      latest: asset
    };
    group.assets.push(asset);
    if (asset.mtimeMs > group.latest.mtimeMs) group.latest = asset;
    groups.set(key, group);
  }

  const reverseGroups = [...groups.values()].map((group) => {
    if (group.assets.length === 1) return group.assets[0];
    const sorted = [...group.assets].sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { numeric: true });
      if (byName) return byName;
      return a.mtimeMs - b.mtimeMs;
    });
    const contact = sorted.find((asset) => asset.kind === "contact");
    const frame = sorted.find((asset) => asset.kind === "frame");
    const representative = contact || frame || sorted[Math.floor((sorted.length - 1) / 2)] || group.latest;
    return {
      ...representative,
      id: `group:${group.key}`,
      isGroup: true,
      kind: "frame-group",
      category: "reverse",
      categoryLabel: "视频反推/抽帧",
      groupDir: representative.dir,
      groupCount: group.assets.length,
      groupFirst: sorted[0],
      groupLast: sorted[sorted.length - 1],
      name: `${representative.dir.split("/").pop()}（${group.assets.length} 项）`,
      size: group.assets.reduce((sum, item) => sum + item.size, 0),
      mtimeMs: group.latest.mtimeMs,
      notes: representative.notes || "",
      initialStatus: "抽帧文件夹",
      userStatus: ""
    };
  });

  return [...standalone, ...reverseGroups];
}

function assetSelectionKey(asset) {
  return `${asset.projectId || state.selectedProject}::${asset.relPath || asset.id}`;
}

function selectedAssets() {
  return state.assets.filter((asset) => state.selectedAssetKeys.has(assetSelectionKey(asset)));
}

function renderComparePanel() {
  if (!els.comparePanel || !els.compareGrid) return;
  const assets = selectedAssets().slice(0, 4);
  if (!state.compareMode || assets.length < 2) {
    state.compareMode = false;
    els.comparePanel.hidden = true;
    els.assetGrid.hidden = false;
    els.compareGrid.replaceChildren();
    return;
  }

  els.comparePanel.hidden = false;
  els.assetGrid.hidden = true;
  els.compareTitle.textContent = `${assets.length} 项资产`;
  els.compareGrid.replaceChildren();
  for (const asset of assets) {
    const item = document.createElement("article");
    item.className = "compare-item";
    const preview = document.createElement("div");
    preview.className = "compare-preview";
    preview.innerHTML = mediaPreview(asset, asset.kind === "video" || asset.kind === "audio");
    const body = document.createElement("div");
    body.className = "compare-item-body";
    const title = document.createElement("strong");
    title.textContent = asset.name;
    title.title = asset.name;
    const meta = document.createElement("span");
    meta.textContent = `${displayStatus(asset)} · ${formatSize(asset.size)}`;
    const actions = document.createElement("div");
    actions.className = "compare-item-actions";
    if (state.codexEmbedded) {
      const use = document.createElement("button");
      use.type = "button";
      use.className = "codex-primary-action";
      use.textContent = "附加到对话";
      use.addEventListener("click", () => sendAssetToCodex(asset));
      actions.append(use);

      const route = document.createElement("button");
      route.type = "button";
      route.textContent = state.codexBoundProject && state.selectedProject === state.codexBoundProject
        ? "移回待处理"
        : state.codexBoundProject
          ? `移动到「${codexProjectName(state.codexBoundProject)}」`
          : "移动到项目…";
      route.addEventListener("click", () => routeAssetForCurrentTask(asset).catch(showError));
      actions.append(route);
    }
    for (const status of ["可用", "参考可用"]) {
      const judge = document.createElement("button");
      judge.type = "button";
      judge.textContent = status;
      judge.classList.toggle("active", asset.userStatus === status);
      judge.addEventListener("click", async () => {
        await saveStatus(asset, status);
        renderComparePanel();
      });
      actions.append(judge);
    }

    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "discard-action";
    discard.textContent = "丢弃（不删除）";
    discard.title = "只标记为丢弃，不删除文件";
    discard.addEventListener("click", async () => {
      await saveStatus(asset, "丢弃");
      showToast(`已将「${asset.name}」标记为丢弃`, { actionLabel: "撤销", onAction: () => saveStatus(asset, "") });
      renderComparePanel();
    });
    actions.append(discard);

    const curate = document.createElement("button");
    curate.type = "button";
    curate.textContent = "移动到精选库…";
    curate.addEventListener("click", () => openMoveAssetDialog(asset, { targetProjectId: "ai-reference-library" }).catch(showError));
    actions.append(curate);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "移出对比";
    remove.addEventListener("click", () => toggleAssetSelection(asset));
    actions.append(remove);
    body.append(title, meta, actions);
    item.append(preview, body);
    els.compareGrid.append(item);
  }
}

function openComparePanel() {
  const count = state.selectedAssetKeys.size;
  if (count < 2 || count > 4) {
    showToast("请选择 2–4 项资产进行对比", { tone: "error" });
    return;
  }
  state.compareMode = true;
  renderComparePanel();
  els.comparePanel.scrollIntoView({ block: "start", behavior: reducedMotionPreferred() ? "auto" : "smooth" });
}

function updateBatchBar() {
  const count = state.selectedAssetKeys.size;
  syncProjectOrganizeButton();
  document.body.classList.toggle("selection-mode", state.multiSelect);
  els.selectionModeButton.setAttribute("aria-pressed", String(state.multiSelect));
  els.selectionModeButton.textContent = state.codexEmbedded ? (state.multiSelect ? "完成" : "选择") : (state.multiSelect ? "退出选择" : "批量选择");
  els.batchBar.hidden = !state.multiSelect;
  els.batchCount.textContent = String(count);
  els.batchMoveAssets.disabled = !count || state.batchBusy;
  els.batchDeleteAssets.disabled = !count || state.batchBusy;
  els.batchStatusSelect.disabled = !count || state.batchBusy;
  if (els.batchDiscardAssets) els.batchDiscardAssets.disabled = !count || state.batchBusy;
  els.selectVisibleAssets.disabled = state.batchBusy;
  if (els.batchUseInCodex) els.batchUseInCodex.disabled = !count || count > 8 || state.batchBusy;
  if (els.batchCompareAssets) els.batchCompareAssets.disabled = count < 2 || count > 4 || state.batchBusy;
  if (els.batchCurateAssets) els.batchCurateAssets.disabled = !count || state.batchBusy;
  if (els.batchTaskAction) {
    const viewingBoundProject = Boolean(state.codexBoundProject && state.selectedProject === state.codexBoundProject);
    const canRouteProject = state.selectedProject !== "ai-reference-library";
    els.batchTaskAction.hidden = !state.codexEmbedded || !canRouteProject;
    const boundName = codexProjectName(state.codexBoundProject);
    els.batchTaskAction.textContent = viewingBoundProject
      ? "移回待处理"
      : boundName
        ? `移动到「${boundName}」`
        : "移动到项目…";
    els.batchTaskAction.title = viewingBoundProject
      ? "把文件移回待处理；操作后可撤销"
      : state.codexBoundProject
        ? `移动文件到「${boundName}」；操作后可撤销`
        : "选择目标项目和文件夹；操作后可撤销";
    els.batchTaskAction.disabled = !count || state.batchBusy;
    els.batchTaskAction.classList.toggle("codex-primary-action", !viewingBoundProject && Boolean(state.codexBoundProject));
  }
  renderComparePanel();
}

function enterSelectionMode() {
  state.multiSelect = true;
  updateBatchBar();
  if (els.assetGrid.classList.contains("shared-collections")) render();
}

function exitSelectionMode() {
  const wasSelecting = state.multiSelect;
  state.multiSelect = false;
  state.compareMode = false;
  state.selectedAssetKeys.clear();
  state.selectionAnchorKey = "";
  updateBatchBar();
  updateAssetSelection();
  if (wasSelecting && state.codexEmbedded && state.codexScope === "shared") render();
}

function toggleAssetSelection(asset, options = {}) {
  if (!asset || asset.isGroup) return;
  enterSelectionMode();
  const key = assetSelectionKey(asset);
  const visible = filteredAssets().filter((item) => !item.isGroup);
  if (options.range && state.selectionAnchorKey) {
    const start = visible.findIndex((item) => assetSelectionKey(item) === state.selectionAnchorKey);
    const end = visible.findIndex((item) => assetSelectionKey(item) === key);
    if (start >= 0 && end >= 0) {
      for (const item of visible.slice(Math.min(start, end), Math.max(start, end) + 1)) {
        state.selectedAssetKeys.add(assetSelectionKey(item));
      }
    }
  } else if (state.selectedAssetKeys.has(key)) {
    state.selectedAssetKeys.delete(key);
  } else {
    state.selectedAssetKeys.add(key);
  }
  state.selectionAnchorKey = key;
  updateAssetSelection();
  updateBatchBar();
}

function selectAssetGroup(assets) {
  const selectable = assets.filter((asset) => !asset.isGroup);
  if (!selectable.length) return;
  enterSelectionMode();
  const allSelected = selectable.every((asset) => state.selectedAssetKeys.has(assetSelectionKey(asset)));
  for (const asset of selectable) {
    const key = assetSelectionKey(asset);
    if (allSelected) state.selectedAssetKeys.delete(key);
    else state.selectedAssetKeys.add(key);
  }
  updateAssetSelection();
  updateBatchBar();
}

function smartBatchLabel(assets) {
  const imageCount = assets.filter((asset) => ["image", "frame", "contact"].includes(asset.kind)).length;
  if (assets.length === 9 && imageCount === 9) return "九图批次";
  if (imageCount === assets.length) return "同批图片";
  if (assets.every((asset) => asset.kind === "video")) return "同批视频";
  return "同批素材";
}

function buildSmartBatches(assets) {
  const batches = [];
  const gapLimit = 5 * 60 * 1000;
  for (const asset of assets) {
    const last = batches.at(-1);
    const previous = last?.assets.at(-1);
    const sameFamily = previous && previous.kind === asset.kind && previous.dir === asset.dir;
    const nearInTime = previous && Math.abs(previous.mtimeMs - asset.mtimeMs) <= gapLimit;
    if (last && sameFamily && nearInTime && last.assets.length < 12) last.assets.push(asset);
    else batches.push({ assets: [asset] });
  }
  return batches;
}

function shouldUseSmartBatches(assets) {
  if (state.codexEmbedded) return false;
  return ["pending-review", "dated-workspace"].includes(state.selectedProject)
    && state.sort === "newest"
    && assets.length >= 4
    && !assets.some((asset) => asset.isGroup);
}

function appendSmartBatchHeading(batch, target = els.assetGrid) {
  const heading = document.createElement("div");
  heading.className = "smart-batch-heading";
  const newest = new Date(batch.assets[0].mtimeMs);
  const title = document.createElement("div");
  title.innerHTML = `<strong>${smartBatchLabel(batch.assets)}</strong><span>${batch.assets.length} 项 · ${newest.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>`;
  const select = document.createElement("button");
  select.type = "button";
  select.textContent = "选中本组";
  select.addEventListener("click", () => selectAssetGroup(batch.assets));
  heading.append(title, select);
  target.append(heading);
}

function resourceKind(asset) {
  if (asset.type) return asset.type;
  if (["image", "frame", "contact"].includes(asset.kind)) return "image";
  if (["audio", "video"].includes(asset.kind)) return asset.kind;
  const extension = (asset.name || asset.relPath || "").split(".").pop().toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"].includes(extension)) return "image";
  if (["mp4", "webm", "mov", "m4v", "mkv"].includes(extension)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(extension)) return "audio";
  if (["html", "htm"].includes(extension)) return "html";
  if (extension === "pdf") return "pdf";
  if (["md", "markdown"].includes(extension)) return "markdown";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "csv"].includes(extension)) return "office";
  if (["js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "json", "css", "xml", "yaml", "yml", "sh", "ps1", "sql", "java", "c", "cpp", "h", "go", "rs"].includes(extension)) return "code";
  if (["zip", "7z", "rar", "tar", "gz"].includes(extension)) return "archive";
  return "document";
}

function resourceFilterKind(asset) {
  const kind = resourceKind(asset);
  if (["pdf", "markdown", "office", "document"].includes(kind)) return "document";
  if (kind === "html") return "web";
  if (["archive", "other"].includes(kind)) return "other";
  return kind;
}

function resourceKindLabel(asset) {
  const kind = resourceKind(asset);
  if (kind === "office") {
    if (/\.(xlsx?|csv|ods)$/i.test(asset.name || "")) return "表格";
    if (/\.(pptx?|odp)$/i.test(asset.name || "")) return "演示文稿";
  }
  return { image: "图片", video: "视频", audio: "音频", html: "网页 / 原型", pdf: "PDF", markdown: "Markdown", office: "文档", document: "文档", code: "代码", archive: "压缩包" }[kind] || "文件";
}

const resourceTextPreviewCache = new Map();

function readResourceTextPreview(asset) {
  const key = JSON.stringify([asset.absolutePath || asset.previewUrl, String(asset.mtimeMs || 0)]);
  if (!resourceTextPreviewCache.has(key)) {
    const request = api(asset.previewUrl);
    resourceTextPreviewCache.set(key, request);
    if (resourceTextPreviewCache.size > 80) resourceTextPreviewCache.delete(resourceTextPreviewCache.keys().next().value);
    request.catch(() => { if (resourceTextPreviewCache.get(key) === request) resourceTextPreviewCache.delete(key); });
  }
  return resourceTextPreviewCache.get(key);
}

async function hydrateResourceCardSnippet(target) {
  const asset = { previewUrl: target.dataset.resourcePreviewUrl, absolutePath: target.dataset.resourcePath, mtimeMs: target.dataset.resourceMtime };
  delete target.dataset.resourcePreviewUrl;
  deferredMediaObserver?.unobserve(target);
  try {
    const data = await readResourceTextPreview(asset);
    if (target.isConnected) target.textContent = String(data.text || "文件没有可显示的文本").trim().split(/\r?\n/).slice(0, 4).join("\n").slice(0, 200);
  } catch {
    if (target.isConnected) target.textContent = "打开详情或原文件查看内容";
  }
}

async function loadResourceTextPreview(asset) {
  const target = els.detailPreview.querySelector("[data-resource-text-preview]");
  if (!target || !asset.previewUrl) return;
  try {
    const data = await readResourceTextPreview(asset);
    if (state.selectedAsset?.id !== asset.id || !target.isConnected) return;
    target.textContent = `${data.text || "文件没有可显示的文本"}${data.truncated ? "\n\n…预览已截短，可下载原文件查看完整内容。" : ""}`;
  } catch (error) {
    if (state.selectedAsset?.id === asset.id && target.isConnected) target.textContent = `预览不可用：${error.message}。可下载原文件。`;
  }
}

function renderCodexResourceDetail(asset) {
  const source = asset.sourceTask || asset.sourceContext?.taskTitle || asset.sourceContext?.sourceTask || "";
  const promptPath = asset.promptPath || "";
  els.quickMoveAsset.hidden = true;
  els.detailBody.innerHTML = `
    <div class="resource-detail-meta"><span>${escapeHtml(resourceKindLabel(asset))}</span><span>${formatSize(asset.size)}</span><time>${new Date(asset.mtimeMs).toLocaleString()}</time></div>
    <div class="detail-row"><label>原文件</label><div class="mono">${escapeHtml(absolutePath(asset))}</div></div>
    ${source ? `<div class="detail-row"><label>来源任务</label><div>${escapeHtml(source)}</div></div>` : ""}
    ${asset.ticketId ? `<div class="detail-row"><label>生成记录</label><div class="mono">${escapeHtml(asset.ticketId)}</div></div>` : ""}
    ${promptPath ? `<div class="detail-row"><label>提示词来源</label><div class="mono">${escapeHtml(promptPath)}</div>${asset.promptUrl ? `<a href="${escapeHtml(asset.promptUrl)}" download>下载提示词</a>` : ""}</div>` : ""}
    ${asset.prompt ? `<details class="resource-prompt"><summary>生成提示词</summary><pre>${escapeHtml(asset.prompt)}</pre></details>` : ""}
    ${asset.notes ? `<div class="detail-row"><label>备注</label><div>${escapeHtml(asset.notes)}</div></div>` : ""}
    <div class="detail-actions">
      <button id="useInCodex" class="codex-primary-action">附加到当前任务</button>
      <a href="${escapeHtml(asset.downloadUrl)}" download>下载原文件</a>
      <button id="copyPath">复制路径</button><button id="revealAsset">打开位置</button>
    </div>`;
  els.detailBody.querySelector("#useInCodex").addEventListener("click", () => sendAssetToCodex(asset));
  els.detailBody.querySelector("#copyPath").addEventListener("click", () => copyPath(asset));
  els.detailBody.querySelector("#revealAsset").addEventListener("click", () => reveal(asset));
  void loadResourceTextPreview(asset);
}

function mediaPreview(asset, controls = false) {
  if (state.codexEmbedded && !["image", "video", "audio"].includes(resourceKind(asset))) {
    const kind = resourceKind(asset);
    if (controls && kind === "html") return `<iframe class="resource-document-preview" title="${escapeHtml(asset.name)}" sandbox="allow-scripts" src="${escapeHtml(asset.htmlUrl || asset.mediaUrl)}"></iframe>`;
    if (controls && ["markdown", "code", "office", "document", "archive"].includes(kind) && asset.previewUrl) return '<pre class="resource-text-preview" data-resource-text-preview>正在读取内容…</pre>';
    if (!controls && ["markdown", "code", "office", "document", "archive"].includes(kind) && asset.previewUrl) return `<div class="resource-file-preview resource-snippet-preview"><span class="resource-snippet-kind">${escapeHtml(resourceKindLabel(asset))}</span><pre class="resource-card-snippet" data-resource-preview-url="${escapeHtml(asset.previewUrl)}" data-resource-path="${escapeHtml(asset.absolutePath || "")}" data-resource-mtime="${escapeHtml(asset.mtimeMs || 0)}">正在读取内容…</pre></div>`;
    return `<div class="resource-file-preview"><span class="resource-file-kind">${escapeHtml(resourceKindLabel(asset))}</span><span class="resource-file-extension">${escapeHtml((asset.name || "").split(".").pop()?.toUpperCase() || "FILE")}</span>${controls ? `<span>${kind === "pdf" ? "PDF 暂不支持内嵌预览，在文件夹中打开原文件" : "可下载原文件，或在文件夹中打开"}</span>` : ""}</div>`;
  }
  const sourceAttribute = controls ? `src="${escapeHtml(asset.mediaUrl)}"` : `data-media-src="${escapeHtml(asset.mediaUrl)}"`;
  if ((state.codexEmbedded ? resourceKind(asset) : asset.kind) === "video") {
    return controls
      ? `<video controls preload="metadata" muted playsinline ${sourceAttribute}></video>`
      : `<video preload="none" muted playsinline ${sourceAttribute}></video><button type="button" class="media-play-button" data-action="toggle-media" aria-label="播放 ${escapeHtml(asset.name)}"><span aria-hidden="true">▶</span><span data-media-action-label>播放</span></button>`;
  }
  if ((state.codexEmbedded ? resourceKind(asset) : asset.kind) === "audio") {
    const duration = formatMediaDuration(asset.durationSeconds ?? asset.duration);
    return `
      <div class="audio-preview">
        <div class="audio-mark">AUDIO</div>
        <audio ${controls ? "controls" : ""} preload="${controls ? "metadata" : "none"}" ${sourceAttribute}></audio>
        ${controls ? "" : `<button type="button" class="media-play-button audio-play-button" data-action="toggle-media" aria-label="试听 ${escapeHtml(asset.name)}"><span aria-hidden="true">▶</span><span data-media-action-label>试听</span><span class="media-duration" data-media-duration>${duration}</span></button>`}
      </div>
    `;
  }
  const loading = controls ? "" : ' loading="lazy" decoding="async"';
  return `<img ${sourceAttribute} alt=""${loading}>`;
}

function formatMediaDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "--:--";
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function updateCardMediaButton(card, media) {
  const button = card.querySelector(".media-play-button");
  if (!button) return;
  const playing = !media.paused && !media.ended;
  button.classList.toggle("is-playing", playing);
  button.querySelector("[aria-hidden]").textContent = playing ? "Ⅱ" : "▶";
  button.querySelector("[data-media-action-label]").textContent = playing ? "暂停" : (media instanceof HTMLAudioElement ? "试听" : "播放");
  button.setAttribute("aria-label", `${playing ? "暂停" : media instanceof HTMLAudioElement ? "试听" : "播放"} ${card.querySelector(".card-title")?.textContent || "媒体"}`);
  const duration = button.querySelector("[data-media-duration]");
  if (duration) duration.textContent = formatMediaDuration(media.duration);
}

async function toggleCardMedia(card) {
  const media = card.querySelector("video, audio");
  if (!media) return;
  if (!media.paused && !media.ended) {
    media.pause();
    return;
  }
  document.querySelectorAll(".asset-card video, .asset-card audio").forEach((other) => {
    if (other !== media && !other.paused) other.pause();
  });
  hydrateDeferredMedia(media);
  await media.play();
}

let deferredMediaObserver = null;
let deferredMediaRoot = null;
let deferredMediaScrollRoot = null;
let deferredMediaHydrationTimer = 0;

function hydrateDeferredMedia(media) {
  if (media?.dataset?.resourcePreviewUrl) return hydrateResourceCardSnippet(media);
  const source = media?.dataset?.mediaSrc;
  if (!source) return;
  media.src = source;
  delete media.dataset.mediaSrc;
  if (media instanceof HTMLMediaElement) {
    media.load();
  }
  deferredMediaObserver?.unobserve(media);
}

function hydrateMediaNearViewport(root = deferredMediaRoot) {
  if (!root) return;
  const scrollRoot = state.codexEmbedded ? els.assetGrid : document.querySelector(".main");
  const viewport = scrollRoot?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight };
  const margin = 480;
  for (const media of root.querySelectorAll("[data-media-src], [data-resource-preview-url]")) {
    const rect = media.getBoundingClientRect();
    if (rect.top > viewport.bottom + margin) break;
    if (rect.bottom >= viewport.top - margin) hydrateDeferredMedia(media);
  }
}

function scheduleDeferredMediaHydration() {
  if (deferredMediaHydrationTimer) return;
  deferredMediaHydrationTimer = window.setTimeout(() => {
    deferredMediaHydrationTimer = 0;
    hydrateMediaNearViewport();
  }, 40);
}

function bindDeferredMediaScrollRoot(scrollRoot) {
  if (deferredMediaScrollRoot === scrollRoot) return;
  deferredMediaScrollRoot?.removeEventListener("scroll", scheduleDeferredMediaHydration);
  deferredMediaScrollRoot = scrollRoot;
  deferredMediaScrollRoot?.addEventListener("scroll", scheduleDeferredMediaHydration, { passive: true });
}

function observeDeferredMedia(root = els.assetGrid) {
  deferredMediaRoot = root;
  deferredMediaObserver?.disconnect();
  hydrateMediaNearViewport(root);
  const mediaItems = [...root.querySelectorAll("[data-media-src], [data-resource-preview-url]")];
  const scrollRoot = state.codexEmbedded ? els.assetGrid : document.querySelector(".main");
  bindDeferredMediaScrollRoot(scrollRoot);
  if (!mediaItems.length) return;
  if (!("IntersectionObserver" in window)) {
    mediaItems.filter((media) => !media.dataset.resourcePreviewUrl).forEach(hydrateDeferredMedia);
    return;
  }
  deferredMediaObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) hydrateDeferredMedia(entry.target);
    }
  }, { root: scrollRoot, rootMargin: "480px 0px", threshold: 0.01 });
  mediaItems.forEach((media) => deferredMediaObserver.observe(media));
}

function configureDetailPreviewFit() {
  const preview = els.detailPreview;
  const media = preview.querySelector("img, video");
  preview.classList.remove("is-portrait", "is-square", "is-landscape");
  if (!media) return;

  const applyDimensions = (width, height) => {
    if (!width || !height) return;
    const ratio = width / height;
    preview.classList.toggle("is-portrait", ratio < 0.9);
    preview.classList.toggle("is-square", ratio >= 0.9 && ratio <= 1.1);
    preview.classList.toggle("is-landscape", ratio > 1.1);
  };

  if (media instanceof HTMLVideoElement) {
    if (media.videoWidth && media.videoHeight) applyDimensions(media.videoWidth, media.videoHeight);
    else media.addEventListener("loadedmetadata", () => applyDimensions(media.videoWidth, media.videoHeight), { once: true });
    return;
  }

  if (media.complete && media.naturalWidth && media.naturalHeight) {
    applyDimensions(media.naturalWidth, media.naturalHeight);
  } else {
    media.addEventListener("load", () => applyDimensions(media.naturalWidth, media.naturalHeight), { once: true });
  }
}

function renderAssetCard(asset) {
  const card = document.createElement("article");
  card.className = `asset-card ${asset.isGroup ? "group-card" : ""} ${state.selectedAsset?.id === asset.id ? "selected" : ""}`;
  card.dataset.assetId = asset.id;
  if (state.codexEmbedded) card.dataset.resourceKind = resourceKind(asset);
  card.dataset.assetKey = assetSelectionKey(asset);
  card.classList.toggle("batch-selected", state.selectedAssetKeys.has(assetSelectionKey(asset)));
  const status = displayStatus(asset);
  const classification = classificationOf(asset);
  const actionLabel = asset.isGroup ? "展开" : "查看";
  const moveAction = asset.isGroup || state.codexEmbedded ? "" : `<button data-action="move">移动</button>`;
  const codexAction = state.codexEmbedded && !asset.isGroup
    ? '<button data-action="use-in-codex" class="card-use-in-codex" aria-label="附加到对话" title="添加到输入框上方，不自动发送">引用</button>'
    : "";
  const downloadAction = asset.isGroup
    ? `<button data-action="folder">文件夹</button>`
    : `<a href="${escapeHtml(asset.downloadUrl)}" download>下载</a>`;
  card.innerHTML = `
    <div class="preview">
      ${mediaPreview(asset)}
      ${asset.isGroup ? "" : `<button type="button" class="card-select-toggle" data-action="toggle-select" aria-label="选择 ${escapeHtml(asset.name)}" aria-pressed="${state.selectedAssetKeys.has(assetSelectionKey(asset))}"><span aria-hidden="true">✓</span></button>`}
      <div class="badge-row">
        <span class="badge">${escapeHtml(asset.isGroup ? `${asset.groupCount} 项` : asset.version || asset.kind)}</span>
        <span class="badge">${escapeHtml(asset.categoryLabel || asset.kind)}</span>
        <span class="badge smart-group-badge group-${escapeHtml(classification.group)}">${escapeHtml(classification.label)}</span>
      </div>
      <div class="card-actions">
        ${codexAction}
        <button data-action="select">${actionLabel}</button>
        ${moveAction}
        <button data-action="reveal">文件夹</button>
        ${downloadAction}
      </div>
    </div>
    <div class="card-body">
      <p class="card-title">${escapeHtml(asset.name)}</p>
      <div class="card-meta">
        <span class="status ${escapeHtml(statusClass(status))}">${escapeHtml(status)}</span>
        <span>${formatSize(asset.size)}</span>
        ${state.codexEmbedded ? `<span>${escapeHtml(resourceKindLabel(asset))}</span><time>${new Date(asset.mtimeMs).toLocaleDateString()}</time>` : ""}
      </div>
      <div class="classification-summary" title="${escapeHtml(classification.reason)}">
        <span>${escapeHtml(classification.source)}</span><span>${escapeHtml(classification.confidence)}置信</span>
      </div>
      <p class="classification-reason">${escapeHtml(classification.reason)}</p>
    </div>
  `;
  card.tabIndex = 0;
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", `${asset.name}，${classification.label}，质量状态 ${status}。按回车查看`);
  card.querySelector(".card-title")?.setAttribute("title", asset.name);
  card.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "toggle-media") {
      event.stopPropagation();
      return toggleCardMedia(card).catch((error) => showToast(`无法播放：${error.message}`, { tone: "error" }));
    }
    if (action === "toggle-select") return toggleAssetSelection(asset, { range: event.shiftKey });
    if (action === "reveal") return openFolder(asset);
    if (action === "folder") return openFolder(asset);
    if (action === "move") {
      selectAsset(asset);
      return openMoveAssetDialog(asset);
    }
    if (action === "use-in-codex") {
      event.stopPropagation();
      return sendAssetToCodex(asset);
    }
    if ((state.multiSelect || event.ctrlKey || event.metaKey) && !asset.isGroup) {
      event.preventDefault();
      return toggleAssetSelection(asset, { range: event.shiftKey });
    }
    selectAsset(asset);
  });
  card.addEventListener("keydown", (event) => {
    if (event.target !== card || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    if (state.multiSelect && !asset.isGroup) toggleAssetSelection(asset, { range: event.shiftKey });
    else selectAsset(asset);
  });
  const media = card.querySelector("video, audio");
  if (media) {
    for (const eventName of ["play", "pause", "ended", "loadedmetadata"]) {
      media.addEventListener(eventName, () => updateCardMediaButton(card, media));
    }
  }
  return card;
}

function render() {
  renderCodexResourceControls();
  syncEmbeddedFilterControls();
  syncNewFolderButton();
  syncProjectOrganizeButton();
  const currentCase = state.cases.find((item) => item.id === state.selectedCase);
  const currentProject = state.projects.find((item) => item.id === state.selectedProject);
  renderCaseBreadcrumb(currentProject, currentCase);
  const folderOverview = folderOverviewContext();
  if (folderOverview) {
    renderFolderOverview(folderOverview);
    return;
  }
  els.assetGrid.classList.remove("folder-overview-grid");
  const assets = filteredAssets();
  const collections = sharedAssetCollections(assets);
  els.assetGrid.classList.toggle("shared-collections", Boolean(collections));
  const visibleCount = document.querySelector("#codexVisibleCount");
  if (state.codexEmbedded && visibleCount) {
    visibleCount.textContent = collections ? `${collections.folders.length} 合集` : `${assets.length} 项`;
    visibleCount.title = `${assets.length} 项资产`;
  }
  renderCategoryCounts();
  renderSmartGroupCounts();
  const categoryName = categoryLabels[state.categoryFilter] || "全部资产";
  const rawCategoryCount = state.categoryFilter
    ? state.assets.map(enrichAsset).filter((asset) => asset.category === state.categoryFilter).length
    : state.assets.length;
  if (state.compactReverse && state.categoryFilter === "reverse" && assets.length < rawCategoryCount) {
    els.assetCount.textContent = `${categoryName}：${assets.length} 组 / 原始 ${rawCategoryCount} 个（全案 ${state.assets.length}）`;
  } else {
    els.assetCount.textContent = `${categoryName}：${assets.length} / ${state.assets.length} 个资产`;
  }
  deferredMediaObserver?.disconnect();
  els.assetGrid.innerHTML = "";
  if (!assets.length) {
    const hasDiscoveryFilters = Boolean(state.query.trim() || state.categoryFilter || state.smartGroupFilter || state.statusFilter || state.typeFilter);
    els.assetGrid.innerHTML = `
      <div class="empty-state">
        <h3>${hasDiscoveryFilters ? "没有匹配的素材" : `${categoryName}暂无资产`}</h3>
        <p>${hasDiscoveryFilters ? "当前搜索或筛选条件没有结果。" : "可以切换其他资产位置，或在生成/整理完成后手动刷新。"}</p>
        ${hasDiscoveryFilters ? '<button type="button" data-action="clear-empty-filters">清除搜索与筛选</button>' : ""}
      </div>
    `;
    els.assetGrid.querySelector('[data-action="clear-empty-filters"]')?.addEventListener("click", clearAssetDiscoveryFilters);
  } else if (collections) {
    renderSharedCollections(collections);
  } else if (shouldUseSmartBatches(assets)) {
    const fragment = document.createDocumentFragment();
    let index = 0;
    for (const batch of buildSmartBatches(assets)) {
      if (batch.assets.length > 1) appendSmartBatchHeading(batch, fragment);
      for (const asset of batch.assets) {
        const card = renderAssetCard(asset);
        card.style.setProperty("--enter-index", Math.min(index++, 7));
        fragment.append(card);
      }
    }
    els.assetGrid.append(fragment);
  } else {
    const fragment = document.createDocumentFragment();
    for (const [index, asset] of assets.entries()) {
      const card = renderAssetCard(asset);
      card.style.setProperty("--enter-index", Math.min(index, 7));
      fragment.append(card);
    }
    els.assetGrid.append(fragment);
  }
  observeDeferredMedia();
  updateBatchBar();
  renderDetail();
}

function updateAssetSelection() {
  for (const card of els.assetGrid.querySelectorAll(".asset-card")) {
    card.classList.toggle("selected", card.dataset.assetId === state.selectedAsset?.id);
    const batchSelected = state.selectedAssetKeys.has(card.dataset.assetKey);
    card.classList.toggle("batch-selected", batchSelected);
    card.querySelector(".card-select-toggle")?.setAttribute("aria-pressed", String(batchSelected));
  }
}

function reducedMotionPreferred() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function cancelElementAnimations(element) {
  for (const animation of element?.getAnimations?.() || []) {
    animation.cancel();
  }
}

function renderCaseBreadcrumb(currentProject, currentCase) {
  if (state.codexEmbedded) {
    els.caseTitle.textContent = currentCase?.id === "__all__" ? "全部历史" : currentCase?.name || "项目资产";
    return;
  }
  els.caseTitle.innerHTML = "";
  if (!currentProject || !currentCase) {
    els.caseTitle.textContent = "资产看板";
    els.caseTitle.title = "资产看板";
    return;
  }
  const parts = pathParts(currentCase.relPath || currentCase.id);
  const levels = [{ label: currentProject.name || "项目", caseId: "." }];
  for (let depth = 1; depth <= parts.length; depth += 1) {
    levels.push({ label: parts[depth - 1], caseId: parts.slice(0, depth).join("\\") });
  }
  levels.forEach((level, index) => {
    if (index) {
      const separator = document.createElement("span");
      separator.className = "case-crumb-separator";
      separator.textContent = "›";
      separator.setAttribute("aria-hidden", "true");
      els.caseTitle.append(separator);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `case-crumb${level.caseId === state.selectedCase ? " current" : ""}`;
    button.textContent = level.label;
    button.title = level.caseId === state.selectedCase ? `当前文件夹：${level.label}` : `打开：${level.label}`;
    if (level.caseId === state.selectedCase) {
      button.disabled = true;
      button.setAttribute("aria-current", "page");
    } else {
      button.addEventListener("click", () => activateCase(level.caseId));
    }
    els.caseTitle.append(button);
  });
  els.caseTitle.title = [currentProject.name || "项目", ...parts].join(" › ");
}

async function beginWorkspaceSwitch(generation) {
  const surface = state.compareMode && !els.comparePanel?.hidden ? els.comparePanel : els.assetGrid;
  if (!surface) return null;
  cancelElementAnimations(surface);
  const token = String(generation);
  surface.dataset.workspaceSwitchToken = token;
  surface.setAttribute("aria-busy", "true");
  const motion = !reducedMotionPreferred() && typeof surface.animate === "function";
  if (!motion) return { surface, token, motion: false };
  const animation = surface.animate([
    { opacity: 1, transform: "translate3d(0, 0, 0)" },
    { opacity: .28, transform: "translate3d(0, -4px, 0)" }
  ], {
    duration: 90,
    easing: "cubic-bezier(.4, 0, 1, 1)",
    fill: "forwards"
  });
  void animation.finished.catch(() => {});
  return { surface, token, motion: true };
}

function releaseWorkspaceSwitch(transition) {
  const { surface, token } = transition || {};
  if (!surface || surface.dataset.workspaceSwitchToken !== token) return;
  cancelElementAnimations(surface);
  surface.removeAttribute("aria-busy");
  delete surface.dataset.workspaceSwitchToken;
}

function finishWorkspaceSwitch(transition) {
  const { surface, token, motion } = transition || {};
  if (!surface || surface.dataset.workspaceSwitchToken !== token) return;
  releaseWorkspaceSwitch(transition);
  if (!motion || typeof surface.animate !== "function") return;
  surface.animate([
    { opacity: .3, transform: "translate3d(0, 6px, 0)" },
    { opacity: 1, transform: "translate3d(0, 0, 0)" }
  ], {
    duration: 190,
    easing: "cubic-bezier(.22, 1, .36, 1)"
  });
}

function animateDockLayout(opening, mutate) {
  mutate();
  if (reducedMotionPreferred() || !els.assetGrid?.animate) return;

  const direction = opening ? -1 : 1;
  const topbar = document.querySelector(".topbar");
  cancelElementAnimations(els.assetGrid);
  cancelElementAnimations(topbar);

  els.assetGrid.animate([
    { opacity: .78, transform: `translate3d(${direction * 10}px, 0, 0)` },
    { opacity: 1, transform: "translate3d(0, 0, 0)" }
  ], {
    duration: opening ? 290 : 230,
    easing: "cubic-bezier(.16, 1, .3, 1)"
  });

  topbar?.animate([
    { opacity: .86, transform: `translate3d(${direction * 5}px, 0, 0)` },
    { opacity: 1, transform: "translate3d(0, 0, 0)" }
  ], {
    duration: opening ? 250 : 200,
    easing: "cubic-bezier(.16, 1, .3, 1)"
  });
}

function animateDetailSwap() {
  if (reducedMotionPreferred() || !els.detailPreview?.animate) return;
  cancelElementAnimations(els.detailPreview);
  cancelElementAnimations(els.detailBody);
  const timing = { duration: 220, easing: "cubic-bezier(.22, 1, .36, 1)" };
  els.detailPreview.animate([
    { opacity: .68, transform: "translate3d(0, 4px, 0)" },
    { opacity: 1, transform: "translate3d(0, 0, 0)" }
  ], timing);
  els.detailBody.animate([
    { opacity: .62, transform: "translate3d(0, 6px, 0)" },
    { opacity: 1, transform: "translate3d(0, 0, 0)" }
  ], { ...timing, duration: 250 });
}

function selectAsset(asset) {
  const opening = !document.body.classList.contains("has-selection");
  const applySelection = () => {
    state.selectedAsset = asset;
    updateAssetSelection();
    renderDetail();
  };
  if (opening) {
    animateDockLayout(true, applySelection);
  } else {
    applySelection();
    animateDetailSwap();
  }
  if (state.deferredRefresh && !activeDetailMedia()) {
    flushDeferredRefresh().catch((error) => {
      els.refreshStatus.textContent = `刷新失败：${error.message}`;
    });
  }
}

function renderDetail() {
  const asset = state.selectedAsset;
  if (!asset) {
    document.body.classList.remove("has-selection");
    els.quickMoveAsset.hidden = true;
    els.detailName.textContent = "未选择资产";
    els.detailPreview.innerHTML = "";
    delete els.detailPreview.dataset.assetId;
    els.detailPreview.classList.remove("is-portrait", "is-square", "is-landscape");
    els.detailBody.innerHTML = "选择一个资产查看详情";
    els.detailBody.className = "detail-body muted";
    return;
  }

  document.body.classList.add("has-selection");
  els.quickMoveAsset.hidden = Boolean(asset.isGroup);
  const status = displayStatus(asset);
  const classification = classificationOf(asset);
  els.detailName.textContent = asset.name;
  if (els.detailPreview.dataset.assetId !== asset.id) {
    els.detailPreview.innerHTML = mediaPreview(asset, true);
    els.detailPreview.dataset.assetId = asset.id;
  }
  configureDetailPreviewFit();
  resumeDeferredRefreshWhenPlaybackStops();
  els.detailBody.className = "detail-body";
  if (state.codexEmbedded && !asset.isGroup) {
    renderCodexResourceDetail(asset);
    return;
  }
  if (asset.isGroup) {
    els.detailBody.innerHTML = `
      <div class="detail-row">
        <label>抽帧文件夹</label>
        <div class="mono">${absolutePath(asset)}<br>共 ${asset.groupCount} 项<br>代表资产：${asset.caseRelPath}</div>
      </div>
      <div class="detail-row">
        <label>首尾帧</label>
        <div class="mono">第一帧：${asset.groupFirst?.name || "-"}<br>最后帧：${asset.groupLast?.name || "-"}</div>
      </div>
      <div class="detail-row classification-detail">
        <label>资产分组</label>
        <div><strong class="classification-pill group-${classification.group}">${classification.label}</strong><span>${escapeHtml(classification.confidence)}置信 · ${escapeHtml(classification.source)}</span><p>${escapeHtml(classification.reason)}</p></div>
      </div>
      <div class="detail-actions">
        <button id="copyPath">复制文件夹路径</button>
        <button id="revealAsset">定位代表帧</button>
        <button id="openFolder">打开文件夹</button>
      </div>
    `;
    els.detailBody.querySelector("#copyPath").addEventListener("click", () => copyPath(asset));
    els.detailBody.querySelector("#revealAsset").addEventListener("click", () => reveal(asset));
    els.detailBody.querySelector("#openFolder").addEventListener("click", () => openFolder(asset));
    return;
  }

  const canRebuildThreeD = ["image", "frame", "contact"].includes(asset.kind) || /\.(png|jpe?g|webp)$/i.test(asset.name || "");
  els.detailBody.innerHTML = `
    <div class="detail-row">
      <label>完整路径</label>
      <div class="mono">${absolutePath(asset)}</div>
    </div>
    <div class="detail-row">
      <label>信息</label>
      <div class="mono">类型：${asset.kind}<br>版本：${asset.version || "-"}<br>大小：${formatSize(asset.size)}<br>修改：${new Date(asset.mtimeMs).toLocaleString()}<br>主代理初判：${asset.initialStatus}</div>
    </div>
    <div class="detail-row classification-detail">
      <label>资产分组</label>
      <div><strong class="classification-pill group-${classification.group}">${classification.label}</strong><span>${escapeHtml(classification.confidence)}置信 · ${escapeHtml(classification.source)}</span><p>${escapeHtml(classification.reason)}</p><small>资产分组与下方质量判断分别记录。</small></div>
    </div>
    <div class="detail-row">
      <label class="status-label">用户判断 <span id="statusSaveState">${asset.userStatus ? `已保存：${asset.userStatus}` : "点击即自动保存"}</span></label>
      <div class="status-grid">
        ${userStatuses.map((item) => `<button type="button" class="${asset.userStatus === item ? "active" : ""}" data-asset-status="${item}" aria-pressed="${asset.userStatus === item}">${item}</button>`).join("")}
      </div>
    </div>
    <div class="detail-row">
      <label>备注</label>
      <textarea id="notesInput" placeholder="这里记录你觉得它能怎么用，比如 B-roll、动作局部、封面、参考图...">${asset.notes || ""}</textarea>
    </div>
    <div class="detail-actions">
      ${state.codexEmbedded ? '<button id="useInCodex" class="codex-primary-action">附加到当前对话</button><button id="curateAsset">移动到精选库…</button>' : ""}
      <button id="saveMeta">保存标注</button>
      ${canRebuildThreeD ? '<button id="rebuildThreeD">3D 重建</button>' : ""}
      <button id="moveAsset">移动素材</button>
      <button id="copyPath">复制路径</button>
      <button id="revealAsset">打开位置</button>
      <a href="${asset.downloadUrl}" download>下载文件</a>
      <button id="openFolder">打开文件夹</button>
    </div>
  `;

  els.detailBody.querySelector("#useInCodex")?.addEventListener("click", () => sendAssetToCodex(asset));
  els.detailBody.querySelector("#curateAsset")?.addEventListener("click", () => openMoveAssetDialog(asset, { targetProjectId: "ai-reference-library" }));
  els.detailBody.querySelectorAll("[data-asset-status]").forEach((button) => {
    button.addEventListener("click", () => {
      saveStatus(asset, button.dataset.assetStatus);
    });
  });
  els.detailBody.querySelector("#saveMeta").addEventListener("click", () => saveMeta(asset));
  els.detailBody.querySelector("#rebuildThreeD")?.addEventListener("click", () => openThreeDWorkbenchDialog().catch(showError));
  els.detailBody.querySelector("#moveAsset").addEventListener("click", () => openMoveAssetDialog(asset));
  els.detailBody.querySelector("#copyPath").addEventListener("click", () => copyPath(asset));
  els.detailBody.querySelector("#revealAsset").addEventListener("click", () => reveal(asset));
  els.detailBody.querySelector("#openFolder").addEventListener("click", () => openFolder(asset));
}

function updateAssetMetaInState(asset) {
  const stored = state.assets.find((item) => item.id === asset.id && item.caseId === asset.caseId);
  if (stored && stored !== asset) {
    stored.userStatus = asset.userStatus;
    stored.notes = asset.notes;
  }
}

async function persistMeta(asset, notes) {
  return await api("/api/mark", {
    method: "POST",
    body: JSON.stringify({
      caseId: asset.caseId,
      projectId: asset.projectId,
      assetId: asset.caseRelPath,
      userStatus: asset.userStatus,
      notes,
      favorite: asset.favorite,
      tags: asset.tags
    })
  });
}

function updateSelectedCardStatus(asset) {
  const badge = els.assetGrid.querySelector(".asset-card.selected .status");
  if (!badge) return;
  badge.textContent = displayStatus(asset);
  badge.className = `status ${statusClass(displayStatus(asset))}`;
}

async function saveStatus(asset, nextStatus) {
  const notesInput = els.detailBody.querySelector("#notesInput");
  const notes = notesInput ? notesInput.value : (asset.notes || "");
  const previousStatus = asset.userStatus || "";
  const buttons = [...els.detailBody.querySelectorAll("[data-asset-status]")];
  const indicator = els.detailBody.querySelector("#statusSaveState");
  asset.userStatus = nextStatus;
  asset.notes = notes;
  for (const item of buttons) {
    const active = item.dataset.assetStatus === nextStatus;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
    item.disabled = true;
  }
  if (indicator) indicator.textContent = "保存中…";

  try {
    await persistMeta(asset, notes);
    updateAssetMetaInState(asset);
    updateSelectedCardStatus(asset);
    if (indicator) indicator.textContent = `已保存：${nextStatus}`;
    els.refreshStatus.textContent = `用户判断已保存：${nextStatus}`;
  } catch (error) {
    asset.userStatus = previousStatus;
    for (const item of buttons) {
      const active = item.dataset.assetStatus === previousStatus;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    }
    if (indicator) indicator.textContent = "保存失败，请重试";
    els.refreshStatus.textContent = `判断保存失败：${error.message}`;
  } finally {
    for (const item of buttons) item.disabled = false;
  }
}

function showMoveAssetMessage(message, isError = false) {
  els.moveAssetMessage.textContent = message;
  els.moveAssetMessage.classList.toggle("error", isError);
}

function renderMoveTargetProjects(selectedProjectId) {
  els.moveTargetProject.innerHTML = "";
  for (const project of state.projects.filter((item) => item.exists)) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    option.selected = project.id === selectedProjectId;
    els.moveTargetProject.append(option);
  }
}

function preferredMoveTargetProjectId(assets, explicitProjectId = "") {
  const available = state.projects.filter((project) => project.exists);
  if (explicitProjectId && available.some((project) => project.id === explicitProjectId)) {
    return explicitProjectId;
  }
  const sourceProjects = new Set(assets.map((asset) => asset.projectId));
  if (state.codexBoundProject && !sourceProjects.has(state.codexBoundProject)
      && available.some((project) => project.id === state.codexBoundProject)) {
    return state.codexBoundProject;
  }
  return available.find((project) => !sourceProjects.has(project.id) && project.id !== "ai-reference-library")?.id
    || available.find((project) => !sourceProjects.has(project.id))?.id
    || assets[0]?.projectId
    || available[0]?.id
    || "";
}

function localDateDirectory(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeProjectDirectory(value) {
  const raw = String(value ?? "").trim().replace(/\\/g, "/");
  if (!raw || raw === ".") return "";
  if (/^(?:[a-z]:|\/|https?:)/i.test(raw)) return null;
  const segments = raw.split("/").filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) return null;
  return segments.join("/");
}

function projectScanRootDirectories(project) {
  const roots = (project?.scanRoots || []).map(normalizeProjectDirectory).filter((root) => root !== null);
  return [...new Set(roots)];
}

function isDirectoryInProjectScanRoots(project, directory) {
  const candidate = normalizeProjectDirectory(directory);
  if (candidate === null) return false;
  const roots = projectScanRootDirectories(project);
  if (!roots.length || roots.includes("")) return true;
  return roots.some((root) => candidate === root || candidate.startsWith(`${root}/`));
}

function automaticProjectRouteDirectory(project, now = new Date()) {
  if (!project) return null;
  if (project.id === "pending-review") return localDateDirectory(now);
  const roots = projectScanRootDirectories(project);
  if (roots.length !== 1) return null;
  return roots[0];
}

function joinProjectDirectory(...parts) {
  return parts
    .map((part) => normalizeProjectDirectory(part))
    .filter((part) => part)
    .join("/");
}

function autoOrganizeAssetBucket(assets) {
  const buckets = new Set(assets.map((asset) => {
    if (["image", "frame", "contact"].includes(asset.kind)) return "image";
    if (asset.kind === "video") return "video";
    if (asset.kind === "audio") return "audio";
    return "other";
  }));
  return buckets.size === 1 ? [...buckets][0] : "mixed";
}

function isAutoOrganizeUnsafeDirectory(directory) {
  const normalized = normalizeProjectDirectory(directory);
  if (normalized === null) return true;
  return normalized.split("/").filter(Boolean).some((segment) => {
    const label = segment
      .trim()
      .toLocaleLowerCase("zh-CN")
      .replace(/^\d+[\s._-]*/, "");
    if (/(?:成片|最终|输出|生成记录)/.test(label)) return true;
    return label
      .split(/[\s._-]+/)
      .filter(Boolean)
      .some((token) => /^(?:finals?|outputs?)(?:\d+)?$/i.test(token));
  });
}

function selectedProjectScanRoot(project, selectedDirectory) {
  const candidate = normalizeProjectDirectory(selectedDirectory);
  if (candidate === null) return null;
  const roots = projectScanRootDirectories(project);
  if (roots.includes("")) return "";
  return roots
    .filter((root) => candidate === root || candidate.startsWith(`${root}/`))
    .sort((left, right) => right.length - left.length)[0] ?? null;
}

function inferredProjectScanRoot(project, assets, selectedDirectory = "", taskTitle = "") {
  const roots = projectScanRootDirectories(project);
  if (roots.length <= 1) return roots[0] ?? "";
  const selectedRoot = selectedProjectScanRoot(project, selectedDirectory);
  if (selectedRoot !== null) return selectedRoot;

  const haystack = [
    taskTitle,
    ...assets.flatMap((asset) => [asset.name, asset.dir, asset.relPath, asset.caseId])
  ].join(" ").toLocaleLowerCase("zh-CN");
  const ignored = new Set(["参考", "图片", "视频", "音频", "素材", "生成", "成片", "项目", "任务"]);
  const scores = roots.map((root) => {
    const tokens = root
      .toLocaleLowerCase("zh-CN")
      .split(/[\\/._\-\s]+/)
      .filter((token) => token.length >= 2 && !ignored.has(token));
    return {
      root,
      score: tokens.reduce((score, token) => score + (haystack.includes(token) ? token.length : 0), 0)
    };
  }).sort((left, right) => right.score - left.score);
  if (!scores[0]?.score || scores[0].score === scores[1]?.score) return null;
  return scores[0].root;
}

function autoOrganizeCanonicalDirectory(project, root, bucket, now = new Date()) {
  const category = bucket === "image" ? "图片"
    : bucket === "video" ? "视频"
      : bucket === "audio" ? "音频"
        : "素材";
  if (project.id === "pending-review") return localDateDirectory(now);
  if (project.id === "dated-workspace") return joinProjectDirectory(localDateDirectory(now), category);
  if (project.id === "episode-series") {
    if (bucket === "video") return joinProjectDirectory(root, "生成视频");
    if (bucket === "image") return joinProjectDirectory(root, "参考", "图片");
    return joinProjectDirectory(root, "参考", category);
  }
  return joinProjectDirectory(root, category);
}

function autoOrganizeExistingDirectory(project, root, bucket, availableDirectories) {
  if (["pending-review", "dated-workspace", "episode-series"].includes(project.id)) return "";
  const preferredNames = bucket === "image" ? ["图片", "图像", "images", "stills", "参考"]
    : bucket === "video" ? ["视频", "生成视频", "video", "videos", "clips"]
      : bucket === "audio" ? ["音频", "声音", "音乐", "audio"]
        : ["素材", "assets"];
  const rootDepth = root ? root.split("/").length : 0;
  const candidates = availableDirectories
    .map(normalizeProjectDirectory)
    .filter((directory) => directory !== null && isDirectoryInProjectScanRoots(project, directory))
    .filter((directory) => selectedProjectScanRoot(project, directory) === root)
    .map((directory) => {
      const segments = directory.split("/").filter(Boolean);
      const relativeDepth = segments.length - rootDepth;
      const leaf = (segments.at(-1) || "").toLocaleLowerCase("zh-CN");
      const preferredIndex = preferredNames.findIndex((name) => leaf === name.toLocaleLowerCase("zh-CN"));
      const unsafe = isAutoOrganizeUnsafeDirectory(directory);
      return { directory, relativeDepth, preferredIndex, unsafe };
    })
    .filter((item) => !item.unsafe && item.relativeDepth === 1 && item.preferredIndex >= 0)
    .sort((left, right) => left.preferredIndex - right.preferredIndex || left.directory.localeCompare(right.directory, "zh-CN"));
  return candidates[0]?.directory || "";
}

function recommendAutoOrganizeDirectory(project, assets, availableDirectories = [], selectedDirectory = "", taskTitle = "", now = new Date()) {
  if (!project || !assets.length) return { directory: "", needsRootChoice: false, bucket: "other" };
  const bucket = autoOrganizeAssetBucket(assets);
  const root = inferredProjectScanRoot(project, assets, selectedDirectory, taskTitle);
  if (root === null) return { directory: "", needsRootChoice: true, bucket };
  if (isAutoOrganizeUnsafeDirectory(root)) {
    return { directory: "", needsRootChoice: true, unsafeRoot: true, bucket };
  }
  const canonical = autoOrganizeCanonicalDirectory(project, root, bucket, now);
  const existing = autoOrganizeExistingDirectory(project, root, bucket, availableDirectories);
  const directory = existing || canonical;
  if (!isDirectoryInProjectScanRoots(project, directory) || isAutoOrganizeUnsafeDirectory(directory)) {
    return { directory: "", needsRootChoice: true, bucket };
  }
  return { directory, needsRootChoice: false, bucket };
}

function autoOrganizeMovePlan(project, assets, availableDirectories = [], selectedDirectory = "", taskTitle = "", now = new Date()) {
  const groups = new Map();
  for (const asset of assets) {
    const bucket = autoOrganizeAssetBucket([asset]);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(asset);
  }
  const directoryByBucket = new Map();
  for (const [bucket, bucketAssets] of groups) {
    const recommendation = recommendAutoOrganizeDirectory(
      project,
      bucketAssets,
      availableDirectories,
      selectedDirectory,
      taskTitle,
      now
    );
    if (recommendation.needsRootChoice) return recommendation;
    directoryByBucket.set(bucket, recommendation.directory);
  }
  return {
    needsRootChoice: false,
    items: assets.map((asset) => ({
      asset,
      bucket: autoOrganizeAssetBucket([asset]),
      directory: directoryByBucket.get(autoOrganizeAssetBucket([asset]))
    }))
  };
}

function directProjectAutoOrganizePlan(project, currentCase, assets, availableDirectories = [], taskTitle = "", now = new Date()) {
  if (!project || !currentCase || !assets.length) return { needsRootChoice: false, items: [] };
  const caseDirectory = normalizeProjectDirectory(currentCase.relPath || currentCase.id);
  if (caseDirectory === null || isAutoOrganizeUnsafeDirectory(caseDirectory)) {
    return { needsRootChoice: true, unsafeRoot: true, items: [] };
  }
  const organizeInsideCurrentCase = project.id !== "episode-series";
  const planProject = organizeInsideCurrentCase
    ? { ...project, id: `${project.id}-current-case`, scanRoots: [caseDirectory || "."] }
    : project;
  const selectedDirectory = organizeInsideCurrentCase
    ? caseDirectory
    : normalizeProjectDirectory(currentCase.scanRoot || caseDirectory);
  return autoOrganizeMovePlan(planProject, assets, availableDirectories, selectedDirectory, taskTitle, now);
}

function currentProjectOrganizeContext() {
  const project = state.projects.find((item) => item.id === state.selectedProject && item.exists);
  const currentCase = state.cases.find((item) => item.id === state.selectedCase);
  const excluded = ["pending-review", "ai-reference-library"].includes(project?.id);
  if (!project || !currentCase || excluded) return { visible: false, project, currentCase };
  const caseDirectory = normalizeProjectDirectory(currentCase.relPath || currentCase.id);
  const unsafe = caseDirectory === null || isAutoOrganizeUnsafeDirectory(caseDirectory);
  return { visible: true, project, currentCase, caseDirectory, unsafe };
}

function syncProjectOrganizeButton() {
  if (!els.organizeProjectButton) return;
  if (state.codexEmbedded) { els.organizeProjectButton.hidden = true; return; }
  const context = currentProjectOrganizeContext();
  els.organizeProjectButton.hidden = !context.visible;
  const empty = !state.assets.length;
  els.organizeProjectButton.disabled = !context.visible || context.unsafe || empty || state.batchBusy;
  els.organizeProjectButton.textContent = state.projectOrganizeBusy ? "整理中…" : "自动整理";
  els.organizeProjectButton.setAttribute("aria-busy", String(state.projectOrganizeBusy));
  els.organizeProjectButton.title = context.unsafe
    ? "成片和最终输出区不参与自动整理"
    : empty
      ? "当前文件夹没有可整理的素材"
      : "按素材类型整理当前文件夹中的全部素材；不受搜索和筛选影响";
}

async function batchMoveItems(items, defaults = {}) {
  const results = [];
  const errors = [];
  for (let index = 0; index < items.length; index += 200) {
    const chunk = items.slice(index, index + 200);
    try {
      const data = await api("/api/batch-move", {
        method: "POST",
        body: JSON.stringify({ ...defaults, items: chunk })
      });
      results.push(...(data.results || []));
      errors.push(...(data.errors || []));
    } catch (error) {
      errors.push(...chunk.map((item) => ({ item, message: error.message || String(error) })));
      break;
    }
  }
  return { results, errors };
}

async function organizeCurrentProject() {
  const context = currentProjectOrganizeContext();
  if (!context.visible || context.unsafe || state.batchBusy) return;
  const projectId = context.project.id;
  const caseId = context.currentCase.id;
  const assets = [...state.assets];
  if (!assets.length) {
    showToast("当前文件夹没有可整理的素材");
    return;
  }

  state.batchBusy = true;
  state.projectOrganizeBusy = true;
  updateBatchBar();
  try {
    const folderData = await api(`/api/folders?project=${encodeURIComponent(projectId)}`);
    if (state.selectedProject !== projectId || state.selectedCase !== caseId) return;
    const availableDirectories = [
      ...projectScanRootDirectories(context.project),
      context.caseDirectory,
      ...(folderData.folders || []).map((folder) => folder.path)
    ].filter((directory) => directory !== null && directory !== undefined);
    const plan = directProjectAutoOrganizePlan(
      context.project,
      context.currentCase,
      assets,
      availableDirectories,
      state.codexThreadTitle
    );
    if (plan.needsRootChoice) {
      showToast(plan.unsafeRoot
        ? "当前是成片或最终输出区，不参与自动整理"
        : "请先进入项目中明确的素材文件夹，再点自动整理", { tone: "error", duration: 6000 });
      return;
    }
    const pending = plan.items.filter((item) => (
      normalizeProjectDirectory(item.asset.dir) !== normalizeProjectDirectory(item.directory)
    ));
    if (!pending.length) {
      showToast("当前文件夹已经整理好了");
      return;
    }
    const data = await batchMoveItems(pending.map((item) => ({
      ...moveRequestItem(item.asset),
      targetDirectory: item.directory
    })), { targetProjectId: projectId });
    const movedCount = data.results.length;
    const failedCount = data.errors.length;
    if (!movedCount && failedCount) throw new Error(data.errors[0]?.message || "自动整理失败");
    state.selectedAsset = null;
    exitSelectionMode();
    await loadProjects();
    await loadCases();
    await loadAssets();
    const message = failedCount
      ? `已整理 ${movedCount} 项，${failedCount} 项未能整理`
      : `已自动整理 ${movedCount} 项素材`;
    showToast(message, {
      tone: failedCount ? "error" : "neutral",
      actionLabel: movedCount ? "撤销" : "",
      duration: 12000,
      onAction: () => undoMovedAssets(data.results)
    });
  } finally {
    state.batchBusy = false;
    state.projectOrganizeBusy = false;
    updateBatchBar();
  }
}

function availableMoveTargetDirectories() {
  return [...els.moveTargetFolder.options]
    .map((option) => option.value)
    .filter(Boolean);
}

async function loadMoveTargetFolders(preferredPath = "") {
  const projectId = els.moveTargetProject.value;
  if (!projectId) return;
  const generation = ++state.moveFolderLoadGeneration;
  els.moveTargetFolder.disabled = true;
  els.autoOrganizeMoveAsset.disabled = true;
  els.moveTargetFolder.innerHTML = '<option value="">正在读取文件夹…</option>';
  try {
    const data = await api(`/api/folders?project=${encodeURIComponent(projectId)}`);
    if (generation !== state.moveFolderLoadGeneration || els.moveTargetProject.value !== projectId) return;
    const project = state.projects.find((item) => item.id === projectId && item.exists);
    const scanRoots = projectScanRootDirectories(project);
    const folders = [];
    const seen = new Set();
    for (const path of [...scanRoots, ...(data.folders || []).map((folder) => folder.path)]) {
      const normalized = normalizeProjectDirectory(path);
      if (normalized === null || seen.has(normalized) || !isDirectoryInProjectScanRoots(project, normalized)) continue;
      seen.add(normalized);
      const source = (data.folders || []).find((folder) => normalizeProjectDirectory(folder.path) === normalized);
      folders.push({ path: normalized, depth: source?.depth ?? normalized.split("/").filter(Boolean).length - 1 });
    }
    els.moveTargetFolder.innerHTML = "";
    const preferred = normalizeProjectDirectory(preferredPath);
    const preferredIsAllowed = preferred !== null && isDirectoryInProjectScanRoots(project, preferred);
    const needsChoice = scanRoots.length > 1 && (!preferred || !preferredIsAllowed);
    if (needsChoice) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "请选择素材区…";
      placeholder.disabled = true;
      placeholder.selected = true;
      els.moveTargetFolder.append(placeholder);
    }
    for (const folder of folders) {
      const option = document.createElement("option");
      option.value = folder.path;
      const indent = folder.depth ? `${"　".repeat(Math.min(folder.depth, 6))}└ ` : "";
      option.textContent = `${indent}${folder.path || "项目根目录"}`;
      els.moveTargetFolder.append(option);
    }
    const available = new Set(folders.map((item) => item.path));
    let candidate = preferredIsAllowed ? preferred : "";
    if (!candidate && scanRoots.length === 1) candidate = scanRoots[0];
    while (candidate && !available.has(candidate)) {
      const parent = candidate.replace(/\/[^/]+$/, "");
      if (parent === candidate) break;
      candidate = parent;
    }
    if (!needsChoice) els.moveTargetFolder.value = available.has(candidate) ? candidate : "";
    if (data.truncated) showMoveAssetMessage("文件夹较多，仅显示项目素材区内的前 1500 个文件夹；也可以填写素材区内的自定义文件夹。");
  } catch (error) {
    if (generation !== state.moveFolderLoadGeneration || els.moveTargetProject.value !== projectId) return;
    els.moveTargetFolder.innerHTML = '<option value="">读取失败</option>';
    showMoveAssetMessage(`文件夹读取失败：${error.message}`, true);
  } finally {
    if (generation === state.moveFolderLoadGeneration && els.moveTargetProject.value === projectId) {
      els.moveTargetFolder.disabled = false;
      els.autoOrganizeMoveAsset.disabled = false;
    }
  }
}

async function openMoveAssetDialog(asset = state.selectedAsset, options = {}) {
  if (!asset || asset.isGroup) return;
  state.movingAsset = asset;
  state.movingAssets = [];
  const targetProjectId = preferredMoveTargetProjectId([asset], options.targetProjectId);
  renderMoveTargetProjects(targetProjectId);
  if (state.projects.some((project) => project.id === targetProjectId && project.exists)) {
    els.moveTargetProject.value = targetProjectId;
  }
  els.moveCustomFolder.value = "";
  els.moveTargetName.value = asset.name;
  els.moveTargetNameField.hidden = false;
  els.moveAssetSummary.textContent = `当前：${absolutePath(asset)}`;
  showMoveAssetMessage(options.targetProjectId === "ai-reference-library"
    ? "选择精选库中的分类位置，确认后再收录。"
    : "点“自动整理”按项目结构和素材类型归位，也可以手动选择位置。");
  els.moveAssetDialog.showModal();
  await loadMoveTargetFolders(targetProjectId === asset.projectId ? asset.dir || "" : "");
}

async function openBatchMoveDialog(options = {}) {
  const assets = selectedAssets();
  if (!assets.length) return;
  state.movingAsset = null;
  state.movingAssets = assets;
  const projectId = preferredMoveTargetProjectId(assets, options.targetProjectId);
  const sharedDirectory = assets.every((asset) => asset.dir === assets[0].dir) ? assets[0].dir : "";
  const sharedSourceProject = assets.every((asset) => asset.projectId === projectId);
  renderMoveTargetProjects(projectId);
  if (state.projects.some((project) => project.id === projectId && project.exists)) {
    els.moveTargetProject.value = projectId;
  }
  els.moveCustomFolder.value = "";
  els.moveTargetName.value = "";
  els.moveTargetNameField.hidden = true;
  els.moveAssetSummary.textContent = `已选 ${assets.length} 项；移动时保留各自文件名与配套提示词。`;
  showMoveAssetMessage(options.targetProjectId === "ai-reference-library"
    ? "选择精选库中的分类位置，确认后再收录。"
    : "点“自动整理”按项目结构和素材类型归位，也可以手动选择位置。");
  els.moveAssetDialog.showModal();
  await loadMoveTargetFolders(sharedSourceProject && !options.targetProjectId ? sharedDirectory : "");
}

function moveRequestItem(asset) {
  return {
    sourceProjectId: asset.projectId,
    sourcePath: asset.relPath,
    sourceCaseId: asset.caseId,
    sourceAssetId: asset.outputId || asset.caseRelPath,
    outputId: asset.outputId || "",
    fileName: asset.name
  };
}

function projectDirname(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "" : normalized.slice(0, separator);
}

function reverseMoveItems(results) {
  return results.map((result) => ({
    sourceProjectId: result.targetProjectId,
    sourcePath: result.targetRelativePath,
    sourceCaseId: result.reviewMeta?.caseId || "",
    sourceAssetId: result.outputId || result.reviewMeta?.assetId || "",
    outputId: result.outputId || "",
    targetProjectId: result.sourceProjectId,
    targetDirectory: projectDirname(result.sourceRelativePath),
    fileName: result.sourceFileName
  }));
}

async function undoMovedAssets(results) {
  const data = await batchMoveItems(reverseMoveItems(results));
  await loadProjects();
  await loadCases();
  await loadAssets();
  if (data.errors?.length) throw new Error(`已撤销 ${data.results.length} 项，另有 ${data.errors.length} 项未能撤销`);
  showToast(`已撤销 ${data.results.length} 项移动`);
}

async function routeAssetsToProject(assets, targetProjectId, actionLabel, options = {}) {
  const movable = assets.filter((asset) => asset.projectId !== targetProjectId);
  if (!movable.length) {
    showToast(`所选素材已经在${targetProjectId === "pending-review" ? "待处理" : "目标项目"}中`);
    return;
  }
  const targetProject = state.projects.find((project) => project.id === targetProjectId && project.exists);
  if (!targetProject) {
    showToast("目标项目当前不可用", { tone: "error" });
    return;
  }
  const targetDirectory = options.targetDirectory ?? automaticProjectRouteDirectory(targetProject);
  if (targetDirectory === null) {
    if (assets.length > 1) {
      await openBatchMoveDialog({ targetProjectId });
    } else {
      await openMoveAssetDialog(assets[0], { targetProjectId });
    }
    showToast("这个项目有多个素材区，请确认要放到哪个文件夹", { duration: 6000 });
    return;
  }
  state.batchBusy = true;
  updateBatchBar();
  try {
    const data = await api("/api/batch-move", {
      method: "POST",
      body: JSON.stringify({
        items: movable.map(moveRequestItem),
        targetProjectId,
        targetDirectory
      })
    });
    const moved = data.results?.length || 0;
    const failed = data.errors?.length || 0;
    if (!moved && failed) throw new Error(data.errors[0]?.message || `${actionLabel}失败`);
    state.selectedAsset = null;
    if (options.preserveSelection) {
      for (const item of movable) state.selectedAssetKeys.delete(assetSelectionKey(item));
    } else {
      exitSelectionMode();
    }
    await loadProjects();
    await loadCases();
    await loadAssets();
    if (options.preserveSelection) {
      updateBatchBar();
      updateAssetSelection();
    }
    const message = failed ? `${actionLabel}：成功 ${moved} 项，失败 ${failed} 项` : `已将 ${moved} 项素材${actionLabel}`;
    showToast(message, {
      tone: failed ? "error" : "neutral",
      actionLabel: moved ? "撤销" : "",
      duration: 12000,
      onAction: () => undoMovedAssets(data.results)
    });
  } catch (error) {
    showError(error);
  } finally {
    state.batchBusy = false;
    updateBatchBar();
  }
}

async function routeSelectedAssetsForCurrentTask() {
  const assets = selectedAssets();
  if (!assets.length) return;
  const viewingBoundProject = Boolean(state.codexBoundProject && state.selectedProject === state.codexBoundProject);
  if (!viewingBoundProject && !state.codexBoundProject) {
    els.batchMorePopover?.hidePopover?.();
    await openBatchMoveDialog();
    return;
  }
  els.batchMorePopover?.hidePopover?.();
  await routeAssetsToProject(
    assets,
    viewingBoundProject ? "pending-review" : state.codexBoundProject,
    viewingBoundProject ? "移回待处理" : `移动到「${codexProjectName(state.codexBoundProject)}」`
  );
}

async function routeAssetForCurrentTask(asset) {
  if (!asset || asset.isGroup) return;
  const viewingBoundProject = Boolean(state.codexBoundProject && asset.projectId === state.codexBoundProject);
  if (!viewingBoundProject && !state.codexBoundProject) {
    await openMoveAssetDialog(asset);
    return;
  }
  await routeAssetsToProject(
    [asset],
    viewingBoundProject ? "pending-review" : state.codexBoundProject,
    viewingBoundProject ? "移回待处理" : `移动到「${codexProjectName(state.codexBoundProject)}」`,
    { preserveSelection: true }
  );
}

function positionBatchMorePopover() {
  if (!els.batchMoreButton || !els.batchMorePopover) return;
  const rect = els.batchMoreButton.getBoundingClientRect();
  const width = 224;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
  els.batchMorePopover.style.left = `${left}px`;
  els.batchMorePopover.style.top = `${Math.max(12, Math.min(window.innerHeight - 344, rect.bottom + 6))}px`;
}

async function autoOrganizeMoveAssets() {
  const assets = state.movingAssets.length ? state.movingAssets : (state.movingAsset ? [state.movingAsset] : []);
  if (!assets.length || state.batchBusy) return;
  const targetProjectId = els.moveTargetProject.value;
  const targetProject = state.projects.find((project) => project.id === targetProjectId && project.exists);
  if (!targetProject) {
    showMoveAssetMessage("请选择目标项目。", true);
    return;
  }
  const plan = autoOrganizeMovePlan(
    targetProject,
    assets,
    availableMoveTargetDirectories(),
    els.moveTargetFolder.value,
    state.codexThreadTitle
  );
  if (plan.needsRootChoice) {
    showMoveAssetMessage(plan.unsafeRoot
      ? "这里是成片或最终输出区，自动整理不会放到这里。请先选择素材区。"
      : "这个项目有多个素材区，请先选择对应的素材区，再点“自动整理”。", true);
    els.moveTargetFolder.focus();
    return;
  }
  const itemTargetDirectories = plan.items.map((item) => item.directory);
  const destinationLabels = [...new Set(itemTargetDirectories)]
    .map((directory) => directory ? directory.replace(/\//g, "\\") : "项目根目录");
  if (destinationLabels.length === 1) {
    els.moveCustomFolder.value = destinationLabels[0] === "项目根目录" ? "" : destinationLabels[0];
    showMoveAssetMessage(`将自动整理到：${destinationLabels[0]}`);
  } else {
    els.moveCustomFolder.value = "";
    showMoveAssetMessage(`将按素材类型自动整理到 ${destinationLabels.length} 个文件夹。`);
  }
  await confirmMoveAsset({ autoOrganized: true, itemTargetDirectories });
}

async function confirmMoveAsset(options = {}) {
  const assets = state.movingAssets.length ? state.movingAssets : (state.movingAsset ? [state.movingAsset] : []);
  if (!assets.length) return;
  const targetProjectId = els.moveTargetProject.value;
  const rawTargetDirectory = options.targetDirectory ?? (els.moveCustomFolder.value.trim() || els.moveTargetFolder.value);
  const targetDirectory = normalizeProjectDirectory(rawTargetDirectory);
  const itemTargetDirectories = Array.isArray(options.itemTargetDirectories)
    ? options.itemTargetDirectories.map(normalizeProjectDirectory)
    : null;
  if (!targetProjectId) {
    showMoveAssetMessage("请选择目标项目。", true);
    return;
  }
  const targetProject = state.projects.find((project) => project.id === targetProjectId && project.exists);
  const invalidItemTargets = itemTargetDirectories
    && (itemTargetDirectories.length !== assets.length || itemTargetDirectories.some((directory) => (
      directory === null
      || !isDirectoryInProjectScanRoots(targetProject, directory)
      || (options.autoOrganized && isAutoOrganizeUnsafeDirectory(directory))
    )));
  if (!targetProject || invalidItemTargets || (!itemTargetDirectories && (
    targetDirectory === null || !isDirectoryInProjectScanRoots(targetProject, targetDirectory)
  ))) {
    showMoveAssetMessage("请选择目标项目的素材区或其子文件夹。", true);
    return;
  }
  els.autoOrganizeMoveAsset.disabled = true;
  els.confirmMoveAsset.disabled = true;
  state.batchBusy = true;
  updateBatchBar();
  const uniqueTargetDirectories = [...new Set(itemTargetDirectories || [targetDirectory])];
  const destinationLabel = uniqueTargetDirectories.length === 1
    ? (uniqueTargetDirectories[0] ? uniqueTargetDirectories[0].replace(/\//g, "\\") : "项目根目录")
    : `${uniqueTargetDirectories.length} 个分类文件夹`;
  showMoveAssetMessage(options.autoOrganized
    ? `正在自动整理 ${assets.length} 项素材到 ${destinationLabel}…`
    : `正在校验并移动 ${assets.length} 项素材…`);
  try {
    const items = assets.map((asset, index) => ({
      ...moveRequestItem(asset),
      ...(itemTargetDirectories ? { targetDirectory: itemTargetDirectories[index] } : {}),
      fileName: assets.length === 1 ? (els.moveTargetName.value.trim() || asset.name) : asset.name
    }));
    const data = await api("/api/batch-move", {
      method: "POST",
      body: JSON.stringify({
        items,
        targetProjectId,
        targetDirectory
      })
    });
    state.selectedAsset = null;
    state.movingAsset = null;
    state.movingAssets = [];
    els.moveAssetDialog.close();
    exitSelectionMode();
    await loadProjects();
    await loadCases();
    await loadAssets();
    const movedCount = data.results?.length || 0;
    const failedCount = data.errors?.length || 0;
    const targetName = data.results?.[0]?.targetProjectName || "目标位置";
    const message = failedCount
      ? `${options.autoOrganized ? "已自动整理" : "已移动"} ${movedCount} 项，${failedCount} 项失败`
      : `${options.autoOrganized ? "已自动整理" : "已移动"} ${movedCount} 项到 ${targetName}${destinationLabel !== "项目根目录" ? ` · ${destinationLabel}` : ""}`;
    els.refreshStatus.textContent = message;
    if (movedCount) {
      showToast(message, {
        tone: failedCount ? "error" : "neutral",
        actionLabel: "撤销",
        duration: 12000,
        onAction: () => undoMovedAssets(data.results)
      });
    } else if (failedCount) {
      throw new Error(data.errors[0]?.message || "移动失败");
    }
  } catch (error) {
    showMoveAssetMessage(`移动失败：${error.message}`, true);
    showError(error);
  } finally {
    state.batchBusy = false;
    updateBatchBar();
    els.autoOrganizeMoveAsset.disabled = false;
    els.confirmMoveAsset.disabled = false;
  }
}

function markRequestItem(asset, userStatus = asset.userStatus, metadata = null) {
  const source = metadata || asset;
  return {
    projectId: asset.projectId,
    caseId: asset.caseId,
    assetId: asset.caseRelPath,
    userStatus: userStatus || "",
    notes: source.notes || "",
    favorite: Boolean(source.favorite),
    tags: Array.isArray(source.tags) ? source.tags : []
  };
}

async function applyBatchStatus(nextStatus) {
  const assets = selectedAssets();
  if (!assets.length || !nextStatus) return 0;
  state.batchBusy = true;
  updateBatchBar();
  const previous = assets.map((asset) => ({ asset, metadata: {
    userStatus: asset.userStatus || "",
    notes: asset.notes || "",
    favorite: asset.favorite,
    tags: asset.tags || []
  } }));
  try {
    const data = await api("/api/batch-mark", {
      method: "POST",
      body: JSON.stringify({ items: assets.map((asset) => markRequestItem(asset, nextStatus)) })
    });
    const successful = new Set((data.results || []).map((item) => `${item.projectId}::${item.caseId}::${item.assetId}`));
    for (const asset of assets) {
      if (successful.has(`${asset.projectId}::${asset.caseId}::${asset.caseRelPath}`)) asset.userStatus = nextStatus;
    }
    render();
    const changed = data.results?.length || 0;
    const failed = data.errors?.length || 0;
    const message = failed ? `已标记 ${changed} 项，${failed} 项失败` : `已将 ${changed} 项标记为“${nextStatus}”`;
    showToast(message, {
      tone: failed ? "error" : "neutral",
      actionLabel: changed ? "撤销" : "",
      duration: 10000,
      onAction: async () => {
        await api("/api/batch-mark", {
          method: "POST",
          body: JSON.stringify({ items: previous.map(({ asset, metadata }) => markRequestItem(asset, metadata.userStatus, metadata)) })
        });
        for (const { asset, metadata } of previous) Object.assign(asset, metadata);
        render();
        showToast(`已撤销 ${changed} 项标记`);
      }
    });
    return changed;
  } catch (error) {
    showError(error);
    return 0;
  } finally {
    state.batchBusy = false;
    els.batchStatusSelect.value = "";
    updateBatchBar();
  }
}

async function discardSelectedAssets() {
  const changed = await applyBatchStatus("丢弃");
  if (!changed) return;
  if (state.selectedProject === "pending-review") {
    state.statusFilter = "待用户判断";
    els.statusFilters.querySelectorAll("[data-status]").forEach((button) => {
      button.classList.toggle("active", button.dataset.status === state.statusFilter);
    });
    syncEmbeddedFilterControls();
  }
  exitSelectionMode();
  render();
}

function openBatchDeleteDialog() {
  const assets = selectedAssets();
  const count = assets.length;
  if (!count) return;
  if (assets.some((asset) => asset.managed)) {
    showToast("受管生成资产只在 E 盘保存一份；请先标记为“丢弃”，暂不物理删除", { tone: "error", duration: 6000 });
    return;
  }
  els.batchDeleteTitle.textContent = `删除所选 ${count} 项素材？`;
  els.batchDeleteSummary.textContent = "素材会从当前库移出，并保留 15 分钟供你主动撤销；不会读取或恢复 Windows 回收站里的内容。";
  els.batchDeleteDialog.showModal();
}

async function confirmBatchDelete() {
  const assets = selectedAssets();
  if (!assets.length) return els.batchDeleteDialog.close();
  state.batchBusy = true;
  els.confirmBatchDelete.disabled = true;
  updateBatchBar();
  try {
    const data = await api("/api/trash-assets", {
      method: "POST",
      body: JSON.stringify({ items: assets.map((asset) => ({
        projectId: asset.projectId,
        sourcePath: asset.relPath,
        caseId: asset.caseId,
        assetId: asset.caseRelPath,
        outputId: asset.outputId || ""
      })) })
    });
    els.batchDeleteDialog.close();
    exitSelectionMode();
    state.selectedAsset = null;
    await loadCases();
    await loadAssets();
    const count = data.result.count;
    showToast(`已删除 ${count} 项素材`, {
      actionLabel: "撤销",
      duration: 12000,
      onAction: async () => {
        await api("/api/restore-trash", {
          method: "POST",
          body: JSON.stringify({ token: data.result.token })
        });
        await loadCases();
        await loadAssets();
        showToast(`已恢复 ${count} 项素材`);
      }
    });
  } catch (error) {
    showError(error);
  } finally {
    state.batchBusy = false;
    els.confirmBatchDelete.disabled = false;
    updateBatchBar();
  }
}

async function saveMeta(asset) {
  const notes = els.detailBody.querySelector("#notesInput")?.value || "";
  asset.notes = notes;
  try {
    await persistMeta(asset, notes);
    updateAssetMetaInState(asset);
    updateSelectedCardStatus(asset);
    const indicator = els.detailBody.querySelector("#statusSaveState");
    if (indicator) indicator.textContent = asset.userStatus ? `已保存：${asset.userStatus}` : "备注已保存";
    els.refreshStatus.textContent = "标注与备注已保存";
  } catch (error) {
    els.refreshStatus.textContent = `标注保存失败：${error.message}`;
  }
}

async function copyPath(asset) {
  await navigator.clipboard.writeText(absolutePath(asset));
  els.refreshStatus.textContent = "已复制路径";
}

async function reveal(asset) {
  await api("/api/reveal", {
    method: "POST",
    body: JSON.stringify({ projectId: asset.projectId, path: asset.relPath, outputId: asset.outputId || "" })
  });
  els.refreshStatus.textContent = "已在文件夹中定位该素材";
}

async function openFolder(asset) {
  await api("/api/open-folder", {
    method: "POST",
    body: JSON.stringify({ projectId: asset.projectId, path: asset.relPath, outputId: asset.outputId || "" })
  });
  els.refreshStatus.textContent = "已打开素材所在文件夹";
}

async function addProject() {
  const name = els.projectNameInput.value.trim();
  const projectPath = els.projectPathInput.value.trim();
  const scanRoots = els.projectScanRootsInput.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!projectPath) {
    els.refreshStatus.textContent = "请填写项目文件夹路径";
    return;
  }
  const data = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, path: projectPath, scanRoots })
  });
  state.selectedProject = data.project.id;
  state.selectedCase = "";
  els.projectNameInput.value = "";
  els.projectPathInput.value = "";
  await loadProjects();
  await loadCases();
  await loadAssets();
  els.refreshStatus.textContent = "项目已添加并开始监听";
}

const promptKindLabels = {
  capture: "原始收录",
  term: "原子词",
  recipe: "组合配方",
  prompt: "成品 Prompt"
};

function selectedPromptAssetPath() {
  if (!state.selectedAsset || state.selectedAsset.isGroup) return "";
  return absolutePath(state.selectedAsset);
}

function updatePromptKindUi() {
  const isRecipe = els.promptKind.value === "recipe";
  els.promptRecipeTermsLabel.hidden = !isRecipe;
  els.promptText.placeholder = els.promptKind.value === "capture"
    ? "粘贴网页里选中的视觉描述，原文会完整保留。"
    : els.promptKind.value === "term"
      ? "只写一个可以独立增删、替换或锁定的可见画面变量。"
      : els.promptKind.value === "recipe"
        ? "说明这些原子词需要共同保持的画面关系。"
        : "填写可以直接用于生成的完整 Prompt。";
}

function renderPromptTermOptions(selectedIds = []) {
  const selected = new Set(selectedIds || []);
  els.promptRecipeTerms.replaceChildren();
  for (const term of state.promptTerms || []) {
    const option = document.createElement("option");
    option.value = term.id;
    option.textContent = `${term.title || term.text}${term.category ? ` · ${term.category}` : ""}`;
    option.selected = selected.has(term.id);
    els.promptRecipeTerms.append(option);
  }
}

function resetPromptEditor() {
  state.editingPromptItem = null;
  els.promptEditorTitle.textContent = "收下一条灵感";
  els.promptCancelEdit.hidden = true;
  els.promptSaveItem.textContent = "保存到词库";
  els.promptKind.value = "capture";
  els.promptTitle.value = "";
  els.promptCategory.value = "";
  els.promptVisualRole.value = "";
  els.promptTags.value = "";
  els.promptText.value = "";
  renderPromptTermOptions();
  updatePromptKindUi();
}

function editPromptItem(item) {
  state.editingPromptItem = item;
  els.promptEditorTitle.textContent = `编辑${promptKindLabels[item.kind] || "词库内容"}`;
  els.promptCancelEdit.hidden = false;
  els.promptSaveItem.textContent = "保存修改";
  els.promptKind.value = item.kind;
  els.promptTitle.value = item.title || "";
  els.promptCategory.value = item.category || "";
  els.promptVisualRole.value = item.visualRole || "";
  els.promptTags.value = (item.tags || []).join(", ");
  els.promptText.value = item.text || "";
  renderPromptTermOptions(item.memberTermIds || []);
  updatePromptKindUi();
  els.promptText.focus();
}

function updatePromptCounts(counts = {}) {
  els.promptCaptureCount.textContent = counts.captures || 0;
  els.promptTermCount.textContent = counts.terms || 0;
  els.promptRecipeCount.textContent = counts.recipes || 0;
  els.promptReadyCount.textContent = counts.prompts || 0;
  els.promptPendingCount.textContent = counts.unprocessed || 0;
}

function promptButton(label, handler, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener("click", handler);
  return button;
}

function renderPromptLibrary() {
  els.promptLibraryList.replaceChildren();
  if (!state.promptItems.length) {
    const empty = document.createElement("div");
    empty.textContent = "没有符合当前条件的内容。先在上方收下一条网页灵感，或清空筛选。";
    els.promptLibraryList.append(empty);
    return;
  }

  for (const item of state.promptItems) {
    const card = document.createElement("article");
    card.className = "prompt-card";

    const head = document.createElement("div");
    head.className = "prompt-card-head";
    const title = document.createElement("div");
    title.className = "prompt-card-title";
    title.textContent = item.title || item.text;
    const kind = document.createElement("span");
    kind.className = `prompt-card-kind ${item.kind}`;
    kind.textContent = promptKindLabels[item.kind] || item.kind;
    head.append(title, kind);

    const text = document.createElement("p");
    text.className = "prompt-card-text";
    text.textContent = item.text;

    const meta = document.createElement("div");
    meta.className = "prompt-card-meta";
    for (const value of [item.category, item.visualRole, ...(item.tags || []).slice(0, 3)].filter(Boolean)) {
      const chip = document.createElement("span");
      chip.className = "prompt-card-chip";
      chip.textContent = value;
      meta.append(chip);
    }

    const source = document.createElement("div");
    source.className = "prompt-card-source";
    source.title = item.assetPath || item.sourceUrl || "";
    source.textContent = item.assetPath
      ? `关联资产：${item.assetPath}`
      : item.sourceTitle || item.sourceUrl || (item.reviewStatus === "needs-review" ? "待整理" : "已进入可用层");

    const actions = document.createElement("div");
    actions.className = "prompt-card-actions";
    actions.append(
      promptButton("复制", async () => {
        await navigator.clipboard.writeText(item.text);
        els.promptSaveMessage.textContent = `已复制：${item.title || promptKindLabels[item.kind]}`;
      }),
      promptButton("用于生成", async () => {
        els.promptLibraryDialog.close();
        await openGenerationDialog();
        els.generationPrompt.value = item.text;
      }),
      promptButton("编辑", () => editPromptItem(item)),
      promptButton("删除", async () => {
        if (!window.confirm(`删除“${item.title || item.text.slice(0, 20)}”？`)) return;
        await api(`/api/prompt-library/items/${item.kind}/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        await loadPromptLibrary();
      }, "delete")
    );
    card.append(head, text, meta, source, actions);
    els.promptLibraryList.append(card);
  }
}

function refreshPromptCategoryFilter() {
  const current = els.promptCategoryFilter.value;
  const categories = [...new Set((state.promptAllItems || []).map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  els.promptCategoryFilter.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部分类";
  els.promptCategoryFilter.append(all);
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    els.promptCategoryFilter.append(option);
  }
  if (categories.includes(current)) els.promptCategoryFilter.value = current;
}

async function loadPromptLibrary() {
  const params = new URLSearchParams();
  if (els.promptKindFilter.value) params.set("kind", els.promptKindFilter.value);
  if (els.promptSearch.value.trim()) params.set("query", els.promptSearch.value.trim());
  if (els.promptCategoryFilter.value) params.set("category", els.promptCategoryFilter.value);
  const [filtered, all, terms] = await Promise.all([
    api(`/api/prompt-library?${params}`),
    api("/api/prompt-library"),
    api("/api/prompt-library?kind=term")
  ]);
  state.promptItems = filtered.items || [];
  state.promptAllItems = all.items || [];
  state.promptTerms = terms.items || [];
  state.promptCounts = all.counts || {};
  updatePromptCounts(state.promptCounts);
  refreshPromptCategoryFilter();
  renderPromptTermOptions(state.editingPromptItem?.memberTermIds || []);
  renderPromptLibrary();
}

async function openPromptLibraryDialog() {
  resetPromptEditor();
  const assetPath = selectedPromptAssetPath();
  const project = state.projects.find((item) => item.id === state.selectedProject);
  els.promptAssetLinkHint.textContent = assetPath
    ? `本次保存会关联当前资产：${assetPath}`
    : project
      ? `本次保存会关联当前项目：${project.name}`
      : "未选择项目，本次内容将作为通用词库保存。";
  els.promptLibraryDialog.showModal();
  await loadPromptLibrary();
}

async function savePromptItem() {
  const kind = els.promptKind.value;
  const payload = {
    kind,
    title: els.promptTitle.value,
    text: els.promptText.value,
    category: els.promptCategory.value,
    visualRole: els.promptVisualRole.value,
    tags: els.promptTags.value,
    projectId: state.editingPromptItem?.projectId || state.selectedProject,
    assetPath: state.editingPromptItem?.assetPath || selectedPromptAssetPath(),
    sourceType: state.editingPromptItem?.sourceType || (selectedPromptAssetPath() ? "asset-console" : "manual"),
    memberTermIds: [...els.promptRecipeTerms.selectedOptions].map((option) => option.value)
  };
  if (!payload.text.trim() && !payload.title.trim()) throw new Error("先填写要保存的内容");
  if (kind === "recipe" && !payload.memberTermIds.length) throw new Error("组合配方至少选择一个原子词");

  if (state.editingPromptItem) {
    await api(`/api/prompt-library/items/${state.editingPromptItem.kind}/${encodeURIComponent(state.editingPromptItem.id)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    els.promptSaveMessage.textContent = "修改已保存。";
  } else {
    const data = await api("/api/prompt-library/items", { method: "POST", body: JSON.stringify(payload) });
    els.promptSaveMessage.textContent = data.duplicate ? "已有同名原子词，本次没有重复添加。" : "已保存到本地词库。";
  }
  if (kind !== "capture") await api("/api/prompt-library/compile", { method: "POST", body: "{}" });
  resetPromptEditor();
  await loadPromptLibrary();
}

async function compilePromptLibrary() {
  const data = await api("/api/prompt-library/compile", { method: "POST", body: "{}" });
  const stats = data.runtime?.stats || {};
  els.promptSaveMessage.textContent = `已编译：${stats.terms || 0} 个词，${stats.recipes || 0} 个配方，${stats.prompts || 0} 条成品。`;
  await loadPromptLibrary();
}

const threeDStageLabels = {
  intake: "参考检查",
  assessment: "质量契约",
  spec: "结构规格",
  blockout: "体块",
  structure: "结构",
  form: "形体",
  material: "材质",
  surface: "表面细节",
  lighting: "灯光",
  interaction: "交互",
  optimization: "优化"
};

function selectedThreeDAsset() {
  const asset = state.selectedAsset;
  if (!asset || asset.isGroup) return null;
  const imageLike = ["image", "frame", "contact"].includes(asset.kind) || /\.(png|jpe?g|webp)$/i.test(asset.name || "");
  return imageLike ? asset : null;
}

function updateThreeDProjectFilter() {
  const current = els.threeDProjectFilter.value;
  els.threeDProjectFilter.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部项目";
  els.threeDProjectFilter.append(all);
  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    els.threeDProjectFilter.append(option);
  }
  if (state.projects.some((item) => item.id === current)) els.threeDProjectFilter.value = current;
}

function fillThreeDAssetForm() {
  const asset = selectedThreeDAsset();
  if (!asset) {
    els.threeDAssetPath.value = "";
    els.threeDTargetName.value = "";
    els.threeDAssetHint.textContent = state.selectedAsset ? "当前素材不是可用参考图，请选择 PNG、JPG 或 WEBP。" : "请先选中一张参考图。";
    els.threeDCreateTask.disabled = true;
    return;
  }
  els.threeDAssetPath.value = absolutePath(asset);
  els.threeDTargetName.value = (asset.name || "").replace(/\.[^.]+$/, "");
  els.threeDAssetHint.textContent = `将绑定到 ${asset.projectName || state.projects.find((item) => item.id === asset.projectId)?.name || "当前项目"} · ${asset.caseRelPath || asset.relPath}`;
  els.threeDCreateTask.disabled = false;
}

function updateThreeDOverview() {
  const counts = state.threeDStatus?.counts || {};
  els.threeDTotalCount.textContent = counts.total || 0;
  els.threeDActiveCount.textContent = counts.active || 0;
  els.threeDAttentionCount.textContent = counts.needsAttention || 0;
  els.threeDCompletedCount.textContent = counts.completed || 0;
  const skill = state.threeDStatus?.skill;
  els.threeDSkillState.classList.toggle("is-ready", Boolean(skill?.ready));
  els.threeDSkillState.textContent = skill?.ready
    ? `img2threejs v${skill.version || "已安装"} · 分阶段质量闸门可用`
    : "img2threejs 未完整安装，暂时不能创建任务";
  els.threeDCreateTask.disabled = !skill?.ready || !selectedThreeDAsset();
}

function renderThreeDTasks() {
  els.threeDTaskList.replaceChildren();
  if (!state.threeDTasks.length) {
    const empty = document.createElement("div");
    empty.className = "three-d-task-empty";
    empty.textContent = "还没有 3D 重建任务。选择一张参考图，从上方发起第一条。";
    els.threeDTaskList.append(empty);
    return;
  }

  for (const task of state.threeDTasks) {
    const card = document.createElement("article");
    card.className = "three-d-task-card";
    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "three-d-task-title";
    title.textContent = task.targetName;
    const meta = document.createElement("p");
    meta.className = "three-d-task-meta";
    meta.textContent = `${task.projectName} · ${task.intendedUseLabel} · ${task.complexity}\n${task.assetRelPath}`;
    info.append(title, meta);

    const progress = document.createElement("div");
    const stageLabel = document.createElement("div");
    stageLabel.className = "three-d-stage-label";
    stageLabel.innerHTML = `<span>${threeDStageLabels[task.currentStage] || task.currentStage}</span><span>${task.status}</span>`;
    const track = document.createElement("div");
    track.className = "three-d-stage-track";
    for (const stage of task.stages || []) {
      const dot = document.createElement("span");
      dot.className = `three-d-stage-dot ${stage.status || "pending"}`;
      dot.title = `${threeDStageLabels[stage.name] || stage.name} · ${stage.status}`;
      track.append(dot);
    }
    progress.append(stageLabel, track);

    const actions = document.createElement("div");
    actions.className = "three-d-task-actions";
    actions.append(
      promptButton("复制启动指令", async () => {
        await navigator.clipboard.writeText(task.instruction || "");
        els.threeDCreateMessage.textContent = `已复制“${task.targetName}”的启动指令。`;
      }),
      promptButton("工作目录", async () => {
        await api(`/api/3d/tasks/${encodeURIComponent(task.id)}/open`, { method: "POST", body: "{}" });
      }),
      promptButton("检查进度", async () => {
        await api(`/api/3d/tasks/${encodeURIComponent(task.id)}/refresh`, { method: "POST", body: "{}" });
        await loadThreeDWorkbench();
      }),
      promptButton("移出列表", async () => {
        if (!window.confirm(`移出“${task.targetName}”？工作目录和文件会保留。`)) return;
        await api(`/api/3d/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
        await loadThreeDWorkbench();
      }, "danger-button")
    );
    card.append(info, progress, actions);
    els.threeDTaskList.append(card);
  }
}

async function loadThreeDWorkbench() {
  const params = new URLSearchParams();
  if (els.threeDProjectFilter.value) params.set("project", els.threeDProjectFilter.value);
  const [status, list] = await Promise.all([
    api("/api/3d/status"),
    api(`/api/3d/tasks?${params}`)
  ]);
  state.threeDStatus = status;
  state.threeDTasks = list.tasks || [];
  updateThreeDOverview();
  renderThreeDTasks();
}

async function openThreeDWorkbenchDialog() {
  updateThreeDProjectFilter();
  fillThreeDAssetForm();
  els.threeDWorkbenchDialog.showModal();
  await loadThreeDWorkbench();
}

async function createThreeDTask() {
  const asset = selectedThreeDAsset();
  if (!asset) throw new Error("先选择一张 PNG、JPG 或 WEBP 参考图");
  els.threeDCreateTask.disabled = true;
  els.threeDCreateMessage.textContent = "正在探测参考图并建立质量契约…";
  try {
    const option = els.threeDIntendedUse.selectedOptions[0];
    const data = await api("/api/3d/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: asset.projectId || state.selectedProject,
        assetPath: absolutePath(asset),
        targetName: els.threeDTargetName.value,
        subjectType: els.threeDSubjectType.value,
        intendedUse: els.threeDIntendedUse.value,
        intendedUseLabel: option?.textContent || els.threeDIntendedUse.value,
        complexity: els.threeDComplexity.value,
        notes: els.threeDNotes.value
      })
    });
    els.threeDCreateMessage.textContent = data.task.status === "ready-for-agent"
      ? "任务已建立：图片探测和预规格骨架完成，可复制启动指令继续建模。"
      : "任务已建立，但初始化需要处理；详情已记入任务。";
    els.threeDNotes.value = "";
    await loadThreeDWorkbench();
  } finally {
    updateThreeDOverview();
  }
}

function mjNode(tag, className, text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function renderMidjourneyCandidates() {
  const currentNames = new Set(state.midjourney.candidates.map((item) => item.name));
  for (const name of state.midjourney.selected) if (!currentNames.has(name)) state.midjourney.selected.delete(name);
  els.midjourneyCandidateGrid.replaceChildren();
  els.midjourneyCandidateCount.textContent = `${state.midjourney.candidates.length} 张可收录`;
  els.midjourneySelectedCount.textContent = `${state.midjourney.selected.size} 张已选`;
  els.importMidjourney.disabled = !state.midjourney.selected.size;
  if (!state.midjourney.candidates.length) {
    els.midjourneyCandidateGrid.append(mjNode("div", "midjourney-empty", "下载文件夹里暂时没有可识别的 MJ 图片。普通截图和其他下载不会出现在这里。"));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of state.midjourney.candidates) {
    const card = mjNode("button", `midjourney-candidate${state.midjourney.selected.has(item.name) ? " is-selected" : ""}`);
    card.type = "button";
    card.dataset.name = item.name;
    card.setAttribute("aria-pressed", String(state.midjourney.selected.has(item.name)));
    card.title = item.name;
    const image = document.createElement("img");
    image.src = item.previewUrl;
    image.alt = item.label;
    image.loading = "lazy";
    image.decoding = "async";
    const check = mjNode("span", "midjourney-candidate-check", "✓");
    check.setAttribute("aria-hidden", "true");
    const copy = mjNode("span", "midjourney-candidate-copy");
    copy.append(mjNode("strong", "", item.label));
    const chips = mjNode("span", "midjourney-parameter-chips");
    if (item.aspect) chips.append(mjNode("span", "", item.aspect));
    for (const code of item.profiles.slice(0, 3)) chips.append(mjNode("span", "", `P ${code}`));
    if (item.parameters.stylize || item.parameters.s) chips.append(mjNode("span", "", `S ${item.parameters.stylize || item.parameters.s}`));
    if (item.parameters.sref) chips.append(mjNode("span", "", `SREF ${item.parameters.sref}`));
    if (item.parameters.seed) chips.append(mjNode("span", "", `Seed ${item.parameters.seed}`));
    if (!chips.children.length) chips.append(mjNode("span", "", "参数待补"));
    copy.append(chips, mjNode("small", "", `${formatSize(item.size)} · ${new Date(item.modifiedAt).toLocaleDateString("zh-CN")}`));
    card.append(image, check, copy);
    fragment.append(card);
  }
  els.midjourneyCandidateGrid.append(fragment);
}

function startMidjourneyProfile(profile = {}) {
  state.midjourney.editingId = profile.id || "";
  els.midjourneyProfileId.value = profile.id || "";
  els.midjourneyProfileCode.value = profile.code || "";
  els.midjourneyProfileName.value = profile.name || "";
  els.midjourneyProfileRating.value = String(profile.rating || 0);
  els.midjourneyProfileSource.value = profile.source || "";
  els.midjourneyProfileTags.value = (profile.tags || []).join("、");
  els.midjourneyProfileNote.value = profile.note || "";
  els.midjourneyProfileForm.hidden = false;
  els.midjourneyProfileCode.focus({ preventScroll: true });
}

function renderMidjourneyProfiles() {
  els.midjourneyProfileList.replaceChildren();
  els.midjourneyProfileCount.textContent = `${state.midjourney.profiles.length} 个收藏`;
  const savedCodes = new Set(state.midjourney.profiles.map((item) => item.code.toLowerCase()));
  const items = [
    ...state.midjourney.profiles.map((item) => ({ ...item, saved: true })),
    ...state.midjourney.observedProfiles.filter((item) => !savedCodes.has(item.code.toLowerCase())).map((item) => ({ ...item, name: "图片中识别到", saved: false }))
  ];
  if (!items.length) {
    els.midjourneyProfileList.append(mjNode("div", "midjourney-empty", "收录 MJ 图片后会自动识别 --profile；也可以直接收藏常用 P值。"));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = mjNode("article", `midjourney-profile-card${item.saved ? "" : " midjourney-observed"}`);
    const info = mjNode("div", "");
    info.append(mjNode("h3", "", item.name || "未命名风格"), mjNode("div", "midjourney-profile-code", `--profile ${item.code}`));
    if (item.saved && item.rating) info.append(mjNode("small", "", "★".repeat(item.rating)));
    const actions = mjNode("div", "midjourney-profile-card-actions");
    const copy = mjNode("button", "", "复制");
    copy.type = "button";
    copy.dataset.mjCopy = item.code;
    actions.append(copy);
    const edit = mjNode("button", "", item.saved ? "编辑" : "收藏");
    edit.type = "button";
    edit.dataset.mjEdit = item.saved ? item.id : `code:${item.code}`;
    actions.append(edit);
    if (item.saved) {
      const remove = mjNode("button", "", "删除");
      remove.type = "button";
      remove.dataset.mjDelete = item.id;
      actions.append(remove);
    }
    card.append(info, actions);
    const details = [item.tags?.length ? item.tags.join(" · ") : "", item.note || "", item.count ? `${item.count} 张图片使用` : ""].filter(Boolean).join(" · ");
    if (details) card.append(mjNode("p", "midjourney-profile-note", details));
    fragment.append(card);
  }
  els.midjourneyProfileList.append(fragment);
}

function renderMidjourney() {
  renderMidjourneyCandidates();
  renderMidjourneyProfiles();
}

async function loadMidjourney() {
  els.midjourneyCandidateCount.textContent = "正在读取";
  const data = await api("/api/midjourney");
  state.midjourney = { ...state.midjourney, ...data };
  renderMidjourney();
}

async function openMidjourneyWorkspace() {
  els.midjourneyTargetProject.replaceChildren();
  for (const project of state.projects.filter((item) => item.exists && item.id !== "ai-reference-library")) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    els.midjourneyTargetProject.append(option);
  }
  const preferred = [state.codexScope === "shared" ? "mj-library" : state.codexBoundProject, state.selectedProject, "pending-review"].find((id) => id !== "ai-reference-library" && state.projects.some((item) => item.id === id && item.exists));
  if (preferred) els.midjourneyTargetProject.value = preferred;
  if (!els.midjourneyDialog.open) els.midjourneyDialog.showModal();
  await loadMidjourney();
}

async function importSelectedMidjourney() {
  const names = [...state.midjourney.selected];
  if (!names.length) return;
  const projectId = els.midjourneyTargetProject.value;
  els.importMidjourney.disabled = true;
  els.importMidjourney.textContent = "归档中…";
  try {
    const data = await api("/api/midjourney/import", {
      method: "POST",
      body: JSON.stringify({
        names,
        projectId,
        targetDirectory: projectId === state.selectedProject ? state.selectedCase : ""
      })
    });
    state.midjourney.selected.clear();
    await loadMidjourney();
    showToast(projectId === "mj-library"
      ? `已将 ${data.imported.length} 张 MJ 图片归档到「MJ 素材库」，按 P 组合分类；无 P 值的单独收纳`
      : `已将 ${data.imported.length} 张 MJ 图片移动到「${codexProjectName(projectId)} / ${data.targetRelativePath}」`);
  } finally {
    els.importMidjourney.textContent = "移动归档";
    renderMidjourneyCandidates();
  }
}

async function saveMidjourneyProfile(event) {
  event.preventDefault();
  await api("/api/midjourney/profiles", {
    method: "POST",
    body: JSON.stringify({
      id: els.midjourneyProfileId.value,
      code: els.midjourneyProfileCode.value,
      name: els.midjourneyProfileName.value,
      rating: els.midjourneyProfileRating.value,
      source: els.midjourneyProfileSource.value,
      tags: els.midjourneyProfileTags.value,
      note: els.midjourneyProfileNote.value
    })
  });
  els.midjourneyProfileForm.hidden = true;
  await loadMidjourney();
  showToast("P值已收藏");
}

function wireFilters() {
  document.querySelectorAll("[data-open-midjourney]").forEach((button) => {
    button.addEventListener("click", () => openMidjourneyWorkspace().catch(showError));
  });
  els.midjourneyButton?.addEventListener("click", () => openMidjourneyWorkspace().catch(showError));
  els.refreshMidjourney?.addEventListener("click", () => loadMidjourney().catch(showError));
  els.importMidjourney?.addEventListener("click", () => importSelectedMidjourney().catch(showError));
  els.midjourneyCandidateGrid?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-name]");
    if (!card) return;
    if (state.midjourney.selected.has(card.dataset.name)) state.midjourney.selected.delete(card.dataset.name);
    else state.midjourney.selected.add(card.dataset.name);
    renderMidjourneyCandidates();
  });
  els.newMidjourneyProfile?.addEventListener("click", () => startMidjourneyProfile());
  els.cancelMidjourneyProfile?.addEventListener("click", () => { els.midjourneyProfileForm.hidden = true; });
  els.midjourneyProfileForm?.addEventListener("submit", (event) => saveMidjourneyProfile(event).catch(showError));
  els.midjourneyProfileList?.addEventListener("click", async (event) => {
    try {
      const copy = event.target.closest("[data-mj-copy]");
      if (copy) {
        await navigator.clipboard.writeText(`--profile ${copy.dataset.mjCopy}`);
        showToast("已复制 P值参数");
        return;
      }
      const edit = event.target.closest("[data-mj-edit]");
      if (edit) {
        if (edit.dataset.mjEdit.startsWith("code:")) startMidjourneyProfile({ code: edit.dataset.mjEdit.slice(5) });
        else startMidjourneyProfile(state.midjourney.profiles.find((item) => item.id === edit.dataset.mjEdit) || {});
        return;
      }
      const remove = event.target.closest("[data-mj-delete]");
      if (remove && window.confirm("只删除这条 P值收藏，已经归档的图片不会被删除。继续吗？")) {
        await api(`/api/midjourney/profiles/${encodeURIComponent(remove.dataset.mjDelete)}`, { method: "DELETE" });
        await loadMidjourney();
      }
    } catch (error) {
      showError(error);
    }
  });

  els.categoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    setCategoryFilter(button.dataset.category);
    render();
  });

  els.smartGroupFilters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-smart-group]");
    if (!button) return;
    state.smartGroupFilter = button.dataset.smartGroup;
    els.smartGroupFilters.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    render();
  });

  els.statusFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-status]");
    if (!button) return;
    state.statusFilter = button.dataset.status;
    els.statusFilters.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    render();
  });

  els.typeFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-type]");
    if (!button) return;
    state.typeFilter = button.dataset.type;
    els.typeFilters.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    render();
  });

  els.embeddedCategoryFilter?.addEventListener("change", () => {
    setCategoryFilter(els.embeddedCategoryFilter.value);
    render();
  });
  els.embeddedSmartGroupFilter?.addEventListener("change", () => {
    state.smartGroupFilter = els.embeddedSmartGroupFilter.value;
    els.smartGroupFilters?.querySelectorAll("[data-smart-group]").forEach((button) => {
      button.classList.toggle("active", button.dataset.smartGroup === state.smartGroupFilter);
    });
    syncEmbeddedFilterControls();
    render();
  });
  els.embeddedStatusFilter?.addEventListener("change", () => {
    state.statusFilter = els.embeddedStatusFilter.value;
    els.statusFilters.querySelectorAll("[data-status]").forEach((button) => {
      button.classList.toggle("active", button.dataset.status === state.statusFilter);
    });
    syncEmbeddedFilterControls();
    render();
  });
  els.embeddedTypeFilter?.addEventListener("change", () => {
    state.typeFilter = els.embeddedTypeFilter.value;
    els.typeFilters.querySelectorAll("[data-type]").forEach((button) => {
      button.classList.toggle("active", button.dataset.type === state.typeFilter);
    });
    syncEmbeddedFilterControls();
    render();
  });
  els.clearEmbeddedFilters?.addEventListener("click", () => {
    clearAssetDiscoveryFilters();
  });

  els.searchInput.addEventListener("input", () => {
    clearTimeout(state.assetSearchTimer);
    state.assetSearchTimer = setTimeout(() => {
      state.query = els.searchInput.value;
      render();
    }, 100);
  });
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !els.searchInput.value) return;
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(state.assetSearchTimer);
    els.searchInput.value = "";
    state.query = "";
    render();
  });

  els.sortSelect.addEventListener("change", () => {
    state.sort = els.sortSelect.value;
    render();
  });

  els.refreshButton.addEventListener("click", () => performManualRefresh().catch(showError));
  els.newFolderButton?.addEventListener("click", openNewFolderDialog);
  els.newFolderForm?.addEventListener("submit", (event) => createFolderInCurrentLevel(event).catch(showError));
  els.newFolderDialog?.querySelectorAll("[data-new-folder-cancel]").forEach((button) => {
    button.addEventListener("click", closeNewFolderDialog);
  });
  els.newFolderDialog?.addEventListener("close", () => els.newFolderButton?.focus());
  els.renameFolderForm?.addEventListener("submit", (event) => renameSelectedFolder(event).catch(showError));
  els.renameFolderDialog?.querySelectorAll("[data-rename-folder-cancel]").forEach((button) => {
    button.addEventListener("click", closeRenameFolderDialog);
  });
  els.renameFolderDialog?.addEventListener("close", () => {
    state.renamingFolder = null;
    const returnFocus = state.renameFolderReturnFocus;
    state.renameFolderReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  });
  els.selectionModeButton.addEventListener("click", () => {
    if (state.multiSelect) exitSelectionMode();
    else enterSelectionMode();
  });
  els.organizeProjectButton?.addEventListener("click", () => organizeCurrentProject().catch(showError));
  els.clearAssetSelection.addEventListener("click", exitSelectionMode);
  els.selectVisibleAssets.addEventListener("click", () => selectAssetGroup(filteredAssets()));
  els.batchUseInCodex?.addEventListener("click", sendSelectedAssetsToCodex);
  els.batchTaskAction?.addEventListener("click", () => routeSelectedAssetsForCurrentTask().catch(showError));
  els.batchDiscardAssets?.addEventListener("click", () => discardSelectedAssets().catch(showError));
  els.batchCompareAssets?.addEventListener("click", openComparePanel);
  els.batchCurateAssets?.addEventListener("click", () => openBatchMoveDialog({ targetProjectId: "ai-reference-library" }).catch(showError));
  els.closeComparePanel?.addEventListener("click", () => {
    state.compareMode = false;
    renderComparePanel();
  });
  els.batchStatusSelect.addEventListener("change", () => applyBatchStatus(els.batchStatusSelect.value));
  els.batchMoveAssets.addEventListener("click", () => {
    els.batchMorePopover?.hidePopover?.();
    openBatchMoveDialog().catch(showError);
  });
  els.batchDeleteAssets.addEventListener("click", () => {
    els.batchMorePopover?.hidePopover?.();
    openBatchDeleteDialog();
  });
  els.batchMorePopover?.addEventListener("beforetoggle", (event) => {
    if (event.newState === "open") positionBatchMorePopover();
  });
  els.confirmBatchDelete.addEventListener("click", confirmBatchDelete);
  els.cancelBatchDelete.addEventListener("click", () => els.batchDeleteDialog.close());
  els.addProjectButton.addEventListener("click", addProject);
  els.promptLibraryButton.addEventListener("click", () => openPromptLibraryDialog().catch(showError));
  els.promptCancelEdit.addEventListener("click", resetPromptEditor);
  els.promptKind.addEventListener("change", updatePromptKindUi);
  els.promptSaveItem.addEventListener("click", () => savePromptItem().catch((error) => {
    els.promptSaveMessage.textContent = `保存失败：${error.message}`;
  }));
  els.promptRefresh.addEventListener("click", () => loadPromptLibrary().catch(showError));
  els.promptCompile.addEventListener("click", () => compilePromptLibrary().catch(showError));
  els.promptKindFilter.addEventListener("change", () => loadPromptLibrary().catch(showError));
  els.promptCategoryFilter.addEventListener("change", () => loadPromptLibrary().catch(showError));
  els.promptSearch.addEventListener("input", () => {
    clearTimeout(state.promptSearchTimer);
    state.promptSearchTimer = setTimeout(() => loadPromptLibrary().catch(showError), 180);
  });
  els.promptLibraryDialog.addEventListener("close", resetPromptEditor);
  els.threeDWorkbenchButton.addEventListener("click", () => openThreeDWorkbenchDialog().catch(showError));
  els.threeDCreateTask.addEventListener("click", () => createThreeDTask().catch((error) => {
    els.threeDCreateMessage.textContent = `创建失败：${error.message}`;
    updateThreeDOverview();
  }));
  els.threeDRefresh.addEventListener("click", () => loadThreeDWorkbench().catch(showError));
  els.threeDProjectFilter.addEventListener("change", () => loadThreeDWorkbench().catch(showError));
  els.closeDetail.addEventListener("click", () => {
    animateDockLayout(false, () => {
      state.selectedAsset = null;
      updateAssetSelection();
      renderDetail();
    });
    flushDeferredRefresh().catch((error) => {
      els.refreshStatus.textContent = `刷新失败：${error.message}`;
    });
  });
  els.quickMoveAsset.addEventListener("click", () => openMoveAssetDialog());
  els.moveTargetProject.addEventListener("change", () => {
    els.moveCustomFolder.value = "";
    loadMoveTargetFolders("").catch(showError);
  });
  els.autoOrganizeMoveAsset.addEventListener("click", () => autoOrganizeMoveAssets().catch(showError));
  els.confirmMoveAsset.addEventListener("click", () => confirmMoveAsset().catch(showError));
  els.cancelMoveAsset.addEventListener("click", () => els.moveAssetDialog.close());
  els.moveAssetDialog.addEventListener("close", () => {
    state.moveFolderLoadGeneration += 1;
    state.movingAsset = null;
    state.movingAssets = [];
    els.moveTargetNameField.hidden = false;
  });
  document.addEventListener("keydown", (event) => {
    const tag = event.target?.tagName?.toLowerCase();
    const typing = ["input", "textarea", "select"].includes(tag) || event.target?.isContentEditable;
    const searchShortcut = (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) || (event.key === "/" && !typing);
    if (searchShortcut) {
      event.preventDefault();
      els.searchInput.focus();
      els.searchInput.select();
      return;
    }
    if (event.key === "Escape") {
      document.querySelector("#toolMenu")?.removeAttribute("open");
      els.embeddedFilterMenu?.removeAttribute("open");
      els.codexBindingMenu?.removeAttribute("open");
      const modalOpen = document.querySelector("dialog[open]");
      if (!modalOpen && state.compareMode) {
        state.compareMode = false;
        renderComparePanel();
        return;
      }
      if (!modalOpen && state.multiSelect) exitSelectionMode();
    }
    if (state.multiSelect && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !typing) {
      event.preventDefault();
      selectAssetGroup(filteredAssets());
      return;
    }
    if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "c" && state.multiSelect) {
      event.preventDefault();
      openComparePanel();
      return;
    }
    if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "a" && state.codexEmbedded) {
      const chosen = selectedAssets();
      if (chosen.length) {
        event.preventDefault();
        sendSelectedAssetsToCodex();
        return;
      }
      if (state.selectedAsset && !state.selectedAsset.isGroup) {
        event.preventDefault();
        sendAssetToCodex(state.selectedAsset);
        return;
      }
    }
    if (event.key.toLowerCase() !== "m" || typing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!state.selectedAsset || state.selectedAsset.isGroup || els.moveAssetDialog.open) return;
    event.preventDefault();
    openMoveAssetDialog();
  });

  const toolMenu = document.querySelector("#toolMenu");
  toolMenu?.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => toolMenu.removeAttribute("open"));
  });
  document.addEventListener("pointerdown", (event) => {
    if (toolMenu?.open && !toolMenu.contains(event.target)) toolMenu.removeAttribute("open");
  });

  els.autoRefresh.addEventListener("change", configureAutoRefresh);
  els.compactReverse.addEventListener("change", () => {
    state.compactReverse = els.compactReverse.checked;
    render();
  });
  els.workflowEnabled.addEventListener("change", async () => {
    state.configEnabled = els.workflowEnabled.checked;
    await api("/api/toggle-enabled", {
      method: "POST",
      body: JSON.stringify({ enabled: state.configEnabled })
    });
    els.refreshStatus.textContent = state.configEnabled ? "生产任务启用资产工作台" : "简单模式：不强制登记资产";
  });

  els.generationButton.addEventListener("click", () => openGenerationDialog().catch(showError));
  els.rhythmControlButton.addEventListener("click", () => openRhythmControlDialog().catch(showError));
  els.refreshRhythmTracks.addEventListener("click", () => loadRhythmTracks(els.rhythmProject.value).catch(showError));
  els.createRhythmTrack.addEventListener("click", () => createRhythmTrack().catch((error) => {
    els.rhythmMessage.textContent = `生成失败：${error.message}`;
    showError(error);
  }));
  els.rhythmProject.addEventListener("change", () => {
    els.rhythmProfile.value = "";
    renderRhythmSelectors();
    loadRhythmTracks(els.rhythmProject.value).catch(showError);
  });
  els.rhythmDuration.addEventListener("input", () => {
    if (/^控制轨测试_.*秒$/.test(els.rhythmName.value.trim())) {
      els.rhythmName.value = `控制轨测试_${els.rhythmDuration.value || 0}秒`;
    }
  });
  els.refreshGenerationTickets.addEventListener("click", () => loadGenerationTickets().catch(showError));
  els.createGenerationTicket.addEventListener("click", () => createGenerationTicket().catch(showError));
  els.createAndArmGeneration.addEventListener("click", () => createGenerationTicket({ arm: true }).catch(showError));
  els.generationProfile.addEventListener("change", () => {
    const profile = state.automation?.routing?.profiles?.find((item) => item.id === els.generationProfile.value);
    if (profile) {
      els.generationProject.value = profile.projectId;
      if (!els.generationEpisode.value && profile.id.startsWith("episode-")) {
        els.generationEpisode.value = profile.name.replace(/^剧集[·・]?/, "");
      }
      loadRhythmTracks(els.generationProject.value).catch(showError);
    }
  });
  els.generationProject.addEventListener("change", () => loadRhythmTracks(els.generationProject.value).catch(showError));
  els.generationRhythmTrack.addEventListener("change", updateGenerationRhythmHint);
  els.generationKind.addEventListener("change", () => {
    els.generationGenerator.value = els.generationKind.value === "video" ? "tapnow" : "codex-image";
  });

  els.automationButton.addEventListener("click", openAutomationDialog);
  els.governanceButton?.addEventListener("click", () => openGovernanceDialog().catch(showError));
  els.refreshGovernance?.addEventListener("click", () => loadGovernanceStatus().catch((error) => {
    els.governanceMessage.textContent = `刷新失败：${error.message}`;
  }));
  els.createGovernanceSnapshot?.addEventListener("click", () => createGovernanceSnapshot().catch(showError));
  els.clearGovernanceCache?.addEventListener("click", () => clearGovernanceCache().catch(showError));
  els.saveAutomation.addEventListener("click", () => saveAutomationSettings().catch((error) => showAutomationMessage("保存失败", error.message, true)));
  els.previewOrganizer.addEventListener("click", () => runAutomationAction("/api/automation/organizer/preview", "归档预览"));
  els.runOrganizer.addEventListener("click", () => runAutomationAction("/api/automation/organizer/run", "立即归档"));
  els.previewCleanup.addEventListener("click", () => runAutomationAction("/api/automation/cleanup/preview", "清理预览"));
  els.runCleanup.addEventListener("click", () => runAutomationAction("/api/automation/cleanup/run", "本轮清理", {
    saveFirst: true,
    confirmRun: !els.cleanupDryRun.checked
  }));
  els.useCurrentCase.addEventListener("click", () => {
    if (!state.selectedCase) {
      showAutomationMessage("没有当前案例", "请先在左侧选择一个案例。");
      return;
    }
    els.inboxProject.value = state.selectedProject;
    els.inboxBasePath.value = state.selectedCase;
  });
  els.activeProfile.addEventListener("change", async () => {
    if (!els.activeProfile.value) return;
    try {
      const data = await api("/api/automation/active-profile", {
        method: "POST",
        body: JSON.stringify({ profileId: els.activeProfile.value })
      });
      state.automation = data.automation;
      renderAutomationForm();
      showAutomationMessage("当前项目已切换", `仅旧版全量下载整理会使用“${data.profile.name}”；生成任务仍按当前任务自动匹配。`);
    } catch (error) {
      showAutomationMessage("切换失败", error.message, true);
    }
  });
  els.inboxSourcePath.addEventListener("change", () => {
    if (!els.quarantinePath.value.trim() || els.quarantinePath.value.includes(".asset-browser-quarantine")) {
      const separator = els.inboxSourcePath.value.includes("\\") ? "\\" : "/";
      els.quarantinePath.value = `${els.inboxSourcePath.value.replace(/[\\/]+$/, "")}${separator}.asset-browser-quarantine`;
    }
  });
}

function configureAutoRefresh() {
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
  if (els.autoRefresh.checked) {
    state.autoRefreshTimer = setInterval(() => {
      requestBackgroundRefresh().catch((error) => {
        els.refreshStatus.textContent = `刷新失败：${error.message}`;
      });
    }, 15000);
  }
}

function configureLiveEvents() {
  if (!window.EventSource) return;
  const source = new EventSource("/api/events");
  source.addEventListener("asset-change", async () => {
    await requestBackgroundRefresh({ reloadProjects: true, reloadCases: true });
  });
  source.addEventListener("project-change", async () => {
    await requestBackgroundRefresh({ reloadProjects: true, reloadCases: true });
  });
  source.addEventListener("config-change", async () => {
    await loadConfig();
  });
  source.addEventListener("automation-change", async () => {
    await requestBackgroundRefresh();
    if (els.automationDialog.open) {
      const status = await api("/api/automation/status");
      if (status.organizerPreview) showAutomationResult("当前收件箱", status.organizerPreview);
    }
  });
  source.addEventListener("generation-change", async () => {
    if (els.generationDialog.open) await loadGenerationTickets();
    await requestBackgroundRefresh();
  });
  source.addEventListener("rhythm-control-change", async () => {
    const projectId = els.rhythmControlDialog.open ? els.rhythmProject.value : els.generationProject.value;
    if (projectId) await loadRhythmTracks(projectId);
    await requestBackgroundRefresh({ reloadCases: true });
  });
  source.addEventListener("prompt-library-change", async () => {
    if (els.promptLibraryDialog.open) await loadPromptLibrary();
  });
  source.addEventListener("three-d-change", async () => {
    if (els.threeDWorkbenchDialog.open) await loadThreeDWorkbench();
    await requestBackgroundRefresh({ reloadCases: true });
  });
  source.addEventListener("midjourney-change", async () => {
    if (els.midjourneyDialog?.open) await loadMidjourney();
  });
  source.addEventListener("workspace-governance-change", async () => {
    if (els.governanceDialog?.open) await loadGovernanceStatus();
  });
  source.addEventListener("connected", () => {
    els.refreshStatus.textContent = "实时监听已连接";
  });
  source.onerror = () => {
    els.refreshStatus.textContent = "实时监听断开，保留自动刷新";
  };
}

wireSidebarLayout();
wireProjectReorder();
wireFilters();
wireCodexIntegration();
await loadConfig();
await loadProjects();
await loadCases();
setCategoryFilter(state.categoryFilter);
await loadAssets();
configureAutoRefresh();
configureLiveEvents();
