export const ASSET_GROUPS = Object.freeze({
  official: "正式资产",
  review: "待确认",
  noise: "干扰项"
});

const aliases = new Map([
  ...["official", "formal", "primary", "final", "production", "deliverable", "generated", "managed", "正式", "正式资产", "生成资产", "成片", "最终"].map((value) => [value, "official"]),
  ...["review", "confirm", "pending", "unsure", "draft", "待确认", "待判断", "待审核", "草稿"].map((value) => [value, "review"]),
  ...["noise", "interference", "junk", "trash", "干扰", "干扰项", "噪声", "缓存", "过程文件"].map((value) => [value, "noise"])
]);

function values(value) {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") return Object.values(value).flatMap(values);
  return String(value || "").split(/[,，;；|/\s]+/).map((item) => item.trim()).filter(Boolean);
}

function groupFrom(value) {
  const matches = new Set(values(value).map((item) => aliases.get(item.replace(/^#/, "").toLocaleLowerCase("zh-CN"))).filter(Boolean));
  if (matches.size === 1) return [...matches][0];
  return matches.size > 1 ? "conflict" : "";
}

function result(group, source, confidence, reason) {
  return { group, label: ASSET_GROUPS[group], source, confidence, reason };
}

function manualResult(asset) {
  for (const [field, label] of [["smartGroup", "人工 smartGroup"], ["category", "人工 category"], ["tags", "人工 tags"]]) {
    const group = groupFrom(asset[field]);
    if (!group) continue;
    if (group === "conflict") return result("review", label, "高", `${field} 中存在相互冲突的人工分组标记`);
    return result(group, label, "高", `${field} 明确标记为“${ASSET_GROUPS[group]}”`);
  }
  return null;
}

function serverResult(asset) {
  const classification = asset.classification || asset.assetClassification;
  if (!classification || typeof classification !== "object") return null;
  const group = groupFrom(classification.group || classification.label);
  if (!group || group === "conflict") return null;
  const numericConfidence = Number(classification.confidence);
  const confidence = Number.isFinite(numericConfidence)
    ? numericConfidence >= .8 ? "高" : numericConfidence >= .5 ? "中" : "低"
    : { high: "高", medium: "中", low: "低" }[String(classification.confidence || "").toLowerCase()] || classification.confidence || "中";
  return result(
    group,
    classification.source || "服务端分类",
    confidence,
    classification.reason || "服务端提供了资产分类"
  );
}

export function classifyAsset(asset = {}) {
  const registered = asset.managed && asset.classification?.source === "registry" ? serverResult(asset) : null;
  if (registered) return registered;
  const manual = manualResult(asset);
  if (manual) return manual;
  const server = serverResult(asset);
  if (server) return server;

  const kind = String(asset.kind || "").toLowerCase();
  const category = String(asset.category || "").toLowerCase();
  const path = [asset.caseId, asset.caseRelPath, asset.relPath, asset.dir, asset.name]
    .filter(Boolean).join("/").replaceAll("\\", "/").toLowerCase();

  if (/(^|\/)(?:thumbs\.db|desktop\.ini|\.ds_store)$/.test(path)
      || /\.(?:tmp|part|crdownload|bak|log)$/i.test(path)
      || /(^|\/)(?:cache|caches|temp|tmp|proxy|proxies|waveforms?)(\/|$)/.test(path)) {
    return result("noise", "文件规则", "高", "路径或扩展名表明它是缓存、代理或未完成文件");
  }

  const explicitOutput = /(^|\/)(?:成片|最终|交付|生成视频|finals?|masters?|deliverables?|exports?|outputs?|video[_-]?results?)(\/|$)/.test(path);
  if (explicitOutput) return result("official", "目录规则", "高", "位于明确的成片、交付或生成结果目录");

  const processMedia = /(^|\/)(?:drafts?|process|working|preview|reverse|frame[_-]?extract|recordings?)(\/|$)/.test(path);
  if (["video", "audio"].includes(kind) && processMedia) {
    return result("review", "媒体规则", "中", "过程性音视频需人工确认用途，未自动视为正式资产");
  }
  if (["video", "audio"].includes(kind)) {
    return result("review", "媒体规则", "低", "没有人工分组或明确成片目录的音视频，默认进入待确认");
  }

  if (["generatedasset", "reference", "reverse", "videoresult"].includes(category)
      || ["frame", "contact"].includes(kind)
      || /(^|\/)(?:assets?|参考|图片|images?|stills?|frames?)(\/|$)/.test(path)) {
    return result("official", "资产目录规则", "中", "位于已识别的图片、参考或抽帧资产目录");
  }

  return result("review", "保守默认", "低", "缺少人工分组和可验证的资产目录信号");
}
