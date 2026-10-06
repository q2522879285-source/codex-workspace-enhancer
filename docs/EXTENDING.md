# 配置与修改入口（3.0）

优先使用现有配置。需要改变交互或数据读取方式时，再修改对应模块；无需另建插件框架。

## Skill 分类与默认收藏

在安装目录创建 `enhancer.config.json`。Windows 默认安装目录为 `%LOCALAPPDATA%\Programs\Codex Sidebar Enhancer`。

```json
{
  "skills": {
    "categories": [
      { "label": "开发", "keywords": ["code", "test", "开发"] },
      { "label": "文档", "keywords": ["document", "写作"] }
    ],
    "defaultFavorites": ["Example Documentation Skill"]
  }
}
```

- `categories` 每项包含 `label` 和字符串数组 `keywords`。关键词按规范化后的标题和描述做包含匹配；不是正则表达式。
- “常用”和“全部”是内置分类，不作为自定义标签。
- `defaultFavorites` 使用实际 Skill 的**精确显示标题**，仅作为没有已保存收藏时的初始值；不覆盖用户已有收藏。
- 配置在注入器启动时读取。保存后重新启动增强器注入进程；无需修改 Codex 应用包。

入口：`scripts/injector.mjs` 读取配置，`inject/conversation-preview.user.js` 实现分类、收藏和原生 Skill 附件交互。

## 全局与项目默认 Skills

右侧 **Skills → 默认执行 → 添加/删除** 进入管理，并明确选择全局或项目作用域。全局默认影响全部会话，项目默认只影响该项目；项目项以当前原生项目归属为准。可搜索或按分类添加，已有默认项显示“删除”；点击“完成”后显示标签。删除仅移出所选作用域的默认，不卸载技能，也不改变普通收藏。

默认项统一保存到 `$CODEX_HOME/skill-defaults.json`，未设置 `CODEX_HOME` 时使用 `~/.codex`。文件包含全局 `defaults` 和按项目 ID 保存的 `projects`，所选项记录技能名称及本机 `SKILL.md` 路径。通用版初始为空。摘要、摘要的 `agreements` 与独立笔记均不保存这些默认项；修改不向输入框写文字，也不发送消息。

要让助手收到这些设置，需先按下文启用并信任摘要提醒钩子。保存后从下一条消息起提醒助手读取适用的全局与项目默认 Skill；当前明确要求及更高优先级规则仍优先。仅选择或保存默认项不等于已加载或已执行，也不会绕过钩子信任。

默认项由界面管理。维护摘要时不把默认配置复制进 `agreements`，不恢复已删除项，也不使用旧摘要覆盖当前全局或项目选择。

## 项目与素材目录

Windows 运行状态目录默认为 `%LOCALAPPDATA%\CodexSidebarEnhancer\asset-browser`。修改其中的 `asset-browser.config.json`，不要把个人路径写进公开源码。下面的路径只是示例，使用前替换为自己已有的目录：

```json
{
  "enabled": true,
  "projects": [
    {
      "id": "demo-project",
      "name": "示例项目",
      "path": "D:/Projects/Demo",
      "scanRoots": ["."]
    },
    {
      "id": "ai-reference-library",
      "name": "精选参考",
      "path": "D:/Projects/ReferenceLibrary",
      "scanRoots": ["."]
    },
    {
      "id": "mj-library",
      "name": "Midjourney 素材",
      "path": "D:/Projects/Midjourney",
      "scanRoots": ["."]
    }
  ],
  "automation": {
    "inbox": { "enabled": false, "capturePolicy": "ticketed-only" },
    "routing": { "enabled": false }
  },
  "deduplication": { "enabled": false }
}
```

`scanRoots` 是项目目录内的相对子目录。`ai-reference-library` 和 `mj-library` 是现有界面识别的专用项目 ID；可修改显示名称和路径，不要随意改名后仍期待原来的专用入口。

`CODEX_ENHANCER_STATE_DIR` 可指定状态根目录，服务会在其下使用 `asset-browser` 子目录。更细的环境变量映射见 `lib/install-config.mjs` 的 `assetBrowserRuntime()`；例如 `ASSET_BROWSER_CONFIG` 可直接指定配置文件。

