import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

const mjNamePattern = /^u(?<userId>\d+)__(?<payload>.*?)_(?<jobId>[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})_(?<variant>\d+)\.(?<ext>png|jpe?g|webp)$/iu;

function aspectLabel(value) {
  const compact = String(value || "").replace(/[^0-9]/g, "");
  return ({ "11": "1:1", "169": "16:9", "916": "9:16", "43": "4:3", "34": "3:4", "32": "3:2", "23": "2:3" })[compact]
    || String(value || "").replace(/_/g, ":");
}

function parameterParts(payload) {
  const firstParameter = payload.search(/(?:^|_)--[a-z][a-z0-9-]*_/iu);
  const prompt = firstParameter < 0 ? payload : payload.slice(0, firstParameter).replace(/_+$/u, "");
  const parameterText = firstParameter < 0 ? "" : payload.slice(firstParameter).replace(/^_+/u, "");
  const parameters = {};
  for (const segment of parameterText.split(/_(?=--[a-z][a-z0-9-]*_)/iu)) {
    const match = segment.match(/^--([a-z][a-z0-9-]*)_(.*)$/iu);
    if (match) parameters[match[1].toLowerCase()] = match[2].replace(/_+$/u, "");
  }
  return {
    prompt: prompt.replace(/_+/g, " ").trim(),
    parameters
  };
}

export function parseMidjourneyFilename(fileName) {
  const name = path.basename(String(fileName || ""));
  const match = name.match(mjNamePattern);
  if (!match?.groups) return null;
  const { prompt, parameters } = parameterParts(match.groups.payload);
  const profileValue = parameters.profile || parameters.p || "";
  const profiles = profileValue.split("_").map((item) => item.trim()).filter((item) => /^[a-z0-9]+$/iu.test(item));
  const aspect = aspectLabel(parameters.ar || "");
  const lead = prompt || (profiles.length ? `P值 ${profiles[0]}` : "Midjourney 图片");
  return {
    name,
    userId: match.groups.userId,
    jobId: match.groups.jobId.toLowerCase(),
    variant: Number(match.groups.variant),
    extension: `.${match.groups.ext.toLowerCase().replace("jpeg", "jpg")}`,
    prompt,
    parameters,
    profiles,
    aspect,
    label: `${lead.slice(0, 52)} · #${Number(match.groups.variant) + 1}`
  };
}

async function fileHash(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function cleanStem(value, fallback = "MJ") {
  const stem = String(value || "").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/^[.\s-]+|[.\s-]+$/g, "");
  return stem || fallback;
}

