import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const injectionPath = new URL("../inject/conversation-preview.user.js", import.meta.url);
const injectorPath = new URL("../scripts/injector.mjs", import.meta.url);
const embeddedIndexPath = new URL("../asset-console/public/index.html", import.meta.url);
const embeddedAppPath = new URL("../asset-console/public/app.js", import.meta.url);
const embeddedCssPath = new URL("../asset-console/public/ui-v3.css", import.meta.url);

function extractFunctionSource(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\(`).exec(source);
  assert.ok(match, `${name} is present`);
  const start = match.index;
  const openingBrace = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

test("Asset Console opens with the active Codex task context", async () => {
  const [injection, injector] = await Promise.all([
    readFile(injectionPath, "utf8"),
    readFile(injectorPath, "utf8"),
  ]);
  assert.match(injection, /currentCodexTaskContext/);
  assert.match(injection, /data-app-action-sidebar-thread-id/);
  assert.match(injector, /searchParams\.set\("embed", "codex"\)/);
  assert.match(injector, /searchParams\.set\("threadId", message\.threadId\)/);
  assert.match(injector, /searchParams\.set\("threadTitle", message\.threadTitle\)/);
});

test("assets are added to the composer without submitting the task", async () => {
  const injection = await readFile(injectionPath, "utf8");
  assert.match(injection, /event\.source !== frame\.contentWindow/);
  assert.match(injection, /event\.origin !== "https:\/\/web-sandbox\.oaiusercontent\.com"/);
  const insert = extractFunctionSource(injection, "addAssetReferencesToComposer");
  assert.match(insert, /schema\.nodes\.atMention/);
  assert.match(insert, /controller\.view\.dispatch\(transaction\)/);
  assert.doesNotMatch(insert, /\.click\(|requestSubmit\(|\.submit\(/);
  assert.match(injection, /InputEvent\("input"/);
  assert.match(injection, /isAbsoluteWindowsAssetPath\(assetPath\)/);
  assert.doesNotMatch(injection, /handleAssetConsoleMessage[\s\S]{0,1800}(click\(\)|requestSubmit\(|submit\()/);
});

test("only absolute Windows asset paths cross the iframe-to-composer boundary", async () => {
  const injection = await readFile(injectionPath, "utf8");
  const source = injection.match(/function isAbsoluteWindowsAssetPath\(value\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source, "path validator is present in the parent renderer");
  const validate = new Function(`${source}; return isAbsoluteWindowsAssetPath;`)();
  for (const value of [
    "C:\\work\\asset.png",
    "D:/work/asset.mp4",
    "\\\\server\\share\\asset.mov",
    "//server/share/asset.mov",
  ]) assert.equal(validate(value), true, value);
  for (const value of [
    "relative\\asset.png",
    "C:relative\\asset.png",
    "\\root-relative.png",
    "https://example.com/asset.png",
    "",
  ]) assert.equal(validate(value), false, value);
});

test("an open Asset Console refreshes when the selected Codex task changes", async () => {
  const injection = await readFile(injectionPath, "utf8");
  assert.match(injection, /function syncAssetConsoleTaskContext/);
  assert.match(injection, /panel\.dataset\.taskContextKey === nextKey/);
  assert.match(injection, /panel\.querySelector\(`#\$\{ASSET_CONSOLE_FRAME_ID\}`\)\?\.remove\(\)/);
  assert.match(injection, /function sync\(\) \{[\s\S]{0,180}syncAssetConsoleTaskContext\(\)/);
  assert.match(injection, /data-app-action-sidebar-thread-selected/);
});

test("the private Asset Console surface ships its task-integrated workspace", async () => {
  const [injector, html, app, css] = await Promise.all([
    readFile(injectorPath, "utf8"),
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(injector, /embeddedAssetConsoleResponse/);
  assert.match(injector, /path\.join\(root, "asset-console", "public"\)/);
  assert.match(html, /codex-task-bar/);
  assert.match(app, /sendAssetToCodex/);
  assert.match(app, /ai-reference-library/);
  assert.match(css, /body\.codex-embedded/);
});

test("the embedded workspace separates project and shared scopes with inline triage filters", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  const project = html.indexOf('data-codex-scope="project"');
  const shared = html.indexOf('data-codex-scope="shared"');
  assert.ok(project >= 0 && project < shared, "project assets precede shared libraries");
  assert.match(html, /data-codex-shared-project="ai-reference-library"/);
  assert.match(html, /id="embeddedSmartGroupFilter"[\s\S]*?value="review">待确认/);
  assert.match(app, /async function selectCodexScope/);
  assert.match(html, /id="embeddedFilterMenu"/);
  assert.match(html, /id="embeddedCategoryFilter"/);
  assert.match(html, /id="embeddedStatusFilter"/);
  assert.match(html, /id="embeddedTypeFilter"/);
  assert.match(app, /function syncEmbeddedFilterControls/);
  assert.match(css, /\.embedded-filter-menu/);
});

test("multi-asset composer handoff validates every path and stays bounded", async () => {
  const injection = await readFile(injectionPath, "utf8");
  assert.match(injection, /message\.action === "use-many-in-codex"/);
  assert.match(injection, /assetPaths\.length <= 8/);
  assert.match(injection, /assetPaths\.every\(\(assetPath\) =>/);
  assert.match(injection, /addAssetReferencesToComposer\(assetPaths\)/);
  assert.match(injection, /\.join\("\\n"\)/);
});

test("selection mode supports direct task routing, discard, compare, and curate actions", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(html, /id="batchUseInCodex"/);
  assert.match(html, /id="batchTaskAction"/);
  assert.match(html, /id="batchDiscardAssets"/);
  assert.match(html, /id="batchMorePopover"[^>]*popover="auto"/);
  assert.match(html, /永久删除…/);
  assert.match(html, /id="batchCompareAssets"/);
  assert.match(html, /id="batchCurateAssets"/);
  assert.match(html, /id="comparePanel"/);
  assert.match(app, /function openComparePanel/);
  assert.match(app, /function routeSelectedAssetsForCurrentTask/);
  assert.match(app, /viewingBoundProject \? "pending-review" : state\.codexBoundProject/);
  assert.match(app, /function discardSelectedAssets/);
  assert.match(app, /await applyBatchStatus\("丢弃"\)/);
  assert.match(app, /count < 2 \|\| count > 4/);
  assert.match(app, /openBatchMoveDialog\(\{ targetProjectId: "ai-reference-library" \}\)/);
  assert.match(css, /\.compare-panel/);
});

test("moving to a project works without a task binding and chooses a visible destination", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  assert.match(app, /function preferredMoveTargetProjectId/);
  assert.match(app, /if \(!viewingBoundProject && !state\.codexBoundProject\) \{\s*els\.batchMorePopover\?\.hidePopover\?\.\(\);\s*await openBatchMoveDialog\(\);/);
  assert.match(app, /if \(!viewingBoundProject && !state\.codexBoundProject\) \{\s*await openMoveAssetDialog\(asset\);/);
  assert.match(app, /: "移动到项目…"/);
  assert.doesNotMatch(app, /先在“选择项目”里关联当前任务/);
});

test("automatic project moves stay inside the destination scan area", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const dateSource = app.match(/function localDateDirectory\(now = new Date\(\)\) \{[\s\S]*?\n\}/)?.[0];
  const normalizeSource = app.match(/function normalizeProjectDirectory\(value\) \{[\s\S]*?\n\}/)?.[0];
  const rootsSource = app.match(/function projectScanRootDirectories\(project\) \{[\s\S]*?\n\}/)?.[0];
  const validateSource = app.match(/function isDirectoryInProjectScanRoots\(project, directory\) \{[\s\S]*?\n\}/)?.[0];
  const routeSource = app.match(/function automaticProjectRouteDirectory\(project, now = new Date\(\)\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(dateSource, "local date helper is present");
  assert.ok(normalizeSource, "relative project directory normalizer is present");
  assert.ok(rootsSource, "project scan root helper is present");
  assert.ok(validateSource, "project scan boundary helper is present");
  assert.ok(routeSource, "automatic route helper is present");
  const helpers = new Function(`${dateSource}\n${normalizeSource}\n${rootsSource}\n${validateSource}\n${routeSource}; return { automaticProjectRouteDirectory, isDirectoryInProjectScanRoots };`)();
  const route = helpers.automaticProjectRouteDirectory;
  const date = new Date(2026, 7, 10, 9, 30);
  assert.equal(route({ id: "pending-review", scanRoots: ["."] }, date), "2026-08-10");
  assert.equal(route({ id: "new-project", scanRoots: ["02-cases"] }, date), "02-cases");
  assert.equal(route({ id: "dated-workspace", scanRoots: ["."] }, date), "");
  assert.equal(route({ id: "episode-project", scanRoots: ["ep01", "ep02"] }, date), null);
  const multiRoot = { id: "episode-project", scanRoots: ["ep01/assets", "ep02/assets"] };
  assert.equal(helpers.isDirectoryInProjectScanRoots(multiRoot, "ep01/assets"), true);
  assert.equal(helpers.isDirectoryInProjectScanRoots(multiRoot, "ep02/assets/shots"), true);
  assert.equal(helpers.isDirectoryInProjectScanRoots(multiRoot, ""), false);
  assert.equal(helpers.isDirectoryInProjectScanRoots(multiRoot, "生成记录"), false);
  assert.equal(helpers.isDirectoryInProjectScanRoots(multiRoot, "../outside"), false);
  assert.match(app, /targetDirectory = options\.targetDirectory \?\? automaticProjectRouteDirectory\(targetProject\)/);
  assert.match(app, /这个项目有多个素材区，请确认要放到哪个文件夹/);
  assert.match(app, /placeholder\.textContent = "请选择素材区…"/);
  assert.match(app, /const needsChoice = scanRoots\.length > 1 && \(!preferred \|\| !preferredIsAllowed\)/);
  assert.match(app, /loadMoveTargetFolders\(sharedSourceProject && !options\.targetProjectId \? sharedDirectory : ""\)/);
  assert.match(app, /!isDirectoryInProjectScanRoots\(targetProject, targetDirectory\)/);
});

test("one-click auto organize follows project structure, asset type, and scan boundaries", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  const helperNames = [
    "localDateDirectory",
    "normalizeProjectDirectory",
    "projectScanRootDirectories",
    "isDirectoryInProjectScanRoots",
    "joinProjectDirectory",
    "autoOrganizeAssetBucket",
    "isAutoOrganizeUnsafeDirectory",
    "selectedProjectScanRoot",
    "inferredProjectScanRoot",
    "autoOrganizeCanonicalDirectory",
    "autoOrganizeExistingDirectory",
    "recommendAutoOrganizeDirectory",
    "autoOrganizeMovePlan",
    "directProjectAutoOrganizePlan",
  ];
  const extractNamedFunction = (source, name) => {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) return "";
    const openingBrace = source.indexOf("{", start);
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
    return "";
  };
  const helperSource = helperNames.map((name) => {
    const source = extractNamedFunction(app, name);
    assert.ok(source, `${name} is present`);
    return source;
  }).join("\n");
  const {
    recommendAutoOrganizeDirectory: recommend,
    autoOrganizeMovePlan: plan,
    directProjectAutoOrganizePlan: directPlan,
    isAutoOrganizeUnsafeDirectory: unsafeDirectory,
  } = new Function(
    `${helperSource}; return { recommendAutoOrganizeDirectory, autoOrganizeMovePlan, directProjectAutoOrganizePlan, isAutoOrganizeUnsafeDirectory };`
  )();
  const date = new Date(2026, 7, 10, 9, 30);
  const image = { kind: "image", name: "hero.png", dir: "", relPath: "hero.png", caseId: "" };
  const video = { kind: "video", name: "shot.mp4", dir: "", relPath: "shot.mp4", caseId: "" };

  assert.deepEqual(
    recommend({ id: "new-project", scanRoots: ["02-cases"] }, [image], ["02-cases/图片"], "02-cases", "", date),
    { directory: "02-cases/图片", needsRootChoice: false, bucket: "image" }
  );
  assert.equal(
    recommend({ id: "new-project", scanRoots: ["02-cases"] }, [video], ["02-cases/成片"], "02-cases", "", date).directory,
    "02-cases/视频",
    "automatic organization never sends working media to a final-output folder"
  );
  assert.equal(
    recommend({ id: "dated-workspace", scanRoots: ["."] }, [image], [], "", "", date).directory,
    "2026-08-10/图片"
  );
  const seriesProject = { id: "episode-series", scanRoots: ["第一集 开场", "第二集 转折", "第三集 收束"] };
  assert.equal(
    recommend(seriesProject, [image], [], "", "分集项目 第一集 开场 镜头整理", date).directory,
    "第一集 开场/参考/图片"
  );
  assert.equal(
    recommend(seriesProject, [video], [], "第二集 转折", "", date).directory,
    "第二集 转折/生成视频"
  );
  assert.equal(recommend(seriesProject, [image], [], "", "普通任务", date).needsRootChoice, true);
  const outputProject = { id: "techno", scanRoots: ["01_assets", "04_outputs", "07_final"] };
  assert.deepEqual(
    recommend(outputProject, [image], [], "04_outputs", "", date),
    { directory: "", needsRootChoice: true, unsafeRoot: true, bucket: "image" },
    "automatic organization rejects a numbered outputs root"
  );
  assert.equal(
    recommend(outputProject, [video], [], "07_final", "", date).needsRootChoice,
    true,
    "automatic organization rejects a numbered final root"
  );
  for (const unsafeRoot of ["成片输出", "最终视频", "my_outputs", "04-output-assets", "生成记录"]) {
    assert.equal(unsafeDirectory(unsafeRoot), true, `${unsafeRoot} is treated as a final-output area`);
  }
  assert.equal(unsafeDirectory("01_assets"), false, "a normal material root remains available");
  const mixedPlan = plan(
    { id: "dated-workspace", scanRoots: ["."] },
    [image, video],
    [],
    "",
    "",
    date
  );
  assert.equal(mixedPlan.needsRootChoice, false);
  assert.deepEqual(
    mixedPlan.items.map((item) => item.directory),
    ["2026-08-10/图片", "2026-08-10/视频"],
    "mixed batches are routed per asset type"
  );

  assert.deepEqual(
    directPlan(
      { id: "dated-workspace", scanRoots: ["."] },
      { id: "2026-08-08", relPath: "2026-08-08", scanRoot: "." },
      [image, video],
      ["2026-08-08/图片", "2026-08-08/视频"],
      "",
      date
    ).items.map((item) => item.directory),
    ["2026-08-08/图片", "2026-08-08/视频"],
    "direct organization stays inside the currently viewed dated-workspace date"
  );
  assert.equal(
    directPlan(
      { id: "private-projects", scanRoots: ["."] },
      { id: "实验片子", relPath: "实验片子", scanRoot: "." },
      [image],
      ["实验片子/图片"],
      "",
      date
    ).items[0].directory,
    "实验片子/图片",
    "direct organization stays inside the current project case"
  );
  assert.equal(
    directPlan(
      { id: "new-project", scanRoots: ["02-cases"] },
      { id: "shot-a", relPath: "02-cases/shot-a", scanRoot: "02-cases" },
      [image],
      ["02-cases/shot-a/图片"],
      "",
      date
    ).items[0].directory,
    "02-cases/shot-a/图片",
    "direct organization stays inside a nested case even when the project scan root is not the project root"
  );
  assert.equal(
    directPlan(
      outputProject,
      { id: "04_outputs", relPath: "04_outputs", scanRoot: "04_outputs" },
      [video],
      [],
      "",
      date
    ).unsafeRoot,
    true,
    "direct organization refuses a current output case"
  );

  assert.match(html, /id="autoOrganizeMoveAsset"/);
  assert.match(html, /id="organizeProjectButton"[\s\S]*?>自动整理<\/button>[\s\S]*?id="selectionModeButton"/);
  assert.match(app, /autoOrganizeMoveAsset\.addEventListener\("click"/);
  assert.match(app, /organizeProjectButton\?\.addEventListener\("click", \(\) => organizeCurrentProject\(\)/);
  assert.match(app, /const assets = \[\.\.\.state\.assets\]/, "first-level action organizes the whole current case, not filtered results");
  assert.match(app, /normalizeProjectDirectory\(item\.asset\.dir\) !== normalizeProjectDirectory\(item\.directory\)/);
  assert.match(app, /for \(let index = 0; index < items\.length; index \+= 200\)/);
  assert.match(app, /await confirmMoveAsset\(\{ autoOrganized: true, itemTargetDirectories \}\)/);
  assert.match(app, /targetDirectory: itemTargetDirectories\[index\]/);
  assert.match(app, /这个项目有多个素材区，请先选择对应的素材区/);
  assert.match(css, /\.move-asset-dialog \.auto-organize-action/);
  assert.match(css, /\.codex-embedded \.toolbar > \.project-organize-button/);
});

test("folder hierarchy exposes every navigable level and switches cases", async () => {
  const [app, css] = await Promise.all([
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  const extractNamedFunction = (source, name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} is present`);
    const openingBrace = source.indexOf("{", start);
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Could not extract ${name}`);
  };
  const helperSource = ["pathParts", "normalizeProjectDirectory", "projectScanRootDirectories", "completeCaseHierarchy"]
    .map((name) => extractNamedFunction(app, name))
    .join("\n");
  const complete = new Function(`${helperSource}; return completeCaseHierarchy;`)();
  const cases = complete([
    { id: "02-cases\\视频", name: "视频", relPath: "02-cases\\视频", scanRoot: "02-cases", mediaCount: 4 },
    { id: "02-cases\\图片", name: "图片", relPath: "02-cases\\图片", scanRoot: "02-cases", mediaCount: 5 },
  ], { id: "new-project", name: "新项目", scanRoots: ["02-cases"] });
  assert.ok(cases.some((item) => item.id === "."), "project root is navigable");
  assert.equal(cases.find((item) => item.id === "02-cases")?.mediaCount, 9, "missing scan-root case is synthesized");
  assert.ok(cases.some((item) => item.id === "02-cases\\视频"), "real child folders remain navigable");

  const multiRoot = complete([
    { id: "01_assets\\generated", relPath: "01_assets\\generated", scanRoot: "01_assets", mediaCount: 1 },
  ], { id: "multi-root", name: "多目录项目", scanRoots: ["01_assets", "04_outputs", "07_final"] });
  for (const root of ["01_assets", "04_outputs", "07_final"]) {
    assert.ok(multiRoot.some((item) => item.id === root), `${root} remains directly selectable even when empty`);
  }
  assert.match(app, /function renderCaseBreadcrumb\(currentProject, currentCase\)/);
  assert.match(app, /button\.addEventListener\("click", \(\) => activateCase\(level\.caseId\)\)/);
  assert.match(app, /button\.addEventListener\("click", \(\) => activateCase\(item\.id\)\)/);
  assert.match(app, /function activateCase\(caseId\)[\s\S]*?selectCase\(caseId\)\.catch\(showError\)/);
  assert.match(app, /async function selectCase\(caseId\)[\s\S]*?await loadAssets\(\{ workspaceGeneration: generation \}\)/);
  assert.match(app, /state\.selectedCase = previousCase;[\s\S]*?setCategoryFilter\(previousCategoryFilter\)/);
  assert.match(app, /if \(rootItem\) children\.append\(makeCaseButton\(rootItem, "全部"\)\)/);
  assert.match(css, /\.case-crumb:not\(:disabled\):hover/);
});

test("Daily Practice opens the latest dated folder without hiding utility folders", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const helperSource = ["pathParts", "isDailyDateCase", "latestDailyCase"]
    .map((name) => extractFunctionSource(app, name)).join("\n");
  const helpers = new Function(`${helperSource}; return { isDailyDateCase, latestDailyCase };`)();
  const cases = [
    { id: ".", relPath: ".", name: "日期工作区" },
    { id: "生成记录", relPath: "生成记录", name: "生成记录" },
    { id: "2026-07-31", relPath: "2026-07-31", name: "2026-07-31" },
    { id: "2026-08-08", relPath: "2026-08-08", name: "2026-08-08" },
    { id: "2026-08-08\\图片", relPath: "2026-08-08\\图片", name: "图片" },
  ];
  assert.equal(helpers.latestDailyCase(cases)?.id, "2026-08-08", "utility folders cannot sort ahead of the latest work date");
  assert.equal(helpers.isDailyDateCase(cases[1]), false);
  assert.equal(helpers.isDailyDateCase(cases[3]), true);
  assert.equal(helpers.isDailyDateCase({ id: "2026-99-99" }), false, "an impossible month is not a work date");
  assert.equal(helpers.isDailyDateCase({ id: "2026-02-30" }), false, "an impossible day is not a work date");
  assert.equal(helpers.isDailyDateCase({ id: "2024-02-29" }), true, "valid leap days remain available");
  assert.equal(helpers.isDailyDateCase({ id: "2026-02-29" }), false, "non-leap years reject February 29");
  assert.equal(helpers.latestDailyCase([...cases, { id: "2026-99-99", relPath: "2026-99-99" }])?.id, "2026-08-08");
  assert.match(app, /appendDailyCaseGroup\("按日期", dateCases/);
  assert.match(app, /appendDailyCaseGroup\("其他文件夹", otherCases/);
  assert.match(app, /otherCases = topLevelCases[\s\S]*?filter\(\(item\) => !isDailyDateCase\(item\)\)/, "non-date top-level folders stay clickable in their own group");
});

test("out-of-order folder requests cannot overwrite the active folder", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const loadAssetsSource = extractFunctionSource(app, "loadAssets");
  const cacheHelpers = ["workspaceCacheKey", "readWorkspaceCache", "rememberWorkspaceCache", "beginWorkspaceCacheRequest", "isCurrentWorkspaceCacheRequest", "finishWorkspaceCacheRequest", "commitAssets"]
    .map((name) => extractFunctionSource(app, name)).join("\n");
  const pending = new Map();
  const api = (url) => new Promise((resolve, reject) => {
    const caseId = new URL(url, "http://asset-console.local").searchParams.get("case");
    pending.set(caseId, { resolve, reject });
  });
  const state = {
    selectedProject: "project",
    selectedCase: "A",
    assets: [],
    selectedAsset: null,
    selectedAssetKeys: new Set(),
    deferredRefresh: null,
    workspaceSwitchGeneration: 1,
    assetLoadGeneration: 0,
    assetCache: new Map(),
    assetCacheRequestGeneration: new Map(),
    workspaceCacheEpoch: 0,
    workspaceCacheRequestSerial: 0,
  };
  let renderCount = 0;
  const loadAssets = new Function(
    "state", "api", "assetSelectionKey", "render", "updateBatchBar", "els",
    `const workspaceCacheLimit = 24; ${cacheHelpers}\n${loadAssetsSource}; return loadAssets;`
  )(state, api, (asset) => asset.id, () => { renderCount += 1; }, () => {}, { refreshStatus: { textContent: "" } });

  const loadA = loadAssets({ workspaceGeneration: 1 });
  state.selectedCase = "B";
  state.workspaceSwitchGeneration = 2;
  const loadB = loadAssets({ workspaceGeneration: 2 });
  pending.get("B").resolve({ assets: [{ id: "B" }] });
  assert.equal(await loadB, true);
  assert.equal(state.assets[0].id, "B");
  pending.get("A").resolve({ assets: [{ id: "A" }] });
  assert.equal(await loadA, false, "the stale request exits without committing");
  assert.equal(state.assets[0].id, "B", "late A cannot replace active B assets");
  assert.equal(renderCount, 1, "only the active response renders");

  state.selectedCase = "C";
  state.workspaceSwitchGeneration = 3;
  const loadC = loadAssets({ workspaceGeneration: 3 });
  state.selectedCase = "D";
  state.workspaceSwitchGeneration = 4;
  const loadD = loadAssets({ workspaceGeneration: 4 });
  pending.get("C").reject(new Error("stale failure"));
  assert.equal(await loadC, false, "stale failures are ignored instead of surfacing an unhandled rejection");
  pending.get("D").resolve({ assets: [{ id: "D" }] });
  assert.equal(await loadD, true);
  assert.equal(state.assets[0].id, "D");
});

test("revisiting a folder paints cached assets immediately and revalidates in the background", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const loadAssetsSource = extractFunctionSource(app, "loadAssets");
  const cacheHelpers = ["workspaceCacheKey", "readWorkspaceCache", "rememberWorkspaceCache", "beginWorkspaceCacheRequest", "isCurrentWorkspaceCacheRequest", "finishWorkspaceCacheRequest", "commitAssets"]
    .map((name) => extractFunctionSource(app, name)).join("\n");
  const pending = [];
  const api = (url) => new Promise((resolve, reject) => {
    pending.push({ url, resolve, reject });
  });
  const state = {
    selectedProject: "project",
    selectedCase: "A",
    assets: [],
    selectedAsset: null,
    selectedAssetKeys: new Set(),
    deferredRefresh: null,
    workspaceSwitchGeneration: 1,
    assetLoadGeneration: 0,
    assetCache: new Map(),
    assetCacheRequestGeneration: new Map(),
    workspaceCacheEpoch: 0,
    workspaceCacheRequestSerial: 0,
  };
  let renderCount = 0;
  const loadAssets = new Function(
    "state", "api", "assetSelectionKey", "render", "updateBatchBar", "els",
    `const workspaceCacheLimit = 24; ${cacheHelpers}\n${loadAssetsSource}; return loadAssets;`
  )(state, api, (asset) => asset.id, () => { renderCount += 1; }, () => {}, { refreshStatus: { textContent: "" } });

  const firstA = loadAssets({ workspaceGeneration: 1 });
  pending.shift().resolve({ assets: [{ id: "A-old" }] });
  assert.equal(await firstA, true);

  state.selectedCase = "B";
  state.workspaceSwitchGeneration = 2;
  const firstB = loadAssets({ workspaceGeneration: 2 });
  pending.shift().resolve({ assets: [{ id: "B" }] });
  assert.equal(await firstB, true);

  state.selectedCase = "A";
  state.workspaceSwitchGeneration = 3;
  const beforeCachedRender = renderCount;
  assert.equal(await loadAssets({ workspaceGeneration: 3 }), true);
  assert.equal(state.assets[0].id, "A-old", "the previous folder snapshot is painted before the network returns");
  assert.equal(renderCount, beforeCachedRender + 1);
  assert.equal(pending.length, 1, "a background revalidation still starts");

  pending.shift().resolve({ assets: [{ id: "A-fresh" }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.assets[0].id, "A-fresh", "fresh data replaces the cached snapshot without another switch");

  const preMutationRequest = loadAssets({ workspaceGeneration: 3, forceRefresh: true });
  state.workspaceCacheEpoch += 1;
  state.assetCache.clear();
  state.assetCacheRequestGeneration.clear();
  pending.shift().resolve({ assets: [{ id: "stale-after-mutation" }] });
  assert.equal(await preMutationRequest, false, "a response started before a structural mutation is stale");
  assert.equal(state.assets[0].id, "A-fresh", "pre-mutation data cannot overwrite the current workspace");
});

test("workspace cache is bounded, mutation-safe, and manual refresh bypasses it", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const helperSource = [
    "rememberWorkspaceCache",
    "clearWorkspaceCaches",
    "beginWorkspaceCacheRequest",
    "isCurrentWorkspaceCacheRequest",
    "finishWorkspaceCacheRequest",
    "mutatesWorkspace",
  ].map((name) => extractFunctionSource(app, name)).join("\n");
  const state = {
    caseCache: new Map([["case", { cases: [] }]]),
    assetCache: new Map(),
    caseCacheRequestGeneration: new Map([["case", 4]]),
    assetCacheRequestGeneration: new Map([["asset", 7]]),
    workspaceCacheEpoch: 0,
    workspaceCacheRequestSerial: 7,
  };
  const helpers = new Function("state", `const workspaceCacheLimit = 24; ${helperSource}; return { rememberWorkspaceCache, clearWorkspaceCaches, beginWorkspaceCacheRequest, isCurrentWorkspaceCacheRequest, finishWorkspaceCacheRequest, mutatesWorkspace };`)(state);
  for (let index = 0; index < 30; index += 1) helpers.rememberWorkspaceCache(state.assetCache, `asset-${index}`, { assets: [] });
  assert.equal(state.assetCache.size, 24);
  assert.equal(state.assetCache.has("asset-0"), false, "old snapshots are evicted instead of growing without bound");

  helpers.clearWorkspaceCaches();
  assert.equal(state.caseCache.size, 0);
  assert.equal(state.assetCache.size, 0);
  assert.equal(state.workspaceCacheEpoch, 1);
  assert.equal(state.caseCacheRequestGeneration.size, 0);
  assert.equal(state.assetCacheRequestGeneration.size, 0, "an in-flight pre-mutation response can no longer refill stale data");
  for (let index = 0; index < 1000; index += 1) {
    const key = `request-${index}`;
    const request = helpers.beginWorkspaceCacheRequest(state.assetCacheRequestGeneration, key);
    assert.equal(helpers.isCurrentWorkspaceCacheRequest(state.assetCacheRequestGeneration, key, request), true);
    helpers.finishWorkspaceCacheRequest(state.assetCacheRequestGeneration, key, request);
  }
  assert.equal(state.assetCacheRequestGeneration.size, 0, "completed request tokens do not accumulate with every visited folder");
  assert.equal(helpers.mutatesWorkspace("/api/batch-move", { method: "POST" }), true);
  assert.equal(helpers.mutatesWorkspace("/api/assets?project=p&case=c"), false);
  assert.match(app, /cacheRequest\.epoch !== state\.workspaceCacheEpoch[\s\S]*?state\.caseLoadGeneration/);
  assert.match(app, /async function performManualRefresh\(\)[\s\S]*?loadProjects\(\)[\s\S]*?loadCases\(\{[\s\S]*?forceRefresh: true[\s\S]*?loadAssets\(\{ workspaceGeneration, forceRefresh: true \}\)/);
  assert.match(app, /refreshButton\.addEventListener\("click", \(\) => performManualRefresh\(\)/);
});

test("a removed active folder immediately shows the replacement folder cache or a clean loading state", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const helpers = ["workspaceCacheKey", "readWorkspaceCache", "commitAssets", "prepareAssetsForCaseChange"]
    .map((name) => extractFunctionSource(app, name)).join("\n");
  const state = {
    selectedCase: "B",
    assets: [{ id: "A-visible" }],
    selectedAsset: null,
    selectedAssetKeys: new Set(),
    assetCache: new Map([["project\u0000B", { assets: [{ id: "B-cached" }] }]]),
  };
  const els = { refreshStatus: { textContent: "" } };
  const prepare = new Function(
    "state", "assetSelectionKey", "render", "updateBatchBar", "els",
    `${helpers}; return prepareAssetsForCaseChange;`
  )(state, (asset) => asset.id, () => {}, () => {}, els);

  prepare("project");
  assert.equal(state.assets[0].id, "B-cached", "the replacement folder cache paints synchronously");
  state.assetCache.clear();
  state.assets = [{ id: "A-visible" }];
  prepare("project");
  assert.deepEqual(state.assets, [], "old-folder cards are cleared before the replacement request finishes");
  assert.match(els.refreshStatus.textContent, /正在读取素材/);
});

test("episode-series projects keep empty episode roots and an All entry for every episode", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const helperSource = [
    "pathParts",
    "normalizeProjectDirectory",
    "projectScanRootDirectories",
    "completeCaseHierarchy",
    "episodeRank",
    "caseRank",
    "seriesEpisodeGroups",
  ].map((name) => extractFunctionSource(app, name)).join("\n");
  const helpers = new Function(`${helperSource}; return { completeCaseHierarchy, seriesEpisodeGroups };`)();
  const cases = helpers.completeCaseHierarchy([
    { id: "第一集\\参考", relPath: "第一集\\参考", scanRoot: "第一集", mediaCount: 8 },
  ], { name: "分集项目", scanRoots: ["第一集", "第二集", "第三集"] });
  const groups = helpers.seriesEpisodeGroups(cases);
  assert.deepEqual(groups.map((group) => group.episode), ["第一集", "第二集", "第三集"]);
  assert.ok(groups.every((group) => group.rootItem), "every episode exposes its selectable All root");
  assert.equal(groups[0].total, 8, "the parent total is not double-counted with its child");
  assert.equal(groups[1].entries.length, 0, "an empty episode still renders as a group");
  assert.match(app, /if \(rootItem\) children\.append\(makeCaseButton\(rootItem, "全部"\)\)/);
});

test("workspace switches use restrained motion and respect reduced-motion preferences", async () => {
  const [app, css] = await Promise.all([
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(app, /const transition = await beginWorkspaceSwitch\(generation\)/);
  assert.match(app, /workspaceSwitchGeneration/);
  assert.match(app, /function releaseWorkspaceSwitch/);
  assert.match(app, /surface\.removeAttribute\("aria-busy"\)/);
  assert.match(app, /duration: 90/);
  assert.match(app, /duration: 190/);
  assert.match(app, /reducedMotionPreferred\(\)/);
  assert.match(css, /codex-workspace-switcher button[\s\S]*transition: color 160ms/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("a cancelled workspace exit cannot leave the asset grid busy", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const cancelSource = app.match(/function cancelElementAnimations\(element\) \{[\s\S]*?\n\}/)?.[0];
  const beginSource = app.match(/async function beginWorkspaceSwitch\(generation\) \{[\s\S]*?\n\}/)?.[0];
  const releaseSource = app.match(/function releaseWorkspaceSwitch\(transition\) \{[\s\S]*?\n\}/)?.[0];
  const finishSource = app.match(/function finishWorkspaceSwitch\(transition\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(cancelSource && beginSource && releaseSource && finishSource);

  const animations = [];
  const attributes = new Map();
  const surface = {
    dataset: {},
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAnimations() { return animations.filter((animation) => !animation.settled); },
    animate(_frames, options) {
      let resolve;
      let reject;
      const animation = {
        options,
        settled: false,
        finished: new Promise((res, rej) => { resolve = res; reject = rej; }),
        cancel() {
          if (animation.settled) return;
          animation.settled = true;
          reject(new Error("cancelled"));
        },
        finish() {
          if (animation.settled) return;
          animation.settled = true;
          resolve();
        }
      };
      animations.push(animation);
      return animation;
    }
  };
  const createHelpers = new Function("state", "els", "reducedMotionPreferred", `${cancelSource}\n${beginSource}\n${releaseSource}\n${finishSource}; return { beginWorkspaceSwitch, finishWorkspaceSwitch };`);
  const { beginWorkspaceSwitch, finishWorkspaceSwitch } = createHelpers(
    { compareMode: false },
    { comparePanel: { hidden: true }, assetGrid: surface },
    () => false
  );
  const starting = beginWorkspaceSwitch(1);
  animations[0].cancel();
  const transition = await starting;
  finishWorkspaceSwitch(transition);
  assert.equal(attributes.has("aria-busy"), false);
  assert.equal(surface.dataset.workspaceSwitchToken, undefined);
  assert.equal(animations.at(-1).options.duration, 190);
});

test("reduced-motion workspace switches keep stale cards busy until the current load finishes", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const cancelSource = extractFunctionSource(app, "cancelElementAnimations");
  const beginSource = extractFunctionSource(app, "beginWorkspaceSwitch");
  const releaseSource = extractFunctionSource(app, "releaseWorkspaceSwitch");
  const finishSource = extractFunctionSource(app, "finishWorkspaceSwitch");
  const attributes = new Map();
  const surface = {
    dataset: {},
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAnimations() { return []; },
  };
  const createHelpers = new Function("state", "els", "reducedMotionPreferred", `${cancelSource}\n${beginSource}\n${releaseSource}\n${finishSource}; return { beginWorkspaceSwitch, finishWorkspaceSwitch };`);
  const { beginWorkspaceSwitch, finishWorkspaceSwitch } = createHelpers(
    { compareMode: false },
    { comparePanel: { hidden: true }, assetGrid: surface },
    () => true
  );

  const first = await beginWorkspaceSwitch(1);
  assert.equal(first.motion, false);
  assert.equal(attributes.get("aria-busy"), "true");
  assert.equal(surface.dataset.workspaceSwitchToken, "1");

  const second = await beginWorkspaceSwitch(2);
  finishWorkspaceSwitch(first);
  assert.equal(attributes.get("aria-busy"), "true", "an old request cannot release the current busy state");
  assert.equal(surface.dataset.workspaceSwitchToken, "2");

  finishWorkspaceSwitch(second);
  assert.equal(attributes.has("aria-busy"), false);
  assert.equal(surface.dataset.workspaceSwitchToken, undefined);
});

test("large asset grids hydrate media only near the viewport", async () => {
  const [app, css] = await Promise.all([
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  const previewSource = extractFunctionSource(app, "mediaPreview");
  const helpers = ["escapeHtml", "resourceKind"].map((name) => extractFunctionSource(app, name)).join("\n");
  const mediaPreview = new Function(`const state = { codexEmbedded: true }; ${helpers}; ${previewSource}; return mediaPreview;`)();
  const asset = { kind: "video", mediaUrl: "/media?asset=large-video" };
  const cardMarkup = mediaPreview(asset);
  const detailMarkup = mediaPreview(asset, true);

  assert.match(cardMarkup, /data-media-src="\/media\?asset=large-video"/);
  assert.match(cardMarkup, /preload="none"/);
  assert.doesNotMatch(cardMarkup, /\ssrc="/);
  assert.match(detailMarkup, /\ssrc="\/media\?asset=large-video"/);
  assert.match(detailMarkup, /preload="metadata"/);
  assert.match(app, /new IntersectionObserver/);
  assert.match(app, /rootMargin: "480px 0px"/);
  assert.match(app, /document\.createDocumentFragment\(\)/);
  assert.doesNotMatch(css, /\.asset-card \.preview img,[\s\S]{0,260}will-change: transform/);
  const previewRule = css.match(/\.asset-card \.preview img,[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(previewRule, /scale\(1\.001\)/);
  assert.doesNotMatch(css, /(?:body\.selection-mode )?\.card-actions\s*\{[^}]*?(?:will-change|translate3d)/);
});

test("workspace data starts loading without waiting for the exit animation", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const beginSource = extractFunctionSource(app, "beginWorkspaceSwitch");
  assert.match(beginSource, /void animation\.finished\.catch/);
  assert.doesNotMatch(beginSource, /await animation\.finished/);
});

test("embedded terminology separates asset location, project binding, and conversation attachment", async () => {
  const [html, app] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
  ]);
  assert.match(html, /data-codex-scope="project"[^>]*>项目资产</);
  assert.match(html, /data-codex-scope="shared"[^>]*>公用资产</);
  assert.match(html, /id="codexBindProject"[^>]*>关联项目</);
  assert.match(html, /附加到当前对话/);
  assert.match(html, /丢弃（不删除）/);
  assert.match(html, />批量工具</);
  assert.ok(html.indexOf('id="batchCompareAssets"') > html.indexOf('id="batchMorePopover"'), "compare is grouped in the secondary batch menu");
  assert.match(app, /state\.codexBoundProject = data\.project\?\.id \|\| ""/);
  assert.match(app, /移动到「\$\{boundName\}」/);
});

test("the embedded binding flow can create and immediately bind a project", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(html, /id="codexNewProjectButton"/);
  assert.match(html, /id="codexNewProjectDialog"/);
  assert.match(html, /id="codexNewProjectName"/);
  assert.match(html, /id="codexNewProjectPath"/);
  assert.match(html, /新建并关联/);
  assert.match(app, /function isAbsoluteWindowsProjectPath/);
  assert.match(app, /api\("\/api\/projects", \{/);
  assert.match(app, /await saveCodexProjectBinding\(projectId\)/);
  assert.match(app, /await selectProject\(projectId\)/);
  assert.match(app, /已新建，但自动关联失败/);
  assert.match(css, /\.codex-new-project-dialog/);
});

test("new project follow-up fails closed and can recover a lost create response by path", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const normalizeSource = app.match(/function normalizeWindowsProjectPath\(value\) \{[\s\S]*?\n\}/)?.[0];
  const findSource = app.match(/function findCreatedProject\(projects, expectedId, projectPath\) \{[\s\S]*?\n\}/)?.[0];
  const resolveSource = app.match(/function resolveUsableCreatedProject\(projects, expectedId, projectPath\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(normalizeSource, "project path normalizer is present");
  assert.ok(findSource, "created project finder is present");
  assert.ok(resolveSource, "created project resolver is present");
  const helpers = new Function(`${normalizeSource}\n${findSource}\n${resolveSource}; return { findCreatedProject, resolveUsableCreatedProject };`)();
  const { findCreatedProject: find, resolveUsableCreatedProject: resolve } = helpers;

  const usable = { id: "new", name: "新项目", path: "D:\\Work\\New", exists: true };
  assert.equal(resolve([usable], "new", "D:\\Work\\New"), usable);
  assert.equal(resolve([usable], "", "d:/work/new/"), usable, "a lost POST response recovers by normalized path");
  const createdButUnavailable = { ...usable, exists: false };
  assert.equal(
    find([createdButUnavailable], "", "d:/work/new/"),
    createdButUnavailable,
    "a lost POST response still confirms that an unavailable project was created"
  );
  assert.throws(
    () => resolve([createdButUnavailable], "new", "D:\\Work\\New"),
    /尚未出现在可用项目列表中/,
    "an unavailable project must not be reported as selected"
  );
  assert.throws(
    () => resolve([], "new", "D:\\Work\\New"),
    /尚未出现在可用项目列表中/,
    "a missing refreshed project must fail closed"
  );
  assert.match(app, /const recovery = await api\("\/api\/projects"\)/);
  assert.match(app, /const recoveredProject = findCreatedProject\(recovery\.projects, "", projectPath\)/);
  assert.match(app, /已新建，但自动关联失败/);
});

test("composer handoff exposes an explicit return path and restores focus", async () => {
  const [injection, html, app] = await Promise.all([
    readFile(injectionPath, "utf8"),
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
  ]);
  assert.match(html, /id="codexAttachResult"/);
  assert.match(html, /返回对话并聚焦输入框/);
  assert.match(app, /action: "return-to-codex"/);
  assert.match(injection, /message\.action === "return-to-codex"/);
  assert.match(injection, /closeAssetConsolePanel\(\{ focusTarget: "composer" \}\)/);
  assert.match(injection, /assetConsoleReturnFocus/);
  assert.match(injection, /frame\.focus\(\)/);
});

test("empty results are contextual and asset cards support keyboard activation", async () => {
  const [app, css] = await Promise.all([
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(app, /没有匹配的素材/);
  assert.match(app, /clear-empty-filters/);
  assert.match(app, /function clearAssetDiscoveryFilters/);
  assert.match(app, /card\.addEventListener\("keydown"/);
  assert.match(app, /\["Enter", " "\]/);
  assert.match(css, /\.card-select-toggle[\s\S]*width: 40px/);
  assert.match(css, /\.asset-card:focus-visible \.preview/);
});

test("the current folder toolbar exposes an inline create-folder flow", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(html, /id="newFolderButton"[\s\S]*?＋[\s\S]*?新建文件夹/);
  assert.match(html, /id="newFolderDialog"/);
  assert.match(html, /id="newFolderName"[^>]*maxlength="120"/);
  assert.match(app, /function currentFolderCreationContext/);
  assert.match(app, /api\("\/api\/folders", \{\s*method: "POST"/);
  assert.match(app, /parentPath: context\.parentPath/);
  assert.match(app, /已新建并打开/);
  assert.match(css, /\.toolbar > \.new-folder-button/);
});

test("folder cards expose direct rename without hiding the open action", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(html, /id="renameFolderDialog"/);
  assert.match(html, /id="renameFolderName"[^>]*maxlength="120"/);
  assert.match(html, /只修改文件夹名称，里面的素材保持不变/);
  assert.match(app, /document\.createElement\("article"\)/);
  assert.match(app, /renameButton\.textContent = "改名"/);
  assert.match(app, /openButton\.textContent = "打开"/);
  assert.match(app, /api\("\/api\/folders", \{\s*method: "PATCH"/);
  assert.match(app, /parentCaseId: state\.selectedCase/);
  assert.match(app, /state\.selectedCase = context\.parentCaseId/);
  assert.match(css, /\.folder-card-actions/);
  assert.match(css, /\.folder-card-preview-button:focus-visible/);
});

test("empty folders returned by the service remain navigable inside project scan roots", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const pathSource = extractFunctionSource(app, "pathParts");
  const normalizeSource = extractFunctionSource(app, "normalizeProjectDirectory");
  const rootsSource = extractFunctionSource(app, "projectScanRootDirectories");
  const hierarchySource = extractFunctionSource(app, "completeCaseHierarchy");
  const complete = new Function(`${pathSource}\n${normalizeSource}\n${rootsSource}\n${hierarchySource}; return completeCaseHierarchy;`)();
  const result = complete([], { name: "测试项目", scanRoots: ["02-cases"] }, [
    { path: "" },
    { path: "02-cases" },
    { path: "02-cases\\角色参考" },
    { path: "04_outputs" },
  ]);
  const ids = result.map((item) => item.id);
  assert.ok(ids.includes("."));
  assert.ok(ids.includes("02-cases"));
  assert.ok(ids.includes("02-cases\\角色参考"), "an empty nested folder is synthesized into navigation");
  assert.equal(ids.includes("04_outputs"), false, "folders outside scan roots stay hidden");
});

test("usage indicator animates by transform instead of layout width", async () => {
  const injection = await readFile(injectionPath, "utf8");
  assert.match(injection, /transition: transform 180ms ease/);
  assert.match(injection, /style\.transform = `scaleX/);
  assert.doesNotMatch(injection, /transition: width 180ms ease/);
});