新安装不自动迁移旧版独立 AssetBrowser 的配置、票据或素材。两个发布 ZIP 都自带后端；5177 端口冲突会明确报错，不会关闭占用端口的旧服务。

## 任务摘要

默认位置为 `CODEX_HOME/task-context/<threadId>.json`，未设置 `CODEX_HOME` 时使用用户主目录下的 `.codex`。已有 `cwd/work/task-context.json` 且其中任务 ID 与当前任务一致时，继续使用该文件。

示例中的 UUID 为合成值，实际使用时替换为当前任务 ID：

```json
{
  "threadId": "11111111-2222-4333-8444-555555555555",
  "updatedAt": "2026-09-06T08:00:00Z",
  "goal": "整理示例项目的交付文档",
  "progress": "目录已确认，正文待补充",
  "nextStep": "完成使用说明",
  "agreements": ["保留已有文件"],
  "references": [
    {
      "kind": "asset",
      "label": "使用说明",
      "path": "D:/Projects/Demo/README.md"
    }
  ]
}
```

必填字段为 `threadId`、有效 ISO 时间 `updatedAt`、三个纯文本字段 `goal/progress/nextStep` 和字符串数组 `agreements`。没有真实待办时 `nextStep` 留空。写入先使用同目录临时文件，再替换正式文件。

`references` 可选：

- 本地文件：`kind: "asset"`、`label`、绝对 `path`，可附真实 `sourceThreadId`、`projectId`、`ticketId`、`outputId`。
- 冷历史：`kind: "history"`、`label`、绝对 `archivePath`，可附真实 `sourceThreadId` 和非负整数 `recordId`。

只记录确实关联的引用。`lib/task-references.mjs` 从已有项目绑定和生成票据中补充本任务及显式关联历史任务的最多 6 个近期资产输出，不把同项目所有文件当成本任务产物。

手动笔记独立存于浏览器 localStorage 的 `codex-workspace-enhancer:task-notes-v1`，按任务隔离；摘要写入不应覆盖它。摘要由助手维护，不是后台模型自动生成。

## 可选摘要提醒钩子

在安装目录运行：

```powershell
node .\scripts\setup-task-context-hooks.mjs
```

脚本向 `CODEX_HOME/hooks.json` 合并 SessionStart、UserPromptSubmit 和 Stop 事件，保留不属于本工具的钩子。随后通过 Codex 正常 `/hooks` 界面审阅信任；以真实任务事件确认加载情况，不把文件存在当成已生效。

移除本工具登记的提醒：

```powershell
node .\scripts\setup-task-context-hooks.mjs --remove
```

可选参数：`--codex-home`、`--install-dir`、`--node-path`。设置自定义路径时使用绝对路径。

`scripts/task-context-guard.mjs --read` 读取当前任务摘要；`--ack` 仅在已有本轮提醒记录时登记“已核对、无变化”，不刷新摘要时间。命令行模式通过 `CODEX_THREAD_ID` 识别任务。


## 启动器、任务地图与内嵌浏览器

Windows 启动入口为 `windows/launch.ps1`，配合 `start-injector.ps1`、`startup-overlay.ps1`、`stop-injector.ps1`。视频需要用户本地视频和 `ffplay.exe`，公开包不带私人视频；启动动效随实际应用就绪释放，保留超时兜底；修改就绪条件后要在桌面验证，不以固定等待或脚本成功退出代替。

任务地图见 [thread-task-map.md](thread-task-map.md)。它是每任务独立、可编辑的核心计划，不是每次摘要刷新都重建的聊天摘要。源更新只同步有证据的状态；手动文字、结构和状态有优先权。

内嵌浏览器由 `inject/global-browser.js` 和注入器加载，提供标签、地址/搜索和快速对话入口。网址使用 HTTP(S)；网站是否允许内嵌取决于其自身策略和桌面运行环境。快速对话只有用户明确提交时才向选定原生任务发消息；打开浏览器、切换任务、选取资产不提交消息。