function normalizeProfile(input, existing = {}) {
  const code = String(input.code || "").trim();
  if (!/^[a-z0-9]{3,80}$/iu.test(code)) throw new Error("P值只能包含 3–80 位字母或数字");
  return {
    id: existing.id || String(input.id || randomUUID()),
    code,
    name: String(input.name || "").trim().slice(0, 80),
    tags: Array.isArray(input.tags)
      ? input.tags.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20)
      : String(input.tags || "").split(/[，,、]/u).map((item) => item.trim()).filter(Boolean).slice(0, 20),
    rating: Math.max(0, Math.min(5, Number(input.rating) || 0)),
    source: String(input.source || "").trim().slice(0, 120),
    note: String(input.note || "").trim().slice(0, 1000),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export class MidjourneyWorkspace {
  constructor({ downloadsPath, registryPath }) {
    this.downloadsPath = path.resolve(downloadsPath);
    this.registryPath = path.resolve(registryPath);
    this.updateQueue = Promise.resolve();
  }

  async readRegistry() {
    try {
      const data = JSON.parse((await fs.readFile(this.registryPath, "utf8")).replace(/^\uFEFF/u, ""));
      return { version: 1, profiles: data.profiles || [], imports: data.imports || [] };
    } catch {
      return { version: 1, profiles: [], imports: [] };
    }
  }

  updateRegistry(mutator) {
    const operation = this.updateQueue.then(async () => {
      const registry = await this.readRegistry();
      const result = await mutator(registry);
      await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
      const temporary = `${this.registryPath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
        await fs.rename(temporary, this.registryPath);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
      return result;
    });
    this.updateQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  sourcePath(fileName) {
    const parsed = parseMidjourneyFilename(fileName);
    if (!parsed || parsed.name !== fileName) throw new Error("这不是可识别的 Midjourney 下载文件");
    const source = path.resolve(this.downloadsPath, parsed.name);
    if (path.dirname(source) !== this.downloadsPath) throw new Error("下载文件路径无效");
    return { source, parsed };
  }

  async listCandidates(limit = 160) {
    let entries = [];
    try {
      entries = await fs.readdir(this.downloadsPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parsed = parseMidjourneyFilename(entry.name);
      if (!parsed) continue;
      const stats = await fs.stat(path.join(this.downloadsPath, entry.name));
      candidates.push({
        ...parsed,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        previewUrl: `/api/midjourney/preview?name=${encodeURIComponent(entry.name)}`
      });
    }
    return candidates.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, Math.max(1, Math.min(500, Number(limit) || 160)));
  }

  async summary() {
    const [registry, candidates] = await Promise.all([this.readRegistry(), this.listCandidates()]);
    const observed = new Map();
    for (const item of [...candidates, ...registry.imports]) {
      for (const code of item.profiles || []) observed.set(code, (observed.get(code) || 0) + 1);
    }
    return {
      downloadsPath: this.downloadsPath,
      candidates,
      profiles: registry.profiles,
      observedProfiles: [...observed].map(([code, count]) => ({ code, count, saved: registry.profiles.some((item) => item.code === code) })),
      imports: registry.imports.slice(-80).reverse()
    };
  }

  async listOutputs({ projectId = "" } = {}) {
    const registry = await this.readRegistry();
    return registry.imports.map((raw) => ({
      ...raw,
      managed: Boolean(raw.storePath),
      outputId: String(raw.outputId || raw.id || ""),
      storePath: raw.storePath ? path.resolve(raw.storePath) : "",
      caseId: raw.caseId || path.dirname(raw.relativePath || "."),
      kind: "image",
      generator: "midjourney"
    })).filter((output) => !projectId || output.projectId === projectId);
  }

  async findOutput(outputId) {
    const id = String(outputId || "").trim();
    if (!id) return null;
    return (await this.listOutputs()).find((output) => output.outputId === id) || null;
  }

  async updateOutput(outputId, mutator) {
    return await this.updateRegistry((registry) => {
      const output = registry.imports.find((item) => String(item.outputId || item.id) === outputId);
      if (!output) throw new Error(`Midjourney 输出不存在：${outputId}`);
      return mutator(output);
    });
  }

  async updateOutputReview(outputId, review) {
    return await this.updateOutput(outputId, (output) => {
      const previous = output.review || {};
      output.review = { ...previous, ...review, updatedAt: new Date().toISOString() };
      return { output, previous };
    });
  }

  async relocateOutput(outputId, { projectId, projectName, relativePath }) {
    return await this.updateOutput(outputId, (output) => {
      const previous = { projectId: output.projectId, projectName: output.projectName, relativePath: output.relativePath, caseId: output.caseId };
      output.projectId = projectId;
      output.projectName = projectName;
      output.relativePath = relativePath;
      output.caseId = path.dirname(relativePath) || ".";
      output.fileName = path.basename(relativePath);
      output.relocationHistory = Array.isArray(output.relocationHistory) ? output.relocationHistory : [];
      output.relocationHistory.push({ ...previous, movedAt: new Date().toISOString(), movedFile: false });
      return { output, previous, movedFile: false };
    });
  }

  async importFiles({ names, projectId, projectName, generatedRoot, targetRelativePath }) {
    const requested = [...new Set(Array.isArray(names) ? names.map(String) : [])];
    if (!requested.length || requested.length > 100) throw new Error("请选择 1–100 张 MJ 图片");
    if (!generatedRoot) throw new Error("未配置生成资产仓");
    const targetRoot = path.join(path.resolve(generatedRoot), "midjourney");
    await fs.mkdir(targetRoot, { recursive: true });
    const imported = [];
    for (const name of requested) {
      const { source, parsed } = this.sourcePath(name);
      const stats = await fs.stat(source);
      if (!stats.isFile()) throw new Error(`下载文件不可用：${name}`);
      const date = new Date(stats.mtime);
      const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
      const subject = parsed.prompt ? cleanStem(parsed.prompt).slice(0, 36) : parsed.profiles[0] ? `P-${parsed.profiles[0]}` : "MJ";
      const outputId = randomUUID();
      const libraryGroup = projectId === "mj-library" ? (parsed.profiles.length ? `P-${parsed.profiles.join("+")}` : "无P值") : "";
      const relativeDirectory = libraryGroup || targetRelativePath || ".";
      const destinationDirectory = path.join(targetRoot, libraryGroup);
      await fs.mkdir(destinationDirectory, { recursive: true });
      const destination = path.join(destinationDirectory, `${outputId}${parsed.extension}`);
      const sha256 = await fileHash(source);
      const temporary = `${destination}.${process.pid}.partial`;
      try {
        await fs.copyFile(source, temporary);
        if (await fileHash(temporary) !== sha256) throw new Error(`跨盘归档校验失败：${name}`);
        await fs.rename(temporary, destination);
      } catch (error) {
        await Promise.all([temporary, destination].map((item) => fs.rm(item, { force: true }).catch(() => {})));
        throw error;
      }
      const logicalName = `${stamp}-${subject}-${parsed.jobId.slice(0, 8)}-${parsed.variant + 1}${parsed.extension}`;
      const record = {
        id: outputId,
        outputId,
        storePath: destination,
        originalName: name,
        fileName: logicalName,
        projectId,
        projectName,
        caseId: relativeDirectory,
        relativePath: path.join(relativeDirectory, logicalName),
        importedAt: new Date().toISOString(),
        sha256,
        prompt: parsed.prompt,
        parameters: parsed.parameters,
        profiles: parsed.profiles,
        aspect: parsed.aspect,
        jobId: parsed.jobId,
        variant: parsed.variant
      };
      try {
        await fs.writeFile(`${destination}.mj.json`, `${JSON.stringify(record, null, 2)}\n`, "utf8");
        await this.updateRegistry((registry) => {
          registry.imports.push(record);
          registry.imports = registry.imports.slice(-1000);
        });
      } catch (error) {
        await Promise.all([destination, `${destination}.mj.json`].map((item) => fs.rm(item, { force: true }).catch(() => {})));
        throw error;
      }
      try {
        await fs.rm(source, { force: false });
      } catch (error) {
        await this.updateRegistry((registry) => {
          registry.imports = registry.imports.filter((item) => String(item.outputId || item.id) !== outputId);
        });
        await Promise.all([destination, `${destination}.mj.json`].map((item) => fs.rm(item, { force: true }).catch(() => {})));
        throw new Error(`源文件删除失败，导入已回滚：${error.message || error}`);
      }
      imported.push(record);
    }
    return imported;
  }

  saveProfile(input) {
    return this.updateRegistry((registry) => {
      const index = registry.profiles.findIndex((item) => item.id === input.id || item.code.toLowerCase() === String(input.code || "").trim().toLowerCase());
      const profile = normalizeProfile(input, index >= 0 ? registry.profiles[index] : {});
      if (registry.profiles.some((item, itemIndex) => itemIndex !== index && item.code.toLowerCase() === profile.code.toLowerCase())) {
        throw new Error("这个 P值已经收藏");
      }
      if (index >= 0) registry.profiles[index] = profile;
      else registry.profiles.unshift(profile);
      return profile;
    });
  }

  deleteProfile(id) {
    return this.updateRegistry((registry) => {
      const index = registry.profiles.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("P值记录不存在");
      return registry.profiles.splice(index, 1)[0];
    });
  }
}
