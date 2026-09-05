import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_POLICIES = Object.freeze({
  schemaVersion: 1,
  tiers: {
    cache: {
      label: "临时缓存",
      mutable: true,
      autoCleanup: true,
      maxAgeDays: 7,
      maxBytes: 512 * 1024 * 1024,
      description: "可以重新生成；只清理由工作台明确拥有的缓存目录。"
    },
    active: {
      label: "活动工作区",
      mutable: true,
      autoCleanup: false,
      snapshotLimit: 20,
      description: "允许修改；关键变更前建立恢复点。"
    },
    archive: {
      label: "受保护内容",
      mutable: true,
      autoCleanup: false,
      description: "只接受用户明确操作；不参与任何自动清理。"
    },
    system: {
      label: "系统与模块",
      mutable: false,
      autoCleanup: false,
      description: "记录版本与哈希；更新失败时按模块回滚。"
    }
  }
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeId(value, fallback = "item") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
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

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  const backup = `${filePath}.${process.pid}.${randomUUID()}.bak`;
  let backedUp = false;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
    if (await exists(filePath)) {
      await fs.rename(filePath, backup);
      backedUp = true;
    }
    await fs.rename(temporary, filePath);
    if (backedUp) await fs.rm(backup, { force: true });
  } catch (error) {
    if (backedUp && !await exists(filePath)) await fs.rename(backup, filePath).catch(() => {});
    throw error;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
    await fs.rm(backup, { force: true }).catch(() => {});
  }
}

async function directoryUsage(root) {
  if (!await exists(root)) return { bytes: 0, files: 0 };
  const stack = [root];
  let bytes = 0;
  let files = 0;
  while (stack.length) {
    const directory = stack.pop();
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const stat = await fs.stat(fullPath).catch(() => null);
        if (stat) {
          bytes += stat.size;
          files += 1;
        }
      }
    }
  }
  return { bytes, files };
}

