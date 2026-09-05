import { createServer } from "node:http";
import { createReadStream, promises as fs, readFileSync, watch } from "node:fs";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DownloadAutomation, normalizeAutomation } from "./download-automation.js";
import { GenerationPipeline } from "./generation-pipeline.js";
import { ExactDuplicateCleaner, normalizeDeduplication } from "./duplicate-cleaner.js";
import { PromptLibrary } from "./prompt-library.js";
import { ThreeDWorkbench } from "./three-d-workbench.js";
import { createProjectFolder, renameProjectFolder } from "./folder-operations.js";
import { WorkspaceGovernance } from "./workspace-governance.js";
import { MidjourneyWorkspace } from "./midjourney-workspace.js";
import { resolveCodexWorkspace, collectWorkspaceFiles, workspaceFolders, fileType, previewFile } from "./codex-workspace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(__dirname, "public");
const configPath = path.resolve(process.env.ASSET_BROWSER_CONFIG || path.join(__dirname, "asset-browser.config.json"));
const ledgerPath = path.resolve(process.env.ASSET_BROWSER_LEDGER || path.join(__dirname, ".asset-download-ledger.json"));
const generationRegistryPath = path.resolve(process.env.GENERATION_TICKETS || path.join(__dirname, ".generation-tickets.json"));
const generationBindingsPath = path.resolve(process.env.GENERATION_THREAD_BINDINGS || path.join(__dirname, ".thread-project-bindings.json"));
const duplicateLedgerPath = path.resolve(process.env.DUPLICATE_CLEANUP_LEDGER || path.join(__dirname, ".duplicate-cleanup-ledger.json"));
const duplicateQuarantinePath = path.resolve(process.env.DUPLICATE_QUARANTINE || path.join(__dirname, "duplicate-quarantine"));
const rhythmControlRegistryPath = path.resolve(process.env.RHYTHM_CONTROL_REGISTRY || path.join(__dirname, ".rhythm-control-tracks.json"));
const promptLibraryRoot = path.resolve(process.env.PROMPT_LIBRARY_ROOT || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "AssetBrowser", "prompt-library"));
const threeDRegistryPath = path.resolve(process.env.THREE_D_TASKS || path.join(__dirname, ".three-d-reconstruction-tasks.json"));
const actionTrashRoot = path.resolve(process.env.ASSET_ACTION_TRASH || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AssetBrowser", "action-trash"));
const img2threejsSkillRoot = path.resolve(process.env.IMG2THREEJS_SKILL_ROOT || path.join(os.homedir(), ".codex", "skills", "img2threejs"));
const rhythmControlScriptPath = path.join(__dirname, "rhythm-control-track.py");
const audioSkillRoot = path.resolve(process.env.SCORE_MIX_SKILL_ROOT || path.join(os.homedir(), ".codex", "skills", "score-and-mix-picture"));
const aceStepLauncher = process.env.ACESTEP_LAUNCHER ? path.resolve(process.env.ACESTEP_LAUNCHER) : "";
const port = Number(process.env.PORT || 5177);
const apiTokenPath = path.resolve(process.env.ASSET_BROWSER_TOKEN_FILE || path.join(__dirname, ".api-token"));
const governanceRoot = path.resolve(process.env.CODEX_WORKSPACE_GOVERNANCE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CodexWorkspaceGovernance"));
const midjourneyRegistryPath = path.resolve(process.env.MIDJOURNEY_WORKSPACE_REGISTRY || path.join(__dirname, ".midjourney-workspace.json"));
const midjourneyDownloadsPath = path.resolve(process.env.MIDJOURNEY_DOWNLOADS || path.join(os.homedir(), "Downloads"));
const apiToken = String(process.env.ASSET_BROWSER_API_TOKEN || readFileSync(apiTokenPath, "utf8")).trim();
if (apiToken.length < 32) throw new Error(`AssetBrowser API token is missing or invalid: ${apiTokenPath}`);

const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const videoExts = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const audioExts = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus"]);
const sseClients = new Set();
let watchTimer = null;
const watcherHandles = new Map();
const downloadAutomation = new DownloadAutomation({ ledgerPath });
const generationPipeline = new GenerationPipeline({
  registryPath: generationRegistryPath,
  bindingsPath: generationBindingsPath
});
const duplicateCleaner = new ExactDuplicateCleaner({ ledgerPath: duplicateLedgerPath });
const promptLibrary = new PromptLibrary({ root: promptLibraryRoot });
const threeDWorkbench = new ThreeDWorkbench({ registryPath: threeDRegistryPath, skillRoot: img2threejsSkillRoot });
const midjourneyWorkspace = new MidjourneyWorkspace({ downloadsPath: midjourneyDownloadsPath, registryPath: midjourneyRegistryPath });
const workspaceGovernance = new WorkspaceGovernance({
  root: governanceRoot,
  stateFiles: [
    { id: "asset-config", label: "资产控制台配置", component: "asset-console", path: configPath },
    { id: "download-ledger", label: "生成下载记录", component: "generation", path: ledgerPath },
    { id: "generation-tickets", label: "生成任务记录", component: "generation", path: generationRegistryPath },
    { id: "thread-bindings", label: "任务与项目绑定", component: "task-context", path: generationBindingsPath },
    { id: "duplicate-ledger", label: "重复项处理记录", component: "asset-console", path: duplicateLedgerPath },
    { id: "rhythm-tracks", label: "节奏控制记录", component: "workbench", path: rhythmControlRegistryPath },
    { id: "three-d-tasks", label: "3D 工作台记录", component: "workbench", path: threeDRegistryPath },
    { id: "midjourney-workspace", label: "Midjourney 工作区记录", component: "workbench", path: midjourneyRegistryPath }
  ],
  moduleFiles: [
    { id: "asset-server", label: "资产服务", component: "backend", path: path.join(__dirname, "server.js") },
    { id: "workspace-governance", label: "存储与恢复底座", component: "backend", path: path.join(__dirname, "workspace-governance.js") },
    { id: "download-automation", label: "下载归属与整理", component: "backend", path: path.join(__dirname, "download-automation.js") },
    { id: "generation-pipeline", label: "生成资产流水线", component: "backend", path: path.join(__dirname, "generation-pipeline.js") },
    { id: "midjourney-workspace", label: "Midjourney 工作区", component: "backend", path: path.join(__dirname, "midjourney-workspace.js") },
    { id: "asset-console-ui", label: "资产控制台界面", component: "frontend", path: path.join(publicRoot, "app.js") },
    { id: "asset-console-layout", label: "资产控制台结构", component: "frontend", path: path.join(publicRoot, "index.html") },
    { id: "asset-console-style", label: "资产控制台样式", component: "frontend", path: path.join(publicRoot, "ui-v3.css") }
  ]
});
let automationBusy = false;
let configUpdateQueue = Promise.resolve();
let mutationSafetyPromise = null;
let lastMutationSafetyAt = 0;

async function ensureMutationSafetyPoint() {
  const now = Date.now();
  if (now - lastMutationSafetyAt < 10 * 60 * 1000) return;
  if (mutationSafetyPromise) return mutationSafetyPromise;
  mutationSafetyPromise = workspaceGovernance.createSnapshot({
    label: `自动安全点 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    reason: "pre-mutation",
    includeModules: false
  }).then(() => {
    lastMutationSafetyAt = Date.now();
  }).finally(() => {
    mutationSafetyPromise = null;
  });
  return mutationSafetyPromise;
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, text, status = 200) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function mutationSummary(body) {
  if (!body || typeof body !== "object") return {};
  const summary = {};
  for (const key of ["projectId", "sourceProjectId", "targetProjectId", "caseId", "assetId", "sourcePath", "targetDirectory", "path", "parentPath", "name", "threadId", "profileId", "ticketId"]) {
    if (typeof body[key] === "string" && body[key]) summary[key] = body[key].slice(0, 500);
  }
  if (Array.isArray(body.items)) summary.itemCount = Math.min(body.items.length, 10000);
  if (Array.isArray(body.projectIds)) summary.projectCount = Math.min(body.projectIds.length, 10000);
  return summary;
}

function hasValidApiToken(req) {
  const supplied = String(req.headers["x-asset-console-token"] || "");
  const expected = Buffer.from(apiToken);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isAllowedLocalOrigin(req) {
  const origin = String(req.headers.origin || "");
  return !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function isProtectedLocalRoute(pathname) {
  return pathname.startsWith("/api/") || pathname === "/media" || pathname === "/download";
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".avif") return "image/avif";
  if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if ([".js", ".mjs", ".cjs"].includes(ext)) return "text/javascript; charset=utf-8";
  if (ext === ".woff") return "font/woff";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".ttf") return "font/ttf";
  if (ext === ".otf") return "font/otf";
  if (ext === ".wasm") return "application/wasm";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".ogg" || ext === ".oga") return "audio/ogg";
  if (ext === ".opus") return "audio/opus";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function safeResolve(root, requestedPath) {
  const decoded = decodeURIComponent(requestedPath || "");
  const absolute = path.resolve(root, decoded);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error("Path escapes project root");
  }
  return absolute;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeResolvePublic(requestedPath) {
  const withoutLeadingSlash = String(requestedPath || "").replace(/^\/+/, "");
  return safeResolve(publicRoot, withoutLeadingSlash || "index.html");
}

async function generatedRootFor(configuredPath) {
  return path.resolve(configuredPath || path.join(os.homedir(), "Documents", "Codex Assets", "generated"));
}

async function loadConfig() {
  try {
    const config = JSON.parse((await fs.readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
    const projects = (config.projects || []).map((project) => ({
      id: project.id,
      name: project.name || project.id,
      path: path.resolve(project.path),
      scanRoots: project.scanRoots?.length ? project.scanRoots : ["."]
    })).filter((project) => project.id && project.path);
    return {
      enabled: config.enabled !== false,
      projects,
      storage: { generatedRoot: await generatedRootFor(config.storage?.generatedRoot, projects) },
      automation: normalizeAutomation(config.automation),
      deduplication: normalizeDeduplication(config.deduplication, { defaultQuarantinePath: duplicateQuarantinePath })
    };
  } catch {
    return {
      enabled: true,
      projects: [],
      storage: { generatedRoot: await generatedRootFor("", []) },
      automation: normalizeAutomation(),
      deduplication: normalizeDeduplication({}, { defaultQuarantinePath: duplicateQuarantinePath })
    };
  }
}

async function saveConfig(config) {
  const normalized = {
    enabled: config.enabled !== false,
    projects: (config.projects || []).map((project) => ({
      id: project.id,
      name: project.name || project.id,
      path: path.resolve(project.path),
      scanRoots: project.scanRoots?.length ? project.scanRoots : ["."]
    })),
    storage: { generatedRoot: await generatedRootFor(config.storage?.generatedRoot, config.projects || []) },
    automation: normalizeAutomation(config.automation),
    deduplication: normalizeDeduplication(config.deduplication, { defaultQuarantinePath: duplicateQuarantinePath })
  };
  const tempPath = path.join(
    path.dirname(configPath),
    `.${path.basename(configPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(tempPath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
    await fs.rename(tempPath, configPath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
  return normalized;
}

function updateConfig(mutator) {
  const operation = configUpdateQueue.then(async () => {
    const config = await loadConfig();
    const result = await mutator(config);
    const saved = await saveConfig(config);
    return { saved, result };
  });
  configUpdateQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function slugify(input) {
  const base = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return base || `project-${Date.now()}`;
}

async function codexWorkspace(threadId) {
  const config = await loadConfig();
  return resolveCodexWorkspace(threadId, { projects: config.projects, bindings: await generationPipeline.listBindings() });
}

async function getProject(projectId) {
  if (String(projectId || "").startsWith("codex-thread:")) {
    const workspace = await codexWorkspace(projectId.slice("codex-thread:".length));
    if (!workspace.project || workspace.project.id !== projectId) throw new Error("当前任务项目已改变，请刷新资产列表");
    return workspace.project;
  }
  const config = await loadConfig();
  const project = config.projects.find((item) => item.id === projectId) || (!projectId ? config.projects[0] : null);
  if (!project) throw new Error("No configured project folders");
  return project;
}

async function getProjectStrict(projectId) {
  const config = await loadConfig();
  const project = config.projects.find((item) => item.id === projectId);
  if (!project) throw new Error(`项目不存在：${projectId || "未指定"}`);
  return project;
}

function safeResolveProject(project, requestedPath) {
  return safeResolve(project.path, requestedPath);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function cleanFileStem(value, fallback = "asset") {
  const stem = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return stem || fallback;
}

async function uniqueAssetPath(desiredPath) {
  const dir = path.dirname(desiredPath);
  const ext = path.extname(desiredPath);
  const stem = path.basename(desiredPath, ext);
  for (let index = 1; index < 10000; index += 1) {
    const suffix = index === 1 ? "" : `-${String(index).padStart(2, "0")}`;
    const candidate = path.join(dir, `${stem}${suffix}${ext}`);
    const candidateStem = candidate.slice(0, -ext.length);
    if (!await exists(candidate) && !await exists(`${candidateStem}.prompt.md`) && !await exists(`${candidateStem}.meta.json`)) {
      return candidate;
    }
  }
  throw new Error("目标文件夹中同名素材过多，无法生成安全文件名");
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function directoryHasMedia(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.some((entry) => {
      if (!entry.isFile()) return false;
      const ext = path.extname(entry.name).toLowerCase();
      return imageExts.has(ext) || videoExts.has(ext) || audioExts.has(ext);
    });
  } catch {
    return false;
  }
}

async function countMediaFiles(dir) {
  try {
    const files = await walk(dir);
    return files.filter((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return imageExts.has(ext) || videoExts.has(ext) || audioExts.has(ext);
    }).length;
  } catch {
    return 0;
  }
}

async function readMeta(caseDir) {
  const metaPath = path.join(caseDir, ".asset-review-meta.json");
  try {
    return JSON.parse((await fs.readFile(metaPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

async function writeMeta(caseDir, meta) {
  const metaPath = path.join(caseDir, ".asset-review-meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
}

function assetKind(filePath, caseDir) {
  const ext = path.extname(filePath).toLowerCase();
  const rel = path.relative(caseDir, filePath);
  const parts = rel.split(path.sep);
  const base = path.basename(filePath).toLowerCase();
  if (videoExts.has(ext)) return "video";
  if (audioExts.has(ext)) return "audio";
  if (imageExts.has(ext) && base.includes("contact_sheet")) return "contact";
  if (imageExts.has(ext) && (parts.includes("frames") || /^frame[_-]/.test(base))) return "frame";
  if (imageExts.has(ext)) return "image";
  return "other";
}

async function managedOutputs(projectId = "") {
  const [generated, midjourney] = await Promise.all([
    generationPipeline.listOutputs({ projectId }),
    midjourneyWorkspace.listOutputs({ projectId })
  ]);
  return [...generated, ...midjourney].filter((output) => output.managed && output.outputId && output.storePath);
}

async function findManagedOutput({ outputId = "", projectId = "", relativePath = "" } = {}) {
  const outputs = await managedOutputs(projectId);
  const normalized = path.normalize(String(relativePath || "")).toLowerCase();
  return outputs.find((output) => outputId && output.outputId === outputId)
    || outputs.find((output) => normalized && output.projectId === projectId && path.normalize(output.relativePath || "").toLowerCase() === normalized)
    || null;
}

function managedClassification(output) {
  const smartGroup = output.projectId === "pending-review" ? "review" : "official";
  const category = output.kind === "audio"
    ? "audio"
    : output.kind === "video" ? "videoResult" : "generatedAsset";
  return {
    smartGroup,
    category,
    autoTags: [output.generator || "generation", "managed"].filter(Boolean),
    classification: {
      group: smartGroup,
      source: "registry",
      confidence: 1,
      reason: output.projectId === "pending-review"
        ? "生成任务已登记，等待人工确认归属"
        : output.generator === "midjourney" ? "Midjourney 精确导入登记" : "生成任务输出登记"
    }
  };
}

function inferVersion(relPath) {
  const match = relPath.match(/(?:^|[_-])v(\d+)(?:[_\-.]|$)/i);
  if (match) return `v${match[1]}`;
  if (relPath.includes("两段式")) return "v4";
  if (relPath.includes("机制母版")) return "v5";
  if (relPath.includes("无首尾帧")) return "v3";
  if (relPath.includes("全能参考_v2")) return "v2";
  return "";
}

function initialStatus(relPath) {
  if (relPath.includes("机制母版_v5_test")) return "可用";
  if (relPath.includes("两段式_v4")) return "可用但需优化";
  if (relPath.includes("无首尾帧_v3")) return "可用但需优化";
  if (relPath.includes("v2") || relPath.includes("雨夜古风追逐")) return "不通过但有参考价值";
  return "未评估";
}

async function listProjects() {
  const config = await loadConfig();
  const projects = [];
  for (const project of config.projects) {
    projects.push({
      id: project.id,
      name: project.name,
      path: project.path,
      scanRoots: project.scanRoots,
      exists: await exists(project.path)
    });
  }
  return projects;
}

async function listProjectFolders(projectId) {
  const project = await getProject(projectId);
  return workspaceFolders(project);
}

async function addProjectFolder({ projectId, parentPath = "", name }) {
  const project = await getProjectStrict(projectId);
  const folder = await createProjectFolder({ projectPath: project.path, parentPath, name });
  let scanRootAdded = false;

  if (!folder.parentRelativePath) {
    try {
      const update = await updateConfig((config) => {
        const configuredProject = config.projects.find((item) => item.id === project.id);
        if (!configuredProject) throw new Error(`项目不存在：${project.id}`);
        const normalizeRoot = (value) => String(value || "").replace(/[\\/]+/g, path.sep).replace(/[\\/]+$/, "").toLowerCase();
        const roots = configuredProject.scanRoots || [];
        const scansWholeProject = roots.some((root) => ["", "."].includes(String(root || "").trim()));
        const targetRoot = normalizeRoot(folder.relativePath);
        if (scansWholeProject || roots.some((root) => normalizeRoot(root) === targetRoot)) return false;
        configuredProject.scanRoots = [...roots, folder.relativePath];
        return true;
      });
      scanRootAdded = update.result;
    } catch (error) {
      try {
        await fs.rmdir(folder.absolutePath);
      } catch (rollbackError) {
        throw new Error(`${error.message || error}；新文件夹回滚失败：${rollbackError.message || rollbackError}`);
      }
      throw error;
    }
  }

  if (scanRootAdded) await ensureWatchers().catch(() => {});
  notifyClients("project-change");
  return {
    path: folder.relativePath,
    name: folder.name,
    parentPath: folder.parentRelativePath,
    scanRootAdded,
  };
}

function normalizeRelativeDirectory(value) {
  const parts = String(value || "")
    .replace(/[\\/]+/g, path.sep)
    .split(path.sep)
    .filter((part) => part && part !== ".");
  return parts.join(path.sep);
}

function replaceRelativeDirectoryPrefix(value, previousPath, nextPath) {
  const candidate = normalizeRelativeDirectory(value);
  const previous = normalizeRelativeDirectory(previousPath);
  const next = normalizeRelativeDirectory(nextPath);
  if (!candidate || !previous) return candidate;
  const candidateParts = candidate.split(path.sep);
  const previousParts = previous.split(path.sep);
  const matches = previousParts.every((part, index) => candidateParts[index]?.toLowerCase() === part.toLowerCase());
  if (!matches) return candidate;
  return [...next.split(path.sep).filter(Boolean), ...candidateParts.slice(previousParts.length)].join(path.sep);
}

function relativeDirectoryFromBase(fullPath, basePath) {
  const full = normalizeRelativeDirectory(fullPath);
  const base = normalizeRelativeDirectory(basePath);
  if (!base) return full;
  if (full.toLowerCase() === base.toLowerCase()) return "";
  const prefix = `${base.toLowerCase()}${path.sep}`;
  return full.toLowerCase().startsWith(prefix) ? full.slice(base.length + 1) : null;
}

function rewriteAutomationDirectory(holder, previousPath, nextPath) {
  if (!holder || typeof holder !== "object") return false;
  const previousBasePath = normalizeRelativeDirectory(holder.basePath);
  const nextBasePath = replaceRelativeDirectoryPrefix(previousBasePath, previousPath, nextPath);
  let changed = nextBasePath !== previousBasePath;
  if (holder.routes && typeof holder.routes === "object") {
    for (const [kind, route] of Object.entries(holder.routes)) {
      const routePath = normalizeRelativeDirectory(route);
      const fullPath = normalizeRelativeDirectory([previousBasePath, routePath].filter(Boolean).join(path.sep));
      const rewrittenFullPath = replaceRelativeDirectoryPrefix(fullPath, previousPath, nextPath);
      if (rewrittenFullPath === fullPath) continue;
      const rewrittenRoute = relativeDirectoryFromBase(rewrittenFullPath, nextBasePath);
      if (rewrittenRoute !== null) {
        holder.routes[kind] = rewrittenRoute;
        changed = true;
      }
    }
  }
  holder.basePath = nextBasePath;
  return changed;
}

async function renameProjectDirectory({ projectId, path: folderPath, name }) {
  const project = await getProjectStrict(projectId);
  closeProjectWatchers(project.path);
  try {
    const folder = await renameProjectFolder({ projectPath: project.path, folderPath, name });
    if (folder.unchanged) {
      return {
        path: folder.relativePath,
        previousPath: folder.previousRelativePath,
        name: folder.name,
        previousName: folder.previousName,
        unchanged: true,
      };
    }

    try {
      await updateConfig((config) => {
        const configuredProject = config.projects.find((item) => item.id === project.id);
        if (!configuredProject) throw new Error(`项目不存在：${project.id}`);
        configuredProject.scanRoots = (configuredProject.scanRoots || [])
          .map((root) => ["", "."].includes(String(root || "").trim())
            ? root
            : replaceRelativeDirectoryPrefix(root, folder.previousRelativePath, folder.relativePath));

        if (config.automation?.inbox?.projectId === project.id) {
          rewriteAutomationDirectory(config.automation.inbox, folder.previousRelativePath, folder.relativePath);
        }
        for (const profile of config.automation?.routing?.profiles || []) {
          if (profile.projectId === project.id) {
            rewriteAutomationDirectory(profile, folder.previousRelativePath, folder.relativePath);
          }
        }
      });
    } catch (error) {
      try {
        await renameProjectFolder({
          projectPath: project.path,
          folderPath: folder.relativePath,
          name: folder.previousName,
        });
      } catch (rollbackError) {
        throw new Error(`${error.message || error}；文件夹改名回滚失败：${rollbackError.message || rollbackError}`);
      }
      throw error;
    }

    notifyClients("project-change");
    return {
      path: folder.relativePath,
      previousPath: folder.previousRelativePath,
      name: folder.name,
      previousName: folder.previousName,
      unchanged: false,
    };
  } finally {
    await ensureWatchers().catch(() => {});
  }
}

async function addProject({ name, path: projectPath, scanRoots }) {
  if (!projectPath) throw new Error("Missing project path");
  const absolutePath = path.resolve(projectPath);
  if (!await exists(absolutePath)) throw new Error(`Project folder does not exist: ${absolutePath}`);
  const { result: project } = await updateConfig((config) => {
    const idBase = slugify(name || path.basename(absolutePath));
    let id = idBase;
    let counter = 2;
    while (config.projects.some((item) => item.id === id)) id = `${idBase}-${counter++}`;
    const createdProject = {
      id,
      name: name || path.basename(absolutePath),
      path: absolutePath,
      scanRoots: scanRoots?.length ? scanRoots : ["."]
    };
    config.projects.push(createdProject);
    return createdProject;
  });
  await ensureWatchers();
  notifyClients("project-change");
  return project;
}

async function reorderProjects(projectIds) {
  if (!Array.isArray(projectIds)) throw new Error("Missing project order");
  await updateConfig((config) => {
    const byId = new Map(config.projects.map((project) => [project.id, project]));
    const ordered = [];
    const seen = new Set();
    for (const id of projectIds) {
      if (!byId.has(id) || seen.has(id)) continue;
      ordered.push(byId.get(id));
      seen.add(id);
    }
    for (const project of config.projects) {
      if (!seen.has(project.id)) ordered.push(project);
    }
    config.projects = ordered;
  });
  return listProjects();
}

async function writeMetaOrRemove(caseDir, meta) {
  if (Object.keys(meta).length) {
    await writeMeta(caseDir, meta);
  } else {
    await fs.rm(path.join(caseDir, ".asset-review-meta.json"), { force: true });
  }
}

function caseContainsPath(caseId, relativePath) {
  if (caseId === "." || caseId === "") return true;
  const normalizedCase = path.normalize(caseId);
  const normalizedPath = path.normalize(relativePath);
  return normalizedPath === normalizedCase || normalizedPath.startsWith(normalizedCase + path.sep);
}

async function transferReviewMeta({ sourceProject, sourceCaseId, sourceAssetId, targetProject, targetRelativePath }) {
  if (!sourceCaseId || !sourceAssetId) return null;
  const sourceCaseDir = safeResolveProject(sourceProject, sourceCaseId);
  if (!await exists(sourceCaseDir)) return null;
  const sourceAssetPath = safeResolve(sourceCaseDir, sourceAssetId);
  const sourceKey = path.relative(sourceCaseDir, sourceAssetPath);
  const sourceMeta = await readMeta(sourceCaseDir);
  const annotation = sourceMeta[sourceKey];
  if (!annotation) return null;

  const targetCases = await listCases(targetProject.id);
  const targetCase = targetCases
    .filter((item) => caseContainsPath(item.id, targetRelativePath))
    .sort((a, b) => b.id.length - a.id.length)[0];
  if (!targetCase) return null;
  const targetCaseDir = safeResolveProject(targetProject, targetCase.id);
  const targetAssetPath = safeResolveProject(targetProject, targetRelativePath);
  const targetKey = path.relative(targetCaseDir, targetAssetPath);

  const sameMetaFile = path.resolve(sourceCaseDir).toLowerCase() === path.resolve(targetCaseDir).toLowerCase();
  if (sameMetaFile) {
    delete sourceMeta[sourceKey];
    sourceMeta[targetKey] = annotation;
    await writeMetaOrRemove(sourceCaseDir, sourceMeta);
  } else {
    delete sourceMeta[sourceKey];
    await writeMetaOrRemove(sourceCaseDir, sourceMeta);
    const targetMeta = await readMeta(targetCaseDir);
    targetMeta[targetKey] = annotation;
    await writeMeta(targetCaseDir, targetMeta);
  }
  return { caseId: targetCase.id, assetId: targetKey };
}

function profileForTarget(config, targetProject, targetRelativePath) {
  const normalizedTarget = path.normalize(targetRelativePath || "").toLowerCase();
  return (config.automation?.routing?.profiles || [])
    .filter((profile) => profile.projectId === targetProject.id)
    .map((profile) => {
      const basePath = path.normalize(String(profile.basePath || "").trim()).replace(/^\.[\\/]/, "");
      const normalizedBase = basePath === "." ? "" : basePath.toLowerCase();
      const matches = !normalizedBase || normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${path.sep}`);
      return matches ? { profile, length: normalizedBase.length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0]?.profile || null;
}

async function updateMovedSidecars(destinationPath, sourceProject, sourcePath, targetProject, targetProfile) {
  const ext = path.extname(destinationPath);
  const destinationStem = destinationPath.slice(0, -ext.length);
  const promptPath = `${destinationStem}.prompt.md`;
  const metaPath = `${destinationStem}.meta.json`;
  const oldRelative = path.relative(sourceProject.path, sourcePath);
  const newRelative = path.relative(targetProject.path, destinationPath);

  if (await exists(promptPath)) {
    try {
      const prompt = await fs.readFile(promptPath, "utf8");
      await fs.writeFile(promptPath, prompt
        .split(oldRelative).join(newRelative)
        .split(sourceProject.name).join(targetProject.name), "utf8");
    } catch {}
  }
  if (await exists(metaPath)) {
    try {
      const meta = JSON.parse((await fs.readFile(metaPath, "utf8")).replace(/^\uFEFF/, ""));
      const context = {
        ticketId: String(meta.ticket?.id || ""),
        outputId: String(meta.output?.id || ""),
        threadId: String(meta.ticket?.sourceContext?.threadId || meta.ticket?.sourceContext?.taskId || ""),
        sourceTask: String(meta.ticket?.sourceContext?.sourceTask || meta.ticket?.sourceContext?.taskTitle || "")
      };
      if (meta.ticket && typeof meta.ticket === "object") {
        meta.ticket.projectId = targetProject.id;
        meta.ticket.projectName = targetProject.name;
        meta.ticket.profileId = targetProfile?.id || "";
        meta.ticket.profileName = targetProfile?.name || "";
        meta.ticket.destinationRelativePath = path.dirname(newRelative);
        meta.ticket.routingResolution = {
          source: "manual-move",
          confidence: "high",
          matchedKeyword: "",
          matchedOn: "",
          threadId: context.threadId
        };
      }
      if (meta.output && typeof meta.output === "object") {
        meta.output.path = destinationPath;
        meta.output.relativePath = newRelative;
        meta.output.fileName = path.basename(destinationPath);
        meta.output.promptPath = promptPath;
        meta.output.metaPath = metaPath;
      }
      if (meta.project && typeof meta.project === "object") {
        meta.project.id = targetProject.id;
        meta.project.name = targetProject.name;
        meta.project.path = targetProject.path;
      }
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
      return context;
    } catch {}
  }
  return null;
}

async function moveAsset(body) {
  const config = await loadConfig();
  const sourceProject = await getProjectStrict(body.sourceProjectId);
  const targetProject = await getProjectStrict(body.targetProjectId);
  const managed = await findManagedOutput({
    outputId: String(body.outputId || body.sourceAssetId || ""),
    projectId: sourceProject.id,
    relativePath: body.sourcePath
  });
  if (managed) {
    const targetDirectoryPath = safeResolveProject(targetProject, body.targetDirectory || "");
    const targetDirectory = path.relative(targetProject.path, targetDirectoryPath);
    const sourceExt = path.extname(managed.fileName || managed.relativePath || managed.storePath);
    const requestedName = String(body.fileName || managed.fileName || path.basename(managed.relativePath)).trim();
    const requestedStem = cleanFileStem(path.basename(requestedName, path.extname(requestedName)), path.basename(managed.fileName || "asset", sourceExt));
    const desiredRelativePath = path.join(targetDirectory, `${requestedStem}${sourceExt}`);
    const occupied = new Set((await managedOutputs(targetProject.id)).filter((item) => item.outputId !== managed.outputId)
      .map((item) => path.normalize(item.relativePath).toLowerCase()));
    let targetRelativePath = desiredRelativePath;
    for (let index = 2; occupied.has(path.normalize(targetRelativePath).toLowerCase()) || await exists(safeResolveProject(targetProject, targetRelativePath)); index += 1) {
      targetRelativePath = path.join(targetDirectory, `${requestedStem}-${String(index).padStart(2, "0")}${sourceExt}`);
    }
    if (sourceProject.id === targetProject.id && path.normalize(targetRelativePath).toLowerCase() === path.normalize(managed.relativePath).toLowerCase()) {
      throw new Error("素材已经在这个逻辑位置，请选择其他文件夹或修改文件名");
    }
    const targetProfile = profileForTarget(config, targetProject, targetRelativePath);
    const moved = managed.generator === "midjourney"
      ? await midjourneyWorkspace.relocateOutput(managed.outputId, {
        projectId: targetProject.id,
        projectName: targetProject.name,
        relativePath: targetRelativePath
      })
      : await generationPipeline.relocateArchivedOutput(managed.ticketId, {
        projectId: targetProject.id,
        profileId: targetProfile?.id || "",
        outputId: managed.outputId,
        newRelativePath: targetRelativePath
      }, config);
    let taskBinding = null;
    let routingCorrectionError = "";
    if (managed.threadId && !["pending-review", "misc-library", "ai-reference-library", "reference-library"].includes(targetProject.id)) {
      try {
        taskBinding = await generationPipeline.bindThread({
          threadId: managed.threadId,
          projectId: targetProject.id,
          profileId: targetProfile?.id || "",
          source: "manual-asset-move",
          sourceTask: managed.sourceTask
        }, config);
      } catch (error) {
        routingCorrectionError = String(error.message || error);
      }
    }
    return {
      sourceProjectId: sourceProject.id,
      sourcePath: managed.relativePath,
      sourceRelativePath: managed.relativePath,
      sourceFileName: managed.fileName,
      targetProjectId: targetProject.id,
      targetProjectName: targetProject.name,
      destinationPath: targetRelativePath,
      targetRelativePath,
      fileName: path.basename(targetRelativePath),
      outputId: managed.outputId,
      managed: true,
      movedFile: false,
      movedSidecars: [],
      reviewMeta: managed.review ? { caseId: path.dirname(targetRelativePath) || ".", assetId: managed.outputId } : null,
      taskBinding,
      ticketRelocation: managed.ticketId ? { ticketId: managed.ticketId, movedAt: moved.movedAt || new Date().toISOString() } : null,
      routingCorrectionError
    };
  }
  const sourcePath = safeResolveProject(sourceProject, body.sourcePath);
  const sourceStats = await fs.lstat(sourcePath);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) throw new Error("只能移动普通素材文件");

  const targetDirectory = safeResolveProject(targetProject, body.targetDirectory || "");
  await fs.mkdir(targetDirectory, { recursive: true });
  const sourceExt = path.extname(sourcePath);
  const requestedName = String(body.fileName || path.basename(sourcePath)).trim();
  const requestedStem = cleanFileStem(path.basename(requestedName, path.extname(requestedName)), path.basename(sourcePath, sourceExt));
  const desiredPath = path.join(targetDirectory, `${requestedStem}${sourceExt}`);
  if (path.resolve(desiredPath).toLowerCase() === path.resolve(sourcePath).toLowerCase()) {
    throw new Error("素材已经在这个位置，请选择其他文件夹或修改文件名");
  }
  const destinationPath = await uniqueAssetPath(desiredPath);
  const sourceStem = sourcePath.slice(0, -sourceExt.length);
  const destinationStem = destinationPath.slice(0, -sourceExt.length);
  const mappings = [{ source: sourcePath, destination: destinationPath, role: "asset" }];
  for (const suffix of [".prompt.md", ".meta.json"]) {
    const sidecarSource = `${sourceStem}${suffix}`;
    if (await exists(sidecarSource)) mappings.push({ source: sidecarSource, destination: `${destinationStem}${suffix}`, role: suffix.slice(1) });
  }

  const staged = [];
  try {
    for (const mapping of mappings) {
      const temporaryPath = path.join(path.dirname(mapping.destination), `.${path.basename(mapping.destination)}.${process.pid}.${Date.now()}.moving`);
      await fs.copyFile(mapping.source, temporaryPath);
      const [sourceHash, copiedHash] = await Promise.all([hashFile(mapping.source), hashFile(temporaryPath)]);
      if (sourceHash !== copiedHash) throw new Error(`移动校验失败：${path.basename(mapping.source)}`);
      staged.push({ ...mapping, temporaryPath, sha256: sourceHash });
    }
    for (const mapping of staged) await fs.rename(mapping.temporaryPath, mapping.destination);
  } catch (error) {
    for (const mapping of staged) await fs.rm(mapping.temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  for (const mapping of mappings) await fs.rm(mapping.source, { force: false });
  const targetRelativePath = path.relative(targetProject.path, destinationPath);
  const targetProfile = profileForTarget(config, targetProject, targetRelativePath);
  const movedGeneration = await updateMovedSidecars(destinationPath, sourceProject, sourcePath, targetProject, targetProfile);
  let ticketRelocation = null;
  let taskBinding = null;
  let routingCorrectionError = "";
  if (movedGeneration?.ticketId) {
    try {
      ticketRelocation = await generationPipeline.relocateArchivedOutput(movedGeneration.ticketId, {
        projectId: targetProject.id,
        profileId: targetProfile?.id || "",
        oldPath: sourcePath,
        newPath: destinationPath,
        outputId: movedGeneration.outputId
      }, config);
      const metaPath = `${destinationStem}.meta.json`;
      if (await exists(metaPath)) {
        const meta = JSON.parse((await fs.readFile(metaPath, "utf8")).replace(/^\uFEFF/, ""));
        meta.ticket = { ...ticketRelocation.ticket, outputs: undefined, inboxBaseline: undefined };
        meta.output = ticketRelocation.output;
        meta.project = { id: targetProject.id, name: targetProject.name, path: targetProject.path };
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
      }
      const ledgerDir = path.join(targetProject.path, "生成记录");
      await fs.mkdir(ledgerDir, { recursive: true });
      await fs.appendFile(path.join(ledgerDir, "生成资产台账.jsonl"), JSON.stringify({
        schemaVersion: 1,
        event: "relocated",
        ticketId: movedGeneration.ticketId,
        projectId: targetProject.id,
        profileId: targetProfile?.id || "",
        previous: ticketRelocation.previous,
        output: ticketRelocation.output,
        movedAt: ticketRelocation.movedAt
      }) + "\n", "utf8");
    } catch (error) {
      routingCorrectionError = String(error.message || error);
    }
  }
  const canBindTarget = movedGeneration?.threadId
    && !["pending-review", "misc-library", "ai-reference-library", "reference-library"].includes(targetProject.id);
  if (canBindTarget) {
    try {
      taskBinding = await generationPipeline.bindThread({
        threadId: movedGeneration.threadId,
        projectId: targetProject.id,
        profileId: targetProfile?.id || "",
        source: "manual-asset-move",
        sourceTask: movedGeneration.sourceTask
      }, config);
    } catch (error) {
      routingCorrectionError ||= String(error.message || error);
    }
  }
  const reviewMeta = await transferReviewMeta({
    sourceProject,
    sourceCaseId: body.sourceCaseId,
    sourceAssetId: body.sourceAssetId,
    targetProject,
    targetRelativePath
  });
  return {
    sourceProjectId: sourceProject.id,
    sourcePath,
    sourceRelativePath: path.relative(sourceProject.path, sourcePath),
    sourceFileName: path.basename(sourcePath),
    targetProjectId: targetProject.id,
    targetProjectName: targetProject.name,
    destinationPath,
    targetRelativePath,
    fileName: path.basename(destinationPath),
    movedSidecars: staged.filter((item) => item.role !== "asset").map((item) => item.role),
    reviewMeta,
    taskBinding,
    ticketRelocation: ticketRelocation ? { ticketId: movedGeneration.ticketId, movedAt: ticketRelocation.movedAt } : null,
    routingCorrectionError
  };
}

async function batchMoveAssets(body) {
  if (!Array.isArray(body.items) || !body.items.length) throw new Error("没有可移动的素材");
  const results = [];
  const errors = [];
  for (const item of body.items.slice(0, 200)) {
    try {
      results.push(await moveAsset({
        ...item,
        targetProjectId: item.targetProjectId || body.targetProjectId,
        targetDirectory: item.targetDirectory ?? body.targetDirectory,
        fileName: item.fileName || path.basename(item.sourcePath || "")
      }));
    } catch (error) {
      errors.push({ sourcePath: item.sourcePath || "", message: String(error.message || error) });
    }
  }
  return { results, errors };
}

async function markAsset(body) {
  const project = await getProjectStrict(body.projectId);
  const managed = await findManagedOutput({
    outputId: String(body.outputId || body.assetId || ""),
    projectId: project.id,
    relativePath: body.sourcePath || body.path || ""
  });
  if (managed) {
    const review = {
      userStatus: body.userStatus || "",
      notes: body.notes || "",
      favorite: Boolean(body.favorite),
      tags: Array.isArray(body.tags) ? body.tags : []
    };
    const result = managed.generator === "midjourney"
      ? await midjourneyWorkspace.updateOutputReview(managed.outputId, review)
      : await generationPipeline.updateOutputReview(managed.outputId, review);
    return { projectId: project.id, caseId: body.caseId, assetId: managed.outputId, previous: result.previous, meta: result.output.review };
  }
  const caseDir = safeResolveProject(project, body.caseId);
  const assetPath = safeResolve(caseDir, body.assetId);
  const relToCase = path.relative(caseDir, assetPath);
  const meta = await readMeta(caseDir);
  const previous = meta[relToCase] || {};
  meta[relToCase] = {
    ...previous,
    userStatus: body.userStatus || "",
    notes: body.notes || "",
    favorite: Boolean(body.favorite),
    tags: Array.isArray(body.tags) ? body.tags : [],
    updatedAt: new Date().toISOString()
  };
  await writeMeta(caseDir, meta);
  return { projectId: project.id, caseId: body.caseId, assetId: relToCase, previous, meta: meta[relToCase] };
}

async function batchMarkAssets(body) {
  if (!Array.isArray(body.items) || !body.items.length) throw new Error("没有可标记的素材");
  const results = [];
  const errors = [];
  for (const item of body.items.slice(0, 500)) {
    try {
      results.push(await markAsset(item));
    } catch (error) {
      errors.push({ assetId: item.assetId || "", message: String(error.message || error) });
    }
  }
  return { results, errors };
}

function scheduleTrashPurge(tokenDirectory, delayMs = 15 * 60 * 1000) {
  const timer = setTimeout(() => fs.rm(tokenDirectory, { recursive: true, force: true }).catch(() => {}), delayMs);
  timer.unref?.();
}

async function trashAssets(body) {
  if (!Array.isArray(body.items) || !body.items.length) throw new Error("没有可删除的素材");
  for (const item of body.items.slice(0, 200)) {
    const managed = await findManagedOutput({
      outputId: item.outputId,
      projectId: item.projectId,
      relativePath: item.sourcePath
    });
    if (managed) throw new Error("受管生成资产暂不支持物理删除；请先标记为“丢弃”");
  }
  const token = randomUUID();
  const tokenDirectory = safeResolve(actionTrashRoot, token);
  const storedItems = [];
  let originalsTouched = false;
  await fs.mkdir(tokenDirectory, { recursive: true });

  try {
    for (const [index, item] of body.items.slice(0, 200).entries()) {
      const project = await getProjectStrict(item.projectId);
      const sourcePath = safeResolveProject(project, item.sourcePath);
      const stats = await fs.lstat(sourcePath);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`只能删除普通素材文件：${item.sourcePath}`);
      const sourceExt = path.extname(sourcePath);
      const sourceStem = sourcePath.slice(0, -sourceExt.length);
      const mappings = [{ source: sourcePath, name: path.basename(sourcePath), role: "asset" }];
      for (const suffix of [".prompt.md", ".meta.json"]) {
        const sidecar = `${sourceStem}${suffix}`;
        if (await exists(sidecar)) mappings.push({ source: sidecar, name: path.basename(sidecar), role: suffix.slice(1) });
      }

      const storedDirectory = path.join(tokenDirectory, "files", String(index));
      await fs.mkdir(storedDirectory, { recursive: true });
      const storedMappings = [];
      for (const mapping of mappings) {
        const storedPath = path.join(storedDirectory, mapping.name);
        await fs.copyFile(mapping.source, storedPath);
        const [sourceHash, storedHash] = await Promise.all([hashFile(mapping.source), hashFile(storedPath)]);
        if (sourceHash !== storedHash) throw new Error(`删除前校验失败：${mapping.name}`);
        storedMappings.push({ ...mapping, storedPath: path.relative(tokenDirectory, storedPath), sha256: sourceHash });
      }

      let reviewMeta = null;
      if (item.caseId && item.assetId) {
        const caseDir = safeResolveProject(project, item.caseId);
        const assetPath = safeResolve(caseDir, item.assetId);
        const key = path.relative(caseDir, assetPath);
        const meta = await readMeta(caseDir);
        if (meta[key]) reviewMeta = { caseId: item.caseId, assetId: key, value: meta[key] };
      }
      storedItems.push({ projectId: project.id, sourcePath: item.sourcePath, mappings: storedMappings, reviewMeta });
    }

    const manifest = { token, createdAt: new Date().toISOString(), items: storedItems };
    await fs.writeFile(path.join(tokenDirectory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

    originalsTouched = true;
    for (const item of storedItems) {
      for (const mapping of item.mappings) await fs.rm(mapping.source, { force: false });
      if (item.reviewMeta) {
        const project = await getProjectStrict(item.projectId);
        const caseDir = safeResolveProject(project, item.reviewMeta.caseId);
        const meta = await readMeta(caseDir);
        delete meta[item.reviewMeta.assetId];
        await writeMetaOrRemove(caseDir, meta);
      }
    }
    scheduleTrashPurge(tokenDirectory);
    return { token, count: storedItems.length, expiresInMs: 15 * 60 * 1000 };
  } catch (error) {
    if (!originalsTouched) await fs.rm(tokenDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function restoreTrashedAssets(body) {
  const token = String(body.token || "").trim();
  if (!token) throw new Error("缺少撤销记录");
  const tokenDirectory = safeResolve(actionTrashRoot, token);
  const manifest = JSON.parse((await fs.readFile(path.join(tokenDirectory, "manifest.json"), "utf8")).replace(/^\uFEFF/, ""));

  for (const item of manifest.items || []) {
    const project = await getProjectStrict(item.projectId);
    for (const mapping of item.mappings || []) {
      const destination = safeResolveProject(project, path.relative(project.path, mapping.source));
      if (await exists(destination)) throw new Error(`原位置已有同名文件，无法撤销：${path.basename(destination)}`);
    }
  }

  for (const item of manifest.items || []) {
    const project = await getProjectStrict(item.projectId);
    for (const mapping of item.mappings || []) {
      const storedPath = safeResolve(tokenDirectory, mapping.storedPath);
      const destination = safeResolveProject(project, path.relative(project.path, mapping.source));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.${Date.now()}.restoring`;
      await fs.copyFile(storedPath, temporary);
      const restoredHash = await hashFile(temporary);
      if (restoredHash !== mapping.sha256) {
        await fs.rm(temporary, { force: true });
        throw new Error(`撤销校验失败：${path.basename(destination)}`);
      }
      await fs.rename(temporary, destination);
    }
    if (item.reviewMeta) {
      const caseDir = safeResolveProject(project, item.reviewMeta.caseId);
      const meta = await readMeta(caseDir);
      meta[item.reviewMeta.assetId] = item.reviewMeta.value;
      await writeMeta(caseDir, meta);
    }
  }
  await fs.rm(tokenDirectory, { recursive: true, force: true });
  return { token, count: manifest.items?.length || 0 };
}

async function appendCaseDirectories({ project, scanRoot, rootDir, currentDir = rootDir, depth = 1, maxDepth = 1, cases }) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const caseDir = path.join(currentDir, entry.name);
    const stats = await fs.stat(caseDir);
    const relPath = path.relative(project.path, caseDir);
    cases.push({
      id: relPath,
      projectId: project.id,
      name: entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, ""),
      relPath,
      scanRoot,
      mediaCount: await countMediaFiles(caseDir),
      mtimeMs: stats.mtimeMs
    });
    if (depth < maxDepth) {
      await appendCaseDirectories({ project, scanRoot, rootDir, currentDir: caseDir, depth: depth + 1, maxDepth, cases });
    }
  }
}

async function listCases(projectId) {
  const project = await getProject(projectId);
  const { folders } = await workspaceFolders(project);
  const cases = folders.map(folder => ({ id: folder.path || ".", projectId: project.id, name: folder.name,
    relPath: folder.path || ".", scanRoot: ".", mediaCount: 0, mtimeMs: 0 }));
  const byPath = new Map(cases.map(item => [path.normalize(item.id).toLowerCase(), item]));
  for (const file of await collectWorkspaceFiles(project)) {
    const stats = await fs.stat(file);
    let directory = path.dirname(path.relative(project.path, file));
    while (true) {
      const item = byPath.get(path.normalize(directory).toLowerCase());
      if (item) { item.mediaCount += 1; item.mtimeMs = Math.max(item.mtimeMs, stats.mtimeMs); }
      if (directory === ".") break;
      directory = path.dirname(directory);
    }
  }
  for (const output of await managedOutputs(project.id)) {
    const stats = await fs.stat(output.storePath).catch(() => null);
    if (!stats) continue;
    const id = output.caseId || path.dirname(output.relativePath) || ".";
    const existing = byPath.get(path.normalize(id).toLowerCase());
    if (existing) { existing.mediaCount += 1; existing.mtimeMs = Math.max(existing.mtimeMs, stats.mtimeMs); }
    else { const item = { id, projectId: project.id, name: path.basename(id), relPath: id, scanRoot: "@managed", mediaCount: 1, mtimeMs: stats.mtimeMs, managed: true }; cases.push(item); byPath.set(path.normalize(id).toLowerCase(), item); }
  }
  return cases;
}

async function listAssets(projectId, caseId) {
  const project = await getProject(projectId);
  const all = caseId === "__all__";
  const caseDir = all ? project.path : safeResolveProject(project, caseId);
  const caseExists = await exists(caseDir);
  const files = await collectWorkspaceFiles(project, caseId);
  const meta = caseExists ? await readMeta(caseDir) : {};
  const assets = [];
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (!fileType(filePath)) continue;
    const stats = await fs.stat(filePath);
    const relToCase = path.relative(caseDir, filePath);
    const relToProject = path.relative(project.path, filePath);
    const kind = assetKind(filePath, caseDir);
    const stored = meta[relToCase] || {};
    assets.push({
      id: relToCase,
      projectId: project.id,
      projectName: project.name,
      caseId,
      kind,
      type: fileType(filePath),
      absolutePath: filePath,
      htmlUrl: fileType(filePath) === "html" ? `/api/project-file/${encodeURIComponent(project.id)}/${relToProject.split(path.sep).map(encodeURIComponent).join("/")}` : "",
      readOnly: project.readOnly === true,
      previewUrl: `/api/preview?project=${encodeURIComponent(project.id)}&path=${encodeURIComponent(relToProject)}`,
      version: inferVersion(relToCase),
      name: path.basename(filePath),
      relPath: relToProject,
      caseRelPath: relToCase,
      dir: path.dirname(relToProject),
      mediaUrl: `/media?project=${encodeURIComponent(project.id)}&path=${encodeURIComponent(relToProject)}`,
      downloadUrl: `/download?project=${encodeURIComponent(project.id)}&path=${encodeURIComponent(relToProject)}`,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mtime: new Date(stats.mtimeMs).toISOString(),
      initialStatus: initialStatus(relToCase),
      userStatus: stored.userStatus || "",
      notes: stored.notes || "",
      favorite: Boolean(stored.favorite),
      tags: stored.tags || []
    });
  }
  for (const output of await managedOutputs(project.id)) {
    const outputCaseId = output.caseId || path.dirname(output.relativePath) || ".";
    if (!all && path.normalize(outputCaseId).toLowerCase() !== path.normalize(caseId).toLowerCase()) continue;
    let stats;
    try {
      stats = await fs.stat(output.storePath);
    } catch {
      continue;
    }
    const stored = output.review || {};
    const kind = output.kind === "video" ? "video" : output.kind === "audio" ? "audio" : "image";
    assets.push({
      id: output.outputId,
      outputId: output.outputId,
      managed: true,
      projectId: project.id,
      projectName: project.name,
      caseId,
      kind,
      type: fileType(output.storePath) || kind,
      absolutePath: output.storePath,
      ticketId: output.ticketId || "",
      sourceTask: output.sourceTask || "",
      promptPath: output.promptPath || "",
      previewUrl: `/api/preview?output=${encodeURIComponent(output.outputId)}`,
      version: inferVersion(output.relativePath || ""),
      name: output.fileName || path.basename(output.relativePath),
      relPath: output.relativePath,
      resolvedPath: output.storePath,
      caseRelPath: output.outputId,
      dir: path.dirname(output.relativePath),
      mediaUrl: `/media?output=${encodeURIComponent(output.outputId)}`,
      downloadUrl: `/download?output=${encodeURIComponent(output.outputId)}`,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mtime: new Date(stats.mtimeMs).toISOString(),
      initialStatus: initialStatus(output.relativePath || ""),
      userStatus: stored.userStatus || "",
      notes: stored.notes || "",
      favorite: Boolean(stored.favorite),
      tags: stored.tags || [],
      ...managedClassification(output)
    });
  }
  const unique = new Map();
  for (const asset of assets) unique.set(path.normalize(asset.absolutePath).toLowerCase(), asset);
  return [...unique.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function serveFile(req, res, filePath, asDownload = false, projectResource = "", trustedUi = false) {
  const stats = await fs.stat(filePath);
  const headers = {
    "content-type": contentType(filePath),
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (projectResource) headers["access-control-allow-origin"] = "*";
  if (!trustedUi && (fileType(filePath) === "html" || path.extname(filePath).toLowerCase() === ".svg")) {
    const resources = projectResource ? ["https://web-sandbox.oaiusercontent.com", `http://127.0.0.1:${port}`, `http://localhost:${port}`].map(origin => `${origin}${projectResource}`).join(" ") : "";
    headers["content-security-policy"] = projectResource
      ? `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${resources}; style-src 'unsafe-inline' ${resources}; img-src data: blob: ${resources}; media-src blob: ${resources}; font-src data: ${resources}; connect-src ${resources}; base-uri 'none'; form-action 'none'; object-src 'none'`
      : "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
  }
  if (asDownload) {
    headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`;
  }

  const range = req.headers.range;
  if (range && !asDownload) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(String(range).trim());
    if (match) {
      const isSuffix = !match[1] && Boolean(match[2]);
      const suffixLength = isSuffix ? Number(match[2]) : 0;
      const start = isSuffix ? Math.max(0, stats.size - suffixLength) : Number(match[1]);
      const requestedEnd = isSuffix ? stats.size - 1 : match[2] ? Number(match[2]) : stats.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
        || start < 0 || start >= stats.size || requestedEnd < start
        || (!match[1] && !match[2]) || (isSuffix && suffixLength <= 0)) {
        res.writeHead(416, { ...headers, "content-range": `bytes */${stats.size}`, "content-length": 0 });
        res.end();
        return;
      }
      const end = Math.min(requestedEnd, stats.size - 1);
      res.writeHead(206, {
        ...headers,
        "content-range": `bytes ${start}-${end}/${stats.size}`,
        "content-length": end - start + 1
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(416, { ...headers, "content-range": `bytes */${stats.size}`, "content-length": 0 });
    res.end();
    return;
  }

  res.writeHead(200, { ...headers, "content-length": stats.size });
  createReadStream(filePath).pipe(res);
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) {
    req.workspaceMutationSummary = {};
    return {};
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  req.workspaceMutationSummary = mutationSummary(body);
  return body;
}

function openFinder(targetPath, reveal = true) {
  let command;
  let args;
  if (process.platform === "win32") {
    command = "explorer.exe";
    args = reveal ? ["/select,", targetPath] : [targetPath];
  } else if (process.platform === "darwin") {
    command = "open";
    args = reveal ? ["-R", targetPath] : [targetPath];
  } else {
    command = "xdg-open";
    args = [reveal ? path.dirname(targetPath) : targetPath];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}

function localDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function midjourneyTargetDirectory(project, requestedPath = "") {
  if (project.id === "mj-library") return ".";
  const date = localDateStamp();
  const requested = String(requestedPath || "").trim().replace(/[\\/]+$/u, "");
  if (["daily-practice", "pending-review"].includes(project.id)) {
    const dated = requested.match(/(?:^|[\\/])(\d{4}-\d{2}-\d{2})(?:$|[\\/])/u)?.[1]
      || (/^\d{4}-\d{2}-\d{2}$/u.test(requested) ? requested : date);
    return path.join(dated, "图片", "Midjourney");
  }

  return requested ? path.join(requested, "Midjourney") : path.join("Midjourney", date);
}

async function readRhythmControlRegistry() {
  try {
    const data = JSON.parse((await fs.readFile(rhythmControlRegistryPath, "utf8")).replace(/^\uFEFF/, ""));
    return {
      schemaVersion: 1,
      tracks: Array.isArray(data.tracks) ? data.tracks : [],
      activeByProject: data.activeByProject && typeof data.activeByProject === "object" ? data.activeByProject : {}
    };
  } catch {
    return { schemaVersion: 1, tracks: [], activeByProject: {} };
  }
}

async function writeRhythmControlRegistry(registry) {
  await fs.writeFile(rhythmControlRegistryPath, JSON.stringify({
    schemaVersion: 1,
    tracks: (registry.tracks || []).slice(0, 200),
    activeByProject: registry.activeByProject || {}
  }, null, 2) + "\n", "utf8");
}

async function runRhythmControlBuilder(payload) {
  if (!await exists(rhythmControlScriptPath)) throw new Error("节奏控制轨生成器缺失");
  const tempRoot = path.join(__dirname, "rhythm-control-work");
  await fs.mkdir(tempRoot, { recursive: true });
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const payloadPath = path.join(tempRoot, `${runId}.payload.json`);
  const resultPath = path.join(tempRoot, `${runId}.result.json`);
  await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), "utf8");

  let stdout = "";
  let stderr = "";
  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.env.PYTHON || "python", [
        rhythmControlScriptPath,
        "--payload", payloadPath,
        "--result", resultPath
      ], {
        cwd: __dirname,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("节奏控制轨生成超时"));
      }, 12 * 60 * 1000);
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    const result = await exists(resultPath)
      ? JSON.parse((await fs.readFile(resultPath, "utf8")).replace(/^\uFEFF/, ""))
      : null;
    if (exitCode !== 0 || !result?.ok) {
      throw new Error(result?.error || stderr.trim() || stdout.trim() || "节奏控制轨生成失败");
    }
    return result;
  } finally {
    await fs.rm(payloadPath, { force: true }).catch(() => {});
    await fs.rm(resultPath, { force: true }).catch(() => {});
  }
}

async function rhythmControlCapabilities() {
  let sfxCount = 0;
  const catalogPath = path.join(audioSkillRoot, "references", "sfx-catalog.json");
  try {
    const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
    sfxCount = Number(catalog.total || catalog.entries?.length || 0);
  } catch {}
  let musicReady = false;
  try {
    const response = await fetch("http://127.0.0.1:8001/health", { signal: AbortSignal.timeout(1500) });
    const health = await response.json();
    musicReady = response.ok && (health.data?.status || health.status) === "ok";
  } catch {}
  return {
    sfxCount,
    sfxReady: sfxCount > 0,
    musicReady,
    musicCanAutoStart: await exists(aceStepLauncher)
  };
}

function rhythmControlDestination(project, profile, body) {
  if (String(body.destinationPath || "").trim()) return String(body.destinationPath).trim();
  const date = localDateStamp();
  if (profile?.basePath) return path.join(profile.basePath, "节奏控制轨", date);
  return path.join("节奏控制轨", date);
}

async function createRhythmControlTrack(body) {
  const config = await loadConfig();
  const project = await getProjectStrict(body.projectId);
  const profile = config.automation?.routing?.profiles?.find((item) => item.id === body.profileId && item.projectId === project.id) || null;
  const destinationRelativePath = rhythmControlDestination(project, profile, body);
  const outputDir = safeResolveProject(project, destinationRelativePath);
  const duration = Number(body.duration || 0);
  if (!Number.isFinite(duration) || duration < 2 || duration > 180) throw new Error("目标时长应在 2–180 秒之间");
  const cues = Array.isArray(body.cues) ? body.cues : [];
  const result = await runRhythmControlBuilder({
    projectRoot: project.path,
    projectId: project.id,
    projectName: project.name || project.id,
    profileId: profile?.id || "",
    outputDir,
    name: body.name,
    duration,
    mode: body.mode || "sfx",
    bpm: Number(body.bpm || 96),
    keyScale: body.keyScale || "D minor",
    timeSignature: body.timeSignature || "4",
    description: body.description || "",
    musicPrompt: body.musicPrompt || "",
    cues,
    apiUrl: "http://127.0.0.1:8001",
    audioSkillRoot,
    sfxCatalog: path.join(audioSkillRoot, "references", "sfx-catalog.json"),
    musicGeneratorScript: path.join(audioSkillRoot, "scripts", "generate_music_acestep.py"),
    aceStepLauncher,
    workDir: path.join(__dirname, "rhythm-control-work", `render-${Date.now()}`)
  });
  const trackPath = safeResolveProject(project, result.track.relativePath);
  if (!await exists(trackPath)) throw new Error("控制轨生成结束，但没有找到输出文件");
  const track = {
    ...result.track,
    projectId: project.id,
    projectName: project.name || project.id,
    profileId: profile?.id || "",
    destinationRelativePath,
    mediaUrl: `/media?project=${encodeURIComponent(project.id)}&path=${encodeURIComponent(result.track.relativePath)}`
  };
  const registry = await readRhythmControlRegistry();
  registry.tracks = [track, ...registry.tracks.filter((item) => item.id !== track.id)];
  registry.activeByProject[project.id] = track.id;
  await writeRhythmControlRegistry(registry);
  return track;
}

async function rhythmControlStatus(projectId = "") {
  const registry = await readRhythmControlRegistry();
  const tracks = registry.tracks
    .filter((track) => !projectId || track.projectId === projectId)
    .filter((track) => track.absolutePath && path.isAbsolute(track.absolutePath))
    .slice(0, 40);
  return {
    capabilities: await rhythmControlCapabilities(),
    activeTrackId: projectId ? registry.activeByProject[projectId] || "" : "",
    tracks
  };
}

async function saveAutomationSettings(body) {
  const { saved } = await updateConfig((config) => {
  const automation = normalizeAutomation(body.automation || body);
  const previouslyEnabled = Boolean(config.automation?.inbox?.enabled);
  if (automation.inbox.enabled && !previouslyEnabled) {
    automation.inbox.startedAt = new Date().toISOString();
  } else if (automation.inbox.enabled) {
    automation.inbox.startedAt = automation.inbox.startedAt || config.automation?.inbox?.startedAt || new Date().toISOString();
  } else {
    automation.inbox.startedAt = null;
  }
  if (automation.inbox.transferMode === "move") {
    if (body.confirmMove === true) {
      automation.inbox.moveApprovedAt = new Date().toISOString();
    } else if (!automation.inbox.moveApprovedAt) {
      throw new Error("启用自动转移前需要明确确认");
    }
  } else {
    automation.inbox.moveApprovedAt = null;
  }
  if (automation.inbox.enabled && automation.routing.enabled) {
    const projectIds = new Set(config.projects.map((project) => project.id));
    const missing = automation.routing.profiles.find((profile) => !projectIds.has(profile.projectId));
    if (missing) throw new Error(`分流规则的目标项目不存在：${missing.name}`);
    if (!automation.routing.profiles.some((profile) => profile.id === automation.routing.activeProfileId)) {
      throw new Error("请选择一个有效的当前下载项目");
    }
  } else if (automation.inbox.enabled && !config.projects.some((project) => project.id === automation.inbox.projectId)) {
    throw new Error("自动归档已开启，但尚未选择有效的目标项目");
  }

  if (automation.cleanup.enabled && !automation.cleanup.dryRun) {
    if (body.confirmCleanup !== true) throw new Error("启用实际清理前需要明确确认");
    automation.cleanup.approvedAt = new Date().toISOString();
  } else {
    automation.cleanup.approvedAt = null;
  }

  if (automation.cleanup.purgeEnabled) {
    if (body.confirmPurge !== true) throw new Error("启用隔离区永久清空前需要单独确认");
    automation.cleanup.purgeApprovedAt = new Date().toISOString();
  } else {
    automation.cleanup.purgeApprovedAt = null;
  }

  config.automation = automation;
  });
  notifyClients("automation-change");
  return saved.automation;
}

async function withAutomationLock(operation) {
  if (automationBusy) throw new Error("下载整理任务正在运行，请稍后再试");
  automationBusy = true;
  try {
    return await operation();
  } finally {
    automationBusy = false;
  }
}

async function checkAutomationSchedule() {
  if (automationBusy) return;
  automationBusy = true;
  try {
    const config = await loadConfig();
    if (config.automation.inbox.enabled) {
      const generationClaims = await generationPipeline.claimArmedDownloads(config, {
        settleSeconds: Math.min(6, Math.max(2, config.automation.inbox.settleSeconds || 4))
      });
      if (generationClaims.length) notifyClients("generation-change");
    }
    const ledger = await downloadAutomation.readLedger();
    const now = Date.now();
    const organizerDue = !ledger.lastOrganizerRunAt || now - Date.parse(ledger.lastOrganizerRunAt) >= config.automation.inbox.pollSeconds * 1000;
    if (
      config.automation.inbox.enabled
      && config.automation.inbox.capturePolicy === "all-downloads"
      && organizerDue
    ) {
      const result = await downloadAutomation.runOrganizer(config.automation, config.projects);
      if (result.imported.length) notifyClients("automation-change");
    }

    const latestLedger = await downloadAutomation.readLedger();
    const cleanupDue = !latestLedger.lastCleanupRunAt || now - Date.parse(latestLedger.lastCleanupRunAt) >= config.automation.cleanup.intervalHours * 60 * 60 * 1000;
    if (
      config.automation.inbox.capturePolicy === "all-downloads" &&
      config.automation.cleanup.enabled &&
      !config.automation.cleanup.dryRun &&
      config.automation.cleanup.approvedAt &&
      cleanupDue
    ) {
      const result = await downloadAutomation.runCleanup(config.automation);
      if (result.quarantined?.length || result.purged?.length) notifyClients("automation-change");
    }
  } catch (error) {
    console.warn("Download automation:", error.message);
  } finally {
    automationBusy = false;
  }
}

function notifyClients(event = "asset-change") {
  const payload = JSON.stringify({ event, at: new Date().toISOString() });
  for (const client of sseClients) {
    client.write(`event: ${event}\n`);
    client.write(`data: ${payload}\n\n`);
  }
}

function scheduleNotify() {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = setTimeout(() => notifyClients(), 600);
}

async function runDuplicateSweep() {
  try {
    const config = await loadConfig();
    const result = await duplicateCleaner.sweepProjects(config.projects, config.deduplication);
    if (result.quarantined.length || result.purged.length) notifyClients("deduplication-change");
    if (result.quarantined.length) console.log(`Exact duplicate images quarantined: ${result.quarantined.length}`);
  } catch (error) {
    console.warn("Exact duplicate cleanup:", error.message);
  }
}

async function ensureWatchers() {
  const config = await loadConfig();
  for (const project of config.projects) {
    for (const scanRoot of project.scanRoots) {
      const watchRoot = safeResolveProject(project, scanRoot);
      if (!await exists(watchRoot)) continue;
      if (watcherHandles.has(watchRoot)) continue;
      try {
        const watcher = watch(watchRoot, { recursive: true }, (_eventType, filename) => {
          scheduleNotify();
          if (!filename) return;
          const changedPath = path.resolve(watchRoot, String(filename));
          duplicateCleaner.schedule({
            filePath: changedPath,
            project,
            config: config.deduplication,
            onDeduplicated: () => notifyClients("deduplication-change")
          });
        });
        watcher.on("error", (error) => {
          console.warn(`Asset watcher error (${watchRoot}):`, error.message);
        });
        watcherHandles.set(watchRoot, watcher);
        console.log(`Watching assets: ${watchRoot}`);
      } catch (error) {
        console.warn(`Asset watcher unavailable (${watchRoot}):`, error.message);
      }
    }
  }
}

function closeProjectWatchers(projectPath) {
  const projectRoot = path.resolve(projectPath);
  for (const [watchRoot, watcher] of watcherHandles) {
    const relative = path.relative(projectRoot, path.resolve(watchRoot));
    const belongsToProject = relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    if (!belongsToProject) continue;
    watcher.close();
    watcherHandles.delete(watchRoot);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const mutationStartedAt = Date.now();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "")
        && url.pathname.startsWith("/api/")
        && !url.pathname.startsWith("/api/workspace-governance/")) {
      res.once("finish", () => {
        if (res.statusCode >= 400) return;
        void workspaceGovernance.record("workspace.mutation", {
          method: req.method,
          route: url.pathname,
          status: res.statusCode,
          durationMs: Date.now() - mutationStartedAt,
          ...(req.workspaceMutationSummary || {})
        }).catch((error) => console.warn("Workspace journal:", error.message));
      });
    }

    if (req.method === "OPTIONS") {
      const origin = String(req.headers.origin || "");
      if (!isAllowedLocalOrigin(req)) {
        sendJson(res, { error: "Origin is not allowed" }, 403);
        return;
      }
      res.writeHead(204, {
        "access-control-allow-origin": origin || `http://127.0.0.1:${port}`,
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,x-asset-console-token",
        vary: "origin"
      });
      res.end();
      return;
    }

    if (isProtectedLocalRoute(url.pathname) && (!isAllowedLocalOrigin(req) || !hasValidApiToken(req))) {
      sendJson(res, { error: "Local API authentication failed" }, 403);
      return;
    }

    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "")
        && url.pathname.startsWith("/api/")
        && !url.pathname.startsWith("/api/workspace-governance/")) {
      await ensureMutationSafetyPoint();
    }

    if (url.pathname === "/api/workspace-governance/status" && req.method === "GET") {
      const config = await loadConfig();
      sendJson(res, await workspaceGovernance.status({
        archives: config.projects.map((project) => ({ id: project.id, label: project.name, path: project.path }))
      }));
      return;
    }

    if (url.pathname === "/api/workspace-governance/history" && req.method === "GET") {
      sendJson(res, { history: await workspaceGovernance.recentHistory(url.searchParams.get("limit") || 50) });
      return;
    }

    if (url.pathname === "/api/workspace-governance/snapshots" && req.method === "POST") {
      const body = await readRequestBody(req);
      const snapshot = await workspaceGovernance.createSnapshot({
        label: body.label || "手动恢复点",
        reason: body.reason || "manual",
        includeModules: body.includeModules === true
      });
      sendJson(res, { ok: true, snapshot });
      return;
    }

    if (url.pathname === "/api/workspace-governance/restore" && req.method === "POST") {
      const body = await readRequestBody(req);
      if (body.confirm !== true) throw new Error("恢复活动数据前需要明确确认");
      const result = await workspaceGovernance.restoreSnapshot(String(body.snapshotId || ""), { components: ["state"] });
      notifyClients("workspace-governance-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/workspace-governance/modules/restore" && req.method === "POST") {
      const body = await readRequestBody(req);
      if (body.confirm !== true) throw new Error("回滚工作台模块前需要明确确认");
      const components = Array.isArray(body.components) ? body.components : [body.component];
      const result = await workspaceGovernance.restoreModules(String(body.snapshotId || ""), { components });
      notifyClients("workspace-governance-change");
      sendJson(res, { ok: true, result });
      if (result.restartRequired) {
        setTimeout(() => server.close(() => process.exit(0)), 350).unref();
      }
      return;
    }

    if (url.pathname === "/api/workspace-governance/cache/clear" && req.method === "POST") {
      const body = await readRequestBody(req);
      if (body.confirm !== true) throw new Error("清理工作台缓存前需要明确确认");
      const result = await workspaceGovernance.clearCaches();
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/prompt-library/health" && req.method === "GET") {
      sendJson(res, await promptLibrary.health());
      return;
    }

    if (url.pathname === "/api/prompt-library" && req.method === "GET") {
      sendJson(res, await promptLibrary.list({
        kind: url.searchParams.get("kind") || "",
        query: url.searchParams.get("query") || "",
        category: url.searchParams.get("category") || "",
        projectId: url.searchParams.get("project") || "",
        reviewStatus: url.searchParams.get("reviewStatus") || ""
      }));
      return;
    }

    if (url.pathname === "/api/prompt-library/compile" && req.method === "POST") {
      const result = await promptLibrary.compile();
      notifyClients("prompt-library-change");
      sendJson(res, { ok: true, ...result });
      return;
    }

    if (url.pathname === "/api/prompt-library/captures" && req.method === "POST") {
      const body = await readRequestBody(req);
      const result = await promptLibrary.create("capture", body);
      notifyClients("prompt-library-change");
      const origin = String(req.headers.origin || "");
      if (origin.startsWith("chrome-extension://")) res.setHeader("access-control-allow-origin", origin);
      sendJson(res, { ok: true, ...result });
      return;
    }

    if (url.pathname === "/api/prompt-library/items" && req.method === "POST") {
      const body = await readRequestBody(req);
      const result = await promptLibrary.create(String(body.kind || "capture"), body);
      notifyClients("prompt-library-change");
      sendJson(res, { ok: true, ...result });
      return;
    }

    const promptItemMatch = url.pathname.match(/^\/api\/prompt-library\/items\/(capture|term|recipe|prompt)\/([^/]+)$/);
    if (promptItemMatch && (req.method === "PUT" || req.method === "DELETE")) {
      const [, kind, rawId] = promptItemMatch;
      const id = decodeURIComponent(rawId);
      const result = req.method === "PUT"
        ? await promptLibrary.update(kind, id, await readRequestBody(req))
        : await promptLibrary.remove(kind, id);
      notifyClients("prompt-library-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/3d/status" && req.method === "GET") {
      sendJson(res, await threeDWorkbench.status());
      return;
    }

    if (url.pathname === "/api/3d/tasks" && req.method === "GET") {
      sendJson(res, {
        tasks: await threeDWorkbench.list({
          projectId: url.searchParams.get("project") || "",
          limit: url.searchParams.get("limit") || 100
        })
      });
      return;
    }

    if (url.pathname === "/api/3d/tasks" && req.method === "POST") {
      const body = await readRequestBody(req);
      const config = await loadConfig();
      const task = await threeDWorkbench.create(body, config.projects);
      notifyClients("three-d-change");
      sendJson(res, { ok: true, task });
      return;
    }

    const threeDMatch = url.pathname.match(/^\/api\/3d\/tasks\/([^/]+)\/(refresh|open)$/);
    if (threeDMatch && req.method === "POST") {
      const [, rawId, action] = threeDMatch;
      const id = decodeURIComponent(rawId);
      const { task } = await threeDWorkbench.get(id);
      const result = action === "refresh" ? await threeDWorkbench.refresh(id) : task;
      if (action === "open") openFinder(task.workspacePath, false);
      notifyClients("three-d-change");
      sendJson(res, { ok: true, task: result });
      return;
    }

    const threeDDeleteMatch = url.pathname.match(/^\/api\/3d\/tasks\/([^/]+)$/);
    if (threeDDeleteMatch && req.method === "DELETE") {
      const result = await threeDWorkbench.remove(decodeURIComponent(threeDDeleteMatch[1]));
      notifyClients("three-d-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/midjourney" && req.method === "GET") {
      sendJson(res, await midjourneyWorkspace.summary());
      return;
    }

    if (url.pathname === "/api/midjourney/preview" && req.method === "GET") {
      const { source } = midjourneyWorkspace.sourcePath(url.searchParams.get("name") || "");
      await serveFile(req, res, source);
      return;
    }

    if (url.pathname === "/api/midjourney/import" && req.method === "POST") {
      const body = await readRequestBody(req);
      const projectId = String(body.projectId || "pending-review");
      const project = await getProjectStrict(projectId);
      if (!await exists(project.path)) throw new Error(`项目文件夹不存在：${project.name}`);
      const targetRelativePath = midjourneyTargetDirectory(project, body.targetDirectory);
      const imported = await midjourneyWorkspace.importFiles({
        names: body.names,
        projectId: project.id,
        projectName: project.name,
        generatedRoot: (await loadConfig()).storage.generatedRoot,
        targetRelativePath
      });
      notifyClients("asset-change");
      notifyClients("midjourney-change");
      sendJson(res, { ok: true, imported, targetRelativePath });
      return;
    }

    if (url.pathname === "/api/midjourney/profiles" && req.method === "POST") {
      const profile = await midjourneyWorkspace.saveProfile(await readRequestBody(req));
      notifyClients("midjourney-change");
      sendJson(res, { ok: true, profile });
      return;
    }

    const midjourneyProfileMatch = url.pathname.match(/^\/api\/midjourney\/profiles\/([^/]+)$/u);
    if (midjourneyProfileMatch && req.method === "DELETE") {
      const profile = await midjourneyWorkspace.deleteProfile(decodeURIComponent(midjourneyProfileMatch[1]));
      notifyClients("midjourney-change");
      sendJson(res, { ok: true, profile });
      return;
    }

    if (url.pathname === "/api/projects/reorder" && req.method === "POST") {
      const body = await readRequestBody(req);
      const projects = await reorderProjects(body.projectIds);
      sendJson(res, { ok: true, projects });
      return;
    }

    if (url.pathname === "/api/codex/workspace" && req.method === "GET") {
      sendJson(res, await codexWorkspace(url.searchParams.get("threadId") || ""));
      return;
    }

    const projectFile = url.pathname.match(/^\/api\/project-file\/([^/]+)\/(.+)$/);
    if (projectFile && req.method === "GET") {
      const project = await getProject(decodeURIComponent(projectFile[1]));
      const relativePath = decodeURIComponent(projectFile[2]);
      await serveFile(req, res, safeResolveProject(project, relativePath), false, `/api/project-file/${encodeURIComponent(project.id)}/`);
      return;
    }

    if (url.pathname === "/api/preview" && req.method === "GET") {
      const outputId = url.searchParams.get("output");
      const output = outputId ? await findManagedOutput({ outputId }) : null;
      if (outputId && !output) throw new Error("输出不存在");
      const file = output ? output.storePath : safeResolveProject(await getProject(url.searchParams.get("project")), url.searchParams.get("path"));
      sendJson(res, await previewFile(file));
      return;
    }

    if (url.pathname === "/api/projects" && req.method === "POST") {
      const body = await readRequestBody(req);
      const project = await addProject(body);
      sendJson(res, { ok: true, project });
      return;
    }

    if (url.pathname === "/api/projects") {
      sendJson(res, { projects: await listProjects() });
      return;
    }

    if (url.pathname === "/api/folders" && req.method === "POST") {
      const folder = await addProjectFolder(await readRequestBody(req));
      sendJson(res, { ok: true, folder });
      return;
    }

    if (url.pathname === "/api/folders" && req.method === "PATCH") {
      const folder = await renameProjectDirectory(await readRequestBody(req));
      sendJson(res, { ok: true, folder });
      return;
    }

    if (url.pathname === "/api/folders") {
      const projectId = url.searchParams.get("project");
      sendJson(res, await listProjectFolders(projectId));
      return;
    }

    if (url.pathname === "/api/move-asset" && req.method === "POST") {
      const body = await readRequestBody(req);
      const result = await moveAsset(body);
      notifyClients("asset-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/batch-move" && req.method === "POST") {
      const result = await batchMoveAssets(await readRequestBody(req));
      if (result.results.length) notifyClients("asset-change");
      sendJson(res, { ok: result.errors.length === 0, ...result });
      return;
    }

    if (url.pathname === "/api/batch-mark" && req.method === "POST") {
      const result = await batchMarkAssets(await readRequestBody(req));
      sendJson(res, { ok: result.errors.length === 0, ...result });
      return;
    }

    if (url.pathname === "/api/trash-assets" && req.method === "POST") {
      const result = await trashAssets(await readRequestBody(req));
      notifyClients("asset-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/restore-trash" && req.method === "POST") {
      const result = await restoreTrashedAssets(await readRequestBody(req));
      notifyClients("asset-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/config") {
      sendJson(res, await loadConfig());
      return;
    }

    if (url.pathname === "/api/rhythm-control/status") {
      sendJson(res, await rhythmControlStatus(url.searchParams.get("project") || ""));
      return;
    }

    if (url.pathname === "/api/rhythm-control/create" && req.method === "POST") {
      const body = await readRequestBody(req);
      const track = await createRhythmControlTrack(body);
      notifyClients("rhythm-control-change");
      sendJson(res, { ok: true, track });
      return;
    }

    if (url.pathname === "/api/generation/status") {
      sendJson(res, await generationPipeline.status());
      return;
    }

    if (url.pathname === "/api/generation/bindings" && req.method === "GET") {
      sendJson(res, { bindings: await generationPipeline.listBindings() });
      return;
    }

    if (url.pathname === "/api/generation/bindings" && req.method === "POST") {
      const body = await readRequestBody(req);
      const binding = await generationPipeline.bindThread(body, await loadConfig());
      notifyClients("generation-change");
      sendJson(res, { ok: true, binding });
      return;
    }

    if (url.pathname === "/api/generation/bindings" && req.method === "DELETE") {
      const body = await readRequestBody(req);
      const result = await generationPipeline.unbindThread(body.threadId || url.searchParams.get("threadId") || "");
      notifyClients("generation-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/generation/tickets" && req.method === "GET") {
      sendJson(res, {
        tickets: await generationPipeline.list({
          limit: url.searchParams.get("limit") || 100,
          status: url.searchParams.get("status") || ""
        })
      });
      return;
    }

    if (url.pathname === "/api/generation/tickets" && req.method === "POST") {
      const body = await readRequestBody(req);
      const ticket = await generationPipeline.create(body, await loadConfig());
      notifyClients("generation-change");
      sendJson(res, { ok: true, ticket });
      return;
    }

    const generationMatch = url.pathname.match(/^\/api\/generation\/tickets\/([^/]+)\/(arm|generated|attach|cancel)$/);
    if (generationMatch && req.method === "POST") {
      const [, rawTicketId, action] = generationMatch;
      const ticketId = decodeURIComponent(rawTicketId);
      const body = await readRequestBody(req);
      const config = await loadConfig();
      let result;
      if (action === "arm") {
        result = await generationPipeline.arm(ticketId, {
          sourcePath: body.sourcePath || config.automation.inbox.sourcePath,
          expectedName: body.expectedName || ""
        });
      } else if (action === "generated") {
        result = await generationPipeline.markGenerated(ticketId, body);
      } else if (action === "attach") {
        result = await generationPipeline.attach(ticketId, body, config);
      } else {
        result = await generationPipeline.cancel(ticketId, body.reason || "");
      }
      notifyClients("generation-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/automation/status") {
      const config = await loadConfig();
      sendJson(res, await downloadAutomation.status(config.automation, config.projects));
      return;
    }

    if (url.pathname === "/api/automation/settings" && req.method === "POST") {
      const body = await readRequestBody(req);
      const automation = await saveAutomationSettings(body);
      sendJson(res, { ok: true, automation });
      return;
    }

    if (url.pathname === "/api/automation/active-profile" && req.method === "POST") {
      const body = await readRequestBody(req);
      const { saved, result: profile } = await updateConfig((config) => {
        const selected = config.automation.routing.profiles.find((item) => item.id === body.profileId);
        if (!selected) throw new Error("当前下载项目不存在");
        config.automation.routing.activeProfileId = selected.id;
        return selected;
      });
      notifyClients("automation-change");
      sendJson(res, { ok: true, activeProfileId: profile.id, profile, automation: saved.automation });
      return;
    }

    if (url.pathname === "/api/automation/organizer/preview" && req.method === "POST") {
      const body = await readRequestBody(req);
      const config = await loadConfig();
      sendJson(res, await downloadAutomation.previewOrganizer(body.automation || config.automation, config.projects));
      return;
    }

    if (url.pathname === "/api/automation/organizer/run" && req.method === "POST") {
      const body = await readRequestBody(req);
      const config = await loadConfig();
      const result = await withAutomationLock(() => downloadAutomation.runOrganizer(body.automation || config.automation, config.projects));
      if (result.imported.length) notifyClients("automation-change");
      sendJson(res, result);
      return;
    }

    if (url.pathname === "/api/automation/cleanup/preview" && req.method === "POST") {
      const body = await readRequestBody(req);
      const config = await loadConfig();
      sendJson(res, await downloadAutomation.previewCleanup(body.automation || config.automation));
      return;
    }

    if (url.pathname === "/api/automation/cleanup/run" && req.method === "POST") {
      const body = await readRequestBody(req);
      const config = await loadConfig();
      if (!config.automation.cleanup.dryRun && body.confirm !== true) {
        throw new Error("实际清理需要再次确认");
      }
      const result = await withAutomationLock(() => downloadAutomation.runCleanup(config.automation));
      if (result.quarantined?.length || result.purged?.length) notifyClients("automation-change");
      sendJson(res, result);
      return;
    }

    if (url.pathname === "/api/toggle-enabled" && req.method === "POST") {
      const body = await readRequestBody(req);
      const enabled = Boolean(body.enabled);
      await updateConfig((config) => { config.enabled = enabled; });
      notifyClients("config-change");
      sendJson(res, { ok: true, enabled });
      return;
    }

    if (url.pathname === "/api/cases") {
      const projectId = url.searchParams.get("project");
      const project = await getProject(projectId);
      sendJson(res, { projectRoot: project.path, project, cases: await listCases(project.id) });
      return;
    }

    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      res.write(`event: connected\n`);
      res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (url.pathname === "/api/assets") {
      const projectId = url.searchParams.get("project");
      const caseId = url.searchParams.get("case");
      if (!caseId) return sendJson(res, { error: "Missing case" }, 400);
      const project = await getProject(projectId);
      sendJson(res, { projectId: project.id, caseId, assets: await listAssets(project.id, caseId) });
      return;
    }

    if (url.pathname === "/api/mark" && req.method === "POST") {
      const body = await readRequestBody(req);
      const result = await markAsset(body);
      sendJson(res, { ok: true, meta: result.meta, previous: result.previous });
      return;
    }

    if (url.pathname === "/api/reveal" && req.method === "POST") {
      const body = await readRequestBody(req);
      const managed = body.outputId
        ? await findManagedOutput({ outputId: body.outputId })
        : await findManagedOutput({ projectId: body.projectId, relativePath: body.path });
      if (managed) {
        openFinder(managed.storePath, true);
        sendJson(res, { ok: true, outputId: managed.outputId });
        return;
      }
      const project = await getProject(body.projectId);
      const target = safeResolveProject(project, body.path);
      openFinder(target, true);
      sendJson(res, { ok: true });
      return;
    }

    if (url.pathname === "/api/open-folder" && req.method === "POST") {
      const body = await readRequestBody(req);
      const managed = body.outputId
        ? await findManagedOutput({ outputId: body.outputId })
        : await findManagedOutput({ projectId: body.projectId, relativePath: body.path });
      if (managed) {
        openFinder(path.dirname(managed.storePath), false);
        sendJson(res, { ok: true, outputId: managed.outputId });
        return;
      }
      const project = await getProject(body.projectId);
      const target = safeResolveProject(project, body.path);
      openFinder(path.dirname(target), false);
      sendJson(res, { ok: true });
      return;
    }

    if (url.pathname === "/media" || url.pathname === "/download") {
      const outputId = String(url.searchParams.get("output") || "").trim();
      if (outputId) {
        const managed = await findManagedOutput({ outputId });
        if (!managed) throw new Error("输出不存在");
        await serveFile(req, res, managed.storePath, url.pathname === "/download");
        return;
      }
      const projectId = url.searchParams.get("project");
      const project = await getProject(projectId);
      const requested = url.searchParams.get("path");
      const filePath = safeResolveProject(project, requested);
      await serveFile(req, res, filePath, url.pathname === "/download");
      return;
    }

    if (url.pathname === "/asset-classification.js") {
      await serveFile(req, res, path.join(__dirname, "asset-classification.js"));
      return;
    }
    let staticPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = safeResolvePublic(staticPath);
    if (!await exists(filePath)) {
      sendText(res, "Not found", 404);
      return;
    }
    await serveFile(req, res, filePath, false, "", true);
  } catch (error) {
    sendJson(res, { error: error.message || String(error) }, 500);
  }
});

await workspaceGovernance.ensureReleaseBaseline("自动模块基线").catch((error) => {
  console.warn("Workspace module baseline:", error.message);
});

async function runWorkspaceCacheCleanup() {
  try {
    const result = await workspaceGovernance.autoCleanupCaches();
    if (result.removedFiles > 0) {
      console.log(`Workspace cache cleanup: ${result.removedFiles} files, ${result.removedBytes} bytes`);
      notifyClients("workspace-governance-change");
    }
  } catch (error) {
    console.warn("Workspace cache cleanup:", error.message);
  }
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Generation asset workbench running at http://127.0.0.1:${port}`);
  console.log(`Config: ${configPath}`);
});

ensureWatchers();

setTimeout(runDuplicateSweep, 8000).unref();
setInterval(runDuplicateSweep, 6 * 60 * 60 * 1000).unref();
setTimeout(runWorkspaceCacheCleanup, 30000).unref();
setInterval(runWorkspaceCacheCleanup, 6 * 60 * 60 * 1000).unref();
setTimeout(checkAutomationSchedule, 3000).unref();
setInterval(checkAutomationSchedule, 5000).unref();

setInterval(() => {
  for (const client of sseClients) {
    client.write(`event: ping\n`);
    client.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  }
}, 30000).unref();