## 全局工作地图与可选索引

`inject/global-task-map.js` 管理方向、事项和关联原生会话，支持地图/列表/关系视图、撤销和导出；与每任务的 Thread Task Map 分开。本地地图是权威状态，可选 CortexDB 只是事项字段及关联会话标题/ID的单向词法派生索引，不读取全部聊天正文，不提供语义记忆或自动推理。

设置 `CODEX_CORTEXDB_EXECUTABLE` 指向自己安装的兼容程序后才能启用索引；包不附带可执行文件。未配置时普通地图仍可使用，索引显示不可用。会话关联选择器检索标题/工作目录元数据，与地图事项搜索、CortexDB 检索的范围不同。

## 原生额度、账号与 Tibo 公开动态

真实剩余额度/重置时间来自原生状态，当前任务 Token 是另一个指标。用户明确切换已配置的本地账号 profile 后，原生 `account/login/start` 写入并通过 `account/read` 回读；网页打开或登录写入回执不等于桌面已切换。发布包没有账号、凭据和个人 profile。

Tibo 公共源默认不请求。设置 `CODEX_TIBO_FEED_URL` 才启用。使用 BetterOPC 适配地址 `https://betteropc.com/api/browser/product-tracking/codex/history` 时，合并 `https://betteropc.com/api/browser/product-tracking/codex/challenge` 的 28 天挑战事件，并可读取公开 reset-signals 页面取得具体重置目标时间。自定义 feed 仍须符合现有 schema，挑战双源属于该 BetterOPC 适配。

挑战覆盖北京时间 2026-10-05 至 2026-11-01，每天按午夜分界，11-02 00:00 结束。活动期每日以 50% 为自定展示基准；同一北京时间日确认 `signalType=reset`、`status=executed` 且 `resetKinds` 包含 `hard` 后归零，下一活动日恢复 50%。产品改进只计入今日进展，不作为全面重置。有效的具体未来重置预告可按状态与时间提高指标。50% 未经统计校准；所有百分比均不代表官方承诺或当前账号实际已重置。

界面分开呈现活动第几天、今日进展、北京时间截止、最新消息发布时间、预计重置时间、来源与概率原因。每日活动截止时间不会冒充预计重置时间；没有具体预告时，预计重置时间保持空缺。

缓存默认 60 秒、请求超时 5 秒，每次回读都根据当前时间与挑战源的服务器时钟偏差重算倒计时、跨日状态和指标。网络失败可用旧数据时标记 stale，不把过期信息当新确认；首次失败显示不可用，不伪造 0%。挑战源缺失也保持可见的过期/不可用状态。

相关入口：`lib/tibo-public-feed.mjs`、`lib/account-profiles.mjs`、`scripts/injector.mjs` 与额度/账号 UI。自定义 feed 必须符合现有适配 schema；不把私人 URL、账号或抓取记录写入公开模板。

## 可选资料库 / MOKE

资料库 UI 不需要作者的项目资料，但云端列表需要用户单独配置、授权原生 MCP server `moke`。公开包不包含账号、token、私有资源列表或自动写入的 MCP 配置。按服务商当前连接说明配置；不要将示例中的服务名误当成已连接证据。

授权桥使用本机 Codex CLI 的 `mcp login moke --no-browser` 流程，并打开服务授权网址。使用前确认 CLI 可用、server 已配置及当前授权范围。界面区分未配置、待授权、授权失败和已授权；成功连接仍需真实返回资料列表才能确认资源可读。授权浏览器页面打开不等于登录完成。

本地素材库与云端资料库不是同一个配置面：前者使用 `asset-browser.config.json` 的本地目录，后者使用原生 MCP 配置与服务账号。新增云服务商时修改现有 provider/UI/native bridge 的对应模块，不把服务凭据写进公开配置。

## 可选原文冷存档