async function cacheFileInventory(root) {
  if (!await exists(root)) return [];
  const files = [];
  const stack = [path.resolve(root)];
  while (stack.length) {
    const directory = stack.pop();
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (!isInside(root, fullPath) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const stat = await fs.stat(fullPath).catch(() => null);
        if (stat?.isFile()) files.push({ path: fullPath, bytes: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  }
  return files;
}

async function removeEmptyCacheDirectories(root) {
  const directories = [];
  const stack = [path.resolve(root)];
  while (stack.length) {
    const directory = stack.pop();
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (!isInside(root, fullPath)) continue;
      directories.push(fullPath);
      stack.push(fullPath);
    }
  }
  directories.sort((a, b) => b.length - a.length);
  for (const directory of directories) await fs.rmdir(directory).catch(() => {});
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function copyVerified(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const backup = `${destination}.${process.pid}.${randomUUID()}.bak`;
  let backedUp = false;
  try {
    await fs.copyFile(source, temporary);
    const [sourceHash, copiedHash] = await Promise.all([hashFile(source), hashFile(temporary)]);
    if (sourceHash !== copiedHash) throw new Error(`恢复点校验失败：${path.basename(source)}`);
    if (await exists(destination)) {
      await fs.rename(destination, backup);
      backedUp = true;
    }
    await fs.rename(temporary, destination);
    if (backedUp) await fs.rm(backup, { force: true });
    return sourceHash;
  } catch (error) {
    if (backedUp && !await exists(destination)) await fs.rename(backup, destination).catch(() => {});
    throw error;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
    await fs.rm(backup, { force: true }).catch(() => {});
  }
}

export class WorkspaceGovernance {
  constructor({ root, stateFiles = [], moduleFiles = [], cacheRoots = [] }) {
    if (!root) throw new Error("Workspace governance root is required");
    this.root = path.resolve(root);
    this.policiesPath = path.join(this.root, "policies.json");
    this.snapshotsRoot = path.join(this.root, "snapshots");
    this.journalRoot = path.join(this.root, "journal");
    this.cacheRoot = path.join(this.root, "cache");
    this.stateFiles = stateFiles.map((item) => ({ ...item, path: path.resolve(item.path) }));
    this.moduleFiles = moduleFiles.map((item) => ({ ...item, path: path.resolve(item.path) }));
    this.cacheRoots = [
      { id: "governance-cache", label: "工作台缓存", path: this.cacheRoot, owned: true },
      ...cacheRoots.map((item) => ({ ...item, path: path.resolve(item.path) }))
    ];
    this.queue = Promise.resolve();
  }

  async initialize() {
    await Promise.all([
      fs.mkdir(this.snapshotsRoot, { recursive: true }),
      fs.mkdir(this.journalRoot, { recursive: true }),
      fs.mkdir(this.cacheRoot, { recursive: true })
    ]);
    if (!await exists(this.policiesPath)) await atomicWriteJson(this.policiesPath, DEFAULT_POLICIES);
  }

  async policies() {
    await this.initialize();
    try {
      const current = JSON.parse((await fs.readFile(this.policiesPath, "utf8")).replace(/^\uFEFF/, ""));
      return {
        ...clone(DEFAULT_POLICIES),
        ...current,
        tiers: { ...clone(DEFAULT_POLICIES.tiers), ...(current.tiers || {}) }
      };
    } catch {
      return clone(DEFAULT_POLICIES);
    }
  }

  enqueue(operation) {
    const next = this.queue.then(operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async record(action, detail = {}) {
    await this.initialize();
    const at = new Date();
    const entry = {
      schemaVersion: 1,
      id: randomUUID(),
      at: at.toISOString(),
      action: String(action || "unknown").slice(0, 120),
      detail
    };
    const segment = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}.jsonl`;
    await fs.appendFile(path.join(this.journalRoot, segment), JSON.stringify(entry) + "\n", "utf8");
    return entry;
  }

  async recentHistory(limit = 40) {
    await this.initialize();
    const files = (await fs.readdir(this.journalRoot).catch(() => []))
      .filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name))
      .sort()
      .reverse();
    const entries = [];
    for (const name of files) {
      const lines = (await fs.readFile(path.join(this.journalRoot, name), "utf8").catch(() => ""))
        .trim().split(/\r?\n/).filter(Boolean).reverse();
      for (const line of lines) {
        try { entries.push(JSON.parse(line)); } catch { /* keep the rest of the append-only journal readable */ }
        if (entries.length >= Math.max(1, Math.min(200, Number(limit) || 40))) return entries;
      }
    }
    return entries;
  }

  async listSnapshots() {
    await this.initialize();
    const entries = await fs.readdir(this.snapshotsRoot, { withFileTypes: true }).catch(() => []);
    const snapshots = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(this.snapshotsRoot, entry.name, "manifest.json"), "utf8"));
        snapshots.push(manifest);
      } catch { /* ignore incomplete snapshot directories */ }
    }
    return snapshots.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async pruneSnapshots(limit) {
    const snapshots = await this.listSnapshots();
    for (const snapshot of snapshots.slice(Math.max(1, Number(limit) || 20))) {
      const candidate = path.join(this.snapshotsRoot, safeId(snapshot.id));
      if (isInside(this.snapshotsRoot, candidate)) await fs.rm(candidate, { recursive: true, force: true });
    }
  }

  async createSnapshot({ label = "手动恢复点", reason = "manual", includeModules = false } = {}) {
    return this.enqueue(() => this.createSnapshotUnlocked({ label, reason, includeModules }));
  }

  async createSnapshotUnlocked({ label = "手动恢复点", reason = "manual", includeModules = false, prune = true } = {}) {
      await this.initialize();
      const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
      const snapshotRoot = path.join(this.snapshotsRoot, id);
      const candidates = [
        ...this.stateFiles.map((item) => ({ ...item, tier: "active" })),
        ...(includeModules ? this.moduleFiles.map((item) => ({ ...item, tier: "system" })) : [])
      ];
      const files = [];
      try {
        for (const item of candidates) {
          if (!await exists(item.path)) continue;
          const stat = await fs.stat(item.path);
          if (!stat.isFile()) continue;
          const storedName = `${safeId(item.component || item.tier)}--${safeId(item.id || path.basename(item.path))}`;
          const storedPath = path.join(snapshotRoot, "files", storedName);
          const sha256 = await copyVerified(item.path, storedPath);
          files.push({
            id: item.id || storedName,
            label: item.label || item.id || path.basename(item.path),
            component: item.component || item.tier,
            tier: item.tier,
            originalPath: item.path,
            storedPath: path.relative(snapshotRoot, storedPath),
            bytes: stat.size,
            sha256
          });
        }
        const moduleFingerprint = includeModules
          ? createHash("sha256").update(files.filter((item) => item.tier === "system").map((item) => `${item.id}:${item.sha256}`).sort().join("\n")).digest("hex")
          : "";
        const manifest = {
          schemaVersion: 1,
          id,
          label: String(label || "手动恢复点").slice(0, 100),
          reason: String(reason || "manual").slice(0, 100),
          createdAt: new Date().toISOString(),
          includesModules: Boolean(includeModules),
          moduleFingerprint,
          files
        };
        await atomicWriteJson(path.join(snapshotRoot, "manifest.json"), manifest);
        if (prune) {
          const policies = await this.policies();
          await this.pruneSnapshots(policies.tiers.active.snapshotLimit);
        }
        await this.record("snapshot.created", { id, label: manifest.label, files: files.length, includeModules: Boolean(includeModules) });
        return manifest;
      } catch (error) {
        await fs.rm(snapshotRoot, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
  }

  async ensureReleaseBaseline(label = "当前工作台模块") {
    return this.enqueue(async () => {
      await this.initialize();
      const current = [];
      for (const item of this.moduleFiles) {
        if (!await exists(item.path)) continue;
        const stat = await fs.stat(item.path).catch(() => null);
        if (!stat?.isFile()) continue;
        current.push(`${item.id}:${await hashFile(item.path)}`);
      }
      const fingerprint = createHash("sha256").update(current.sort().join("\n")).digest("hex");
      const snapshots = await this.listSnapshots();
      const matching = snapshots.find((item) => item.includesModules && item.moduleFingerprint === fingerprint);
      if (matching) return { created: false, snapshot: matching };
      const snapshot = await this.createSnapshotUnlocked({ label, reason: "module-baseline", includeModules: true });
      return { created: true, snapshot };
    });
  }

  async restoreSnapshot(id, { components = ["state"] } = {}) {
    return this.enqueue(async () => {
      await this.initialize();
      const snapshotId = safeId(id, "");
      if (!snapshotId || snapshotId !== id) throw new Error("恢复点编号无效");
      const snapshotRoot = path.join(this.snapshotsRoot, snapshotId);
      if (!isInside(this.snapshotsRoot, snapshotRoot)) throw new Error("恢复点路径无效");
      const manifest = JSON.parse(await fs.readFile(path.join(snapshotRoot, "manifest.json"), "utf8"));
      const allowedComponents = new Set((components || ["state"]).map(String));
      const restorable = (manifest.files || []).filter((item) => item.tier === "active" && (allowedComponents.has("state") || allowedComponents.has(item.component)));
      if (!restorable.length) throw new Error("这个恢复点没有可恢复的活动数据");

      const safety = await this.createSnapshotUnlocked({ label: `恢复 ${manifest.label} 前`, reason: "pre-restore", includeModules: false, prune: false });
      const prepared = [];
      for (const item of restorable) {
        const registered = this.stateFiles.find((candidate) => candidate.id === item.id && candidate.path === path.resolve(item.originalPath));
        if (!registered) throw new Error(`恢复点包含未登记的数据：${item.label}`);
        const source = path.resolve(snapshotRoot, item.storedPath);
        if (!isInside(snapshotRoot, source)) throw new Error("恢复点文件路径无效");
        if (await hashFile(source) !== item.sha256) throw new Error(`恢复点已损坏：${item.label}`);
        prepared.push({ item, registered, source });
      }
      const restored = [];
      try {
        for (const { item, registered, source } of prepared) {
          await copyVerified(source, registered.path);
          restored.push(item.id);
        }
      } catch (error) {
        const safetyRoot = path.join(this.snapshotsRoot, safety.id);
        for (const id of restored.reverse()) {
          const safetyItem = safety.files.find((item) => item.tier === "active" && item.id === id);
          const registered = this.stateFiles.find((candidate) => candidate.id === id);
          if (safetyItem && registered) await copyVerified(path.join(safetyRoot, safetyItem.storedPath), registered.path).catch(() => {});
        }
        await this.record("snapshot.restore-failed", { id: snapshotId, restoredBeforeFailure: restored, safetySnapshotId: safety.id });
        throw error;
      }
      const policies = await this.policies();
      await this.pruneSnapshots(policies.tiers.active.snapshotLimit);
      await this.record("snapshot.restored", { id: snapshotId, restored, safetySnapshotId: safety.id });
      return { snapshotId, restored, safetySnapshotId: safety.id, restartRecommended: true };
    });
  }

  async restoreModules(id, { components = [] } = {}) {
    return this.enqueue(async () => {
      await this.initialize();
      const snapshotId = safeId(id, "");
      if (!snapshotId || snapshotId !== id) throw new Error("恢复点编号无效");
      const allowedComponents = new Set((components || []).map(String).filter(Boolean));
      if (!allowedComponents.size) throw new Error("请选择要回滚的工作台模块");
      const snapshotRoot = path.join(this.snapshotsRoot, snapshotId);
      if (!isInside(this.snapshotsRoot, snapshotRoot)) throw new Error("恢复点路径无效");
      const manifest = JSON.parse(await fs.readFile(path.join(snapshotRoot, "manifest.json"), "utf8"));
      const restorable = (manifest.files || []).filter((item) => item.tier === "system" && allowedComponents.has(item.component));
      if (!restorable.length) throw new Error("这个恢复点没有对应的模块版本");

      const safety = await this.createSnapshotUnlocked({ label: `回滚 ${[...allowedComponents].join("+")} 前`, reason: "pre-module-restore", includeModules: true, prune: false });
      const prepared = [];
      for (const item of restorable) {
        const registered = this.moduleFiles.find((candidate) => candidate.id === item.id && candidate.path === path.resolve(item.originalPath));
        if (!registered || !allowedComponents.has(registered.component)) throw new Error(`恢复点包含未登记的模块：${item.label}`);
        const source = path.resolve(snapshotRoot, item.storedPath);
        if (!isInside(snapshotRoot, source)) throw new Error("恢复点文件路径无效");
        if (await hashFile(source) !== item.sha256) throw new Error(`恢复点已损坏：${item.label}`);
        prepared.push({ item, registered, source });
      }
      const restored = [];
      try {
        for (const { item, registered, source } of prepared) {
          await copyVerified(source, registered.path);
          restored.push(item.id);
        }
      } catch (error) {
        const safetyRoot = path.join(this.snapshotsRoot, safety.id);
        for (const id of restored.reverse()) {
          const safetyItem = safety.files.find((item) => item.tier === "system" && item.id === id);
          const registered = this.moduleFiles.find((candidate) => candidate.id === id);
          if (safetyItem && registered) await copyVerified(path.join(safetyRoot, safetyItem.storedPath), registered.path).catch(() => {});
        }
        await this.record("module.restore-failed", { id: snapshotId, components: [...allowedComponents], restoredBeforeFailure: restored, safetySnapshotId: safety.id });
        throw error;
      }
      const policies = await this.policies();
      await this.pruneSnapshots(policies.tiers.active.snapshotLimit);
      await this.record("module.restored", { id: snapshotId, components: [...allowedComponents], restored, safetySnapshotId: safety.id });
      return { snapshotId, components: [...allowedComponents], restored, safetySnapshotId: safety.id, restartRequired: allowedComponents.has("backend") };
    });
  }

  async clearCaches() {
    return this.enqueue(async () => {
      await this.initialize();
      const cleared = [];
      for (const item of this.cacheRoots) {
        if (!item.owned) continue;
        const target = path.resolve(item.path);
        if (target === path.parse(target).root) throw new Error("拒绝清理磁盘根目录");
        if (item.id === "governance-cache" && !isInside(this.root, target)) throw new Error("工作台缓存路径无效");
        const before = await directoryUsage(target);
        await fs.rm(target, { recursive: true, force: true });
        await fs.mkdir(target, { recursive: true });
        cleared.push({ id: item.id, label: item.label, ...before });
      }
      await this.record("cache.cleared", { cleared });
      return { cleared };
    });
  }

  async autoCleanupCaches({ now = Date.now() } = {}) {
    return this.enqueue(async () => {
      await this.initialize();
      const policies = await this.policies();
      const policy = policies.tiers.cache || {};
      if (policy.autoCleanup !== true) return { enabled: false, removedFiles: 0, removedBytes: 0, reasons: {} };

      const maxAgeDays = Math.max(1, Number(policy.maxAgeDays) || 7);
      const maxBytes = Math.max(1, Number(policy.maxBytes) || 512 * 1024 * 1024);
      const cutoff = Number(now) - maxAgeDays * 24 * 60 * 60 * 1000;
      const inventory = [];
      const ownedRoots = [];

      for (const item of this.cacheRoots) {
        if (!item.owned) continue;
        const root = path.resolve(item.path);
        if (root === path.parse(root).root) throw new Error("拒绝自动清理磁盘根目录");
        if (item.id === "governance-cache" && !isInside(this.root, root)) throw new Error("工作台缓存路径无效");
        ownedRoots.push({ ...item, path: root });
        for (const file of await cacheFileInventory(root)) inventory.push({ ...file, rootId: item.id });
      }

      const removed = new Set();
      const reasons = { expired: 0, capacity: 0 };
      let removedBytes = 0;
      const remove = async (file, reason) => {
        if (removed.has(file.path)) return;
        await fs.rm(file.path, { force: true });
        removed.add(file.path);
        removedBytes += file.bytes;
        reasons[reason] += 1;
      };

      for (const file of inventory.filter((item) => item.mtimeMs < cutoff)) await remove(file, "expired");

      const retained = inventory.filter((item) => !removed.has(item.path)).sort((a, b) => a.mtimeMs - b.mtimeMs);
      let retainedBytes = retained.reduce((sum, item) => sum + item.bytes, 0);
      for (const file of retained) {
        if (retainedBytes <= maxBytes) break;
        await remove(file, "capacity");
        retainedBytes -= file.bytes;
      }

      for (const item of ownedRoots) await removeEmptyCacheDirectories(item.path);
      const result = {
        enabled: true,
        checkedFiles: inventory.length,
        removedFiles: removed.size,
        removedBytes,
        retainedBytes,
        reasons,
        maxAgeDays,
        maxBytes
      };
      if (result.removedFiles > 0) await this.record("cache.auto-cleaned", result);
      return result;
    });
  }

  async status({ archives = [] } = {}) {
    await this.initialize();
    const policies = await this.policies();
    const cacheItems = [];
    for (const item of this.cacheRoots) cacheItems.push({ id: item.id, label: item.label, owned: Boolean(item.owned), ...(await directoryUsage(item.path)) });

    const activeItems = [];
    for (const item of this.stateFiles) {
      const stat = await fs.stat(item.path).catch(() => null);
      activeItems.push({
        id: item.id,
        label: item.label,
        component: item.component || "state",
        exists: Boolean(stat?.isFile()),
        bytes: stat?.isFile() ? stat.size : 0,
        modifiedAt: stat?.isFile() ? stat.mtime.toISOString() : null
      });
    }

    const modules = [];
    for (const item of this.moduleFiles) {
      const stat = await fs.stat(item.path).catch(() => null);
      modules.push({
        id: item.id,
        label: item.label,
        component: item.component || "runtime",
        exists: Boolean(stat?.isFile()),
        bytes: stat?.isFile() ? stat.size : 0,
        modifiedAt: stat?.isFile() ? stat.mtime.toISOString() : null,
        sha256: stat?.isFile() ? await hashFile(item.path) : ""
      });
    }

    const archiveItems = [];
    for (const item of archives) {
      const root = path.resolve(item.path);
      const stat = await fs.stat(root).catch(() => null);
      archiveItems.push({ id: item.id, label: item.label, exists: Boolean(stat?.isDirectory()), protected: true, path: root });
    }

    const snapshots = await this.listSnapshots();
    const history = await this.recentHistory(20);
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      policies,
      tiers: {
        cache: { ...policies.tiers.cache, items: cacheItems, bytes: cacheItems.reduce((sum, item) => sum + item.bytes, 0) },
        active: { ...policies.tiers.active, items: activeItems, bytes: activeItems.reduce((sum, item) => sum + item.bytes, 0), snapshots: snapshots.length },
        archive: { ...policies.tiers.archive, items: archiveItems },
        system: { ...policies.tiers.system, modules }
      },
      snapshots: snapshots.slice(0, 20),
      history
    };
  }
}

export { DEFAULT_POLICIES, atomicWriteJson, directoryUsage, hashFile, isInside };
