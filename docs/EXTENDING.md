# 配置与修改入口

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

## 源码修改地图

| 需求 | 模块 |
| --- | --- |
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