`lib/cold-history-store.mjs` 与 `scripts/cold_history.py` 提供原文复制与关键词索引。默认自动模式关闭；用户可在当前任务控件手动保存或明确启用自动模式。自动只处理启用后有新活动、终态且源文件稳定的主任务；不删除或改写活跃历史。默认归档根为 `CODEX_HOME/cold-history`，状态为 `CODEX_HOME/cold-history-state.json`；Python 可用是索引前置条件。

归档包含完整聊天原文，不能放入发行包。冷档状态按当前任务隔离，摘要仅保留准确引用；已有路径链接不等于已完成存档/索引。备份文件、索引、manifest 和可检索结果需分别检查，不以“已排队”代替成功。

## 原生更新入口

快捷入口确认后触发原生检查/更新 UI，依赖当前桌面节点/文案；不是另一个自动下载器。调用入口、检查完成、更新可用与安装完成是不同状态，不通过包测试宣称实际更新。

## 可选会话命名与模块归组

[templates/task-organization-rules.md](../templates/task-organization-rules.md) 是通用 opt-in 规则。用户明确采用后，由当前主助手在首次实质结果交付前执行一次「模块名｜持续目标」命名与归组，通过原生工具写入并回读。安装不启用它，也不修改用户的 `AGENTS.md`、hooks 或信任状态。

保留用户手动标题、置顶、项目容器和已有自定义分类；只整理当前任务，不批量改历史。缺原生工具时停止该动作，不写数据库兜底。结果合并到匹配的唯一任务摘要的 `sidebarOrganization`：`status`（`complete/preserved/partial`）、`title`、`sectionId`、`titleDone`、`sectionDone`、`organizedAt`，有实际侧栏键时记录 `sidebarItemKey`。只在回读后标记完成；停用时从用户选择的规则范围移除该段即可，不回滚用户已有命名。

## 验证与回滚边界

Skill 包保留 `inspect.ps1`、`install-bundled.ps1 -WhatIf`、`verify.ps1`。自定义安装路径时，inspect/verify 同时传 `-EnhancerDir` 和 `-StateDir`；`-BackendDir` 未指定时从安装目录派生。`verify.ps1 -BundleOnly` 只查包，不声称已安装；`-SkipHealth` 不证明服务可用。

Windows 安装失败恢复本次改动的 owned runtime 文件并保留配置、台账和素材。主动降级使用选定旧发布包的安装器，沿用相同安装/状态路径并先保留当前状态；这不是项目文件或云账号回滚。移除运行时前审阅 `windows/uninstall.ps1` 参数，用户未要求删除时保留状态与资产。

## 源码修改地图

| 需求 | 模块 |
| --- | --- |
| 启动与就绪动效 | `windows/launch.ps1`、`windows/startup-overlay.ps1` |
| 内嵌浏览器 | `inject/global-browser.js` |
| 地图界面 | `inject/global-task-map.js`、`inject/conversation-preview.user.js` |
| 资料库与 MOKE 授权桥 | `inject/conversation-preview.user.js`、`scripts/injector.mjs` |
| 任务右栏、笔记、Skill 交互 | `inject/conversation-preview.user.js` |
| 注入、刷新、原生数据桥接 | `scripts/injector.mjs` |
| 摘要路径和字段读取 | `lib/task-context-store.mjs` |
| 历史及资产引用 | `lib/task-references.mjs` |
| 任务预览数据 | `lib/preview-data.mjs` |
| 当前项目解析、目录遍历、文件预览 | `asset-browser/codex-workspace.js` |
| 资产 API | `asset-browser/server.js` |
| 资产界面发布源 | `asset-console/public/` |
| 状态目录及环境变量 | `lib/install-config.mjs` |
| 安装与发布包 | `install-windows.ps1`、`tools/build-release.ps1` |

构建脚本将 `asset-console/public/` 复制到打包后端的 `public/`，修改资产界面时以此为发布源。运行 `npm test` 检查变动涉及的行为；私有项目资料、令牌、摘要和票据不加入提交或发布包。

Windows 是本次验证平台。macOS 脚本保留，但本次没有 Mac 实机验证。与 Codex 内部界面相关的修改需要在对应桌面版本验证；文档预览不等于完整排版渲染，Skill 选择也不等于已经执行。
