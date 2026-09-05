# Codex Workspace Enhancer 2.0

让每个任务都有自己的工作台。

把 **任务、上下文、Skills 和项目资产** 接进 Codex 桌面应用。保留原生对话，在本机提供可配置、可修改的工作流增强。

[下载 v2.0.0](https://github.com/q2522879285-source/codex-workspace-enhancer/releases/tag/v2.0.0) · [修改与扩展](docs/EXTENDING.md) · [版本区别](CHANGELOG.md) · [English](README.en.md)

![Codex Workspace Enhancer 2.0 功能界面示意](docs/codex-workspace-enhancer-onepage.png)

## 一套连续的工作台

- **任务导航**：双列卡片 / 列表，置顶 / 项目 / 最近，保留原生任务入口。
- **上下文**：每个任务独立的目标、进展、下一步、固定约定；手动笔记单独保存。
- **接续提醒**：可选原生钩子提醒助手读取、核对或维护摘要，不另接总结模型。
- **Skills**：分类、搜索、收藏；选成输入区标签，随下一条消息发送。选择不等于已加载或执行。
- **默认 Skills（当前源码）**：通过“添加/删除”按任务维护默认项，标签不常驻删除按钮；配合已启用的摘要提醒，从下一条消息起提醒助手读取。不预置私人偏好。
- **项目资产**：默认跟随当前项目，切换公用库；图片、视频、音频、文档、网页、代码等按类型预览，可记住排除类别。
- **MJ 素材**：按可识别的完整 P 值组合分组，保留组合顺序，复制 `--p`。
- **历史与来源**：保存冷档案入口、文件引用和明确的任务来源，不把同项目文件都当成本任务生成物。

## 安装

本次参考环境：**Windows、Node.js 22.13+、Codex 桌面应用**。保留 macOS 安装入口，未完成本次真机验证。

### Windows 安装包

从 [Releases](https://github.com/q2522879285-source/codex-workspace-enhancer/releases/latest) 下载 `codex-sidebar-enhancer-windows.zip`，解压后运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

虽然保留旧下载文件名，**2.0 的这个包已包含本地资产服务**，不是仅前端包。安装不会强制关闭正在运行的 Codex；需要启用调试入口时，先正常退出，再打开安装生成的增强器快捷方式。

### 完整 Skill 包

下载 `codex-workspace-enhancer-skill.zip`，解压到 `%USERPROFILE%\.codex\skills`，然后运行：

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-workspace-enhancer\scripts\install-bundled.ps1"
```

两个包安装同一套运行核心；Skill 包附带检查、安装、验证说明。

### 开发者

```powershell
git clone https://github.com/q2522879285-source/codex-workspace-enhancer.git
cd codex-workspace-enhancer
npm ci
npm test
powershell -ExecutionPolicy Bypass -File .\tools\build-release.ps1
```

## 可选：启用摘要维护提醒

安装默认不更改全局 `AGENTS.md` 或钩子。要使用提醒：

1. 运行已安装的配置脚本：
   ```powershell
   node "$env:LOCALAPPDATA\Programs\Codex Sidebar Enhancer\scripts\setup-task-context-hooks.mjs"
   ```
2. 在 Codex 正常 `/hooks` 界面审阅、信任；等待一次真实任务事件确认加载。
3. 将 [摘要维护约定](templates/task-context-rules.md) 按需合并到自己的 `AGENTS.md`。

脚本合并自己登记的条目，不覆盖其他钩子、不改信任库。停用时对同一命令添加 `--remove`。

**摘要仍由当前助手维护。** 提醒降低漏维护的机会，不是无限记忆，也没有承诺固定 token 节省比例。

## 数据和配置放在哪里

| 内容 | Windows 默认位置 |
|---|---|
| 程序 | `%LOCALAPPDATA%\Programs\Codex Sidebar Enhancer` |
| 可选 UI 配置 | 安装目录的 `enhancer.config.json` |
| 本地资产配置、令牌、台账 | `%LOCALAPPDATA%\CodexSidebarEnhancer\asset-browser` |
| 独立任务摘要 | `$CODEX_HOME/task-context/<task-id>.json`，默认 `~/.codex` |
| 原始资产 | 用户自己配置的项目目录 |
| 手动笔记 | Codex 本地存储，按任务区分 |

已有工作目录中的 `work/task-context.json` 仅在 ID 匹配时复用。升级保留已有配置；卸载保留用户状态与资产。**旧独立 AssetBrowser 的数据不会被自动导入或覆盖**，迁移需明确选择自己的目录。默认资产服务使用本机 5177 端口；如果已被另一服务占用，会明确报错，不接管或终止旧服务。

发布包只含通用代码、空白配置初始化和说明，不含作者的会话、项目目录、账户令牌、素材、票据或私有 Skill。资产服务仅监听本机，初次运行生成独立随机令牌；这不是云端存储或团队账号系统。

## 修改入口

分类与常用技能用 JSON 配置；界面样式、任务摘要存储、文件预览、项目解析和 MJ 分组均有明确的源码模块。[查看配置示例及扩展位置](docs/EXTENDING.md)。

## 已知边界

- 社区增强项目，非 OpenAI 官方产品。部分交互依赖桌面应用的内部 UI，Codex 更新后可能需要适配。
- 文档预览以可支持格式的文本提取为主，不是完整 Office 排版或编辑。
- 冷历史入口负责关联与发起检索；具体归档、索引和检索需安装相应工具或 Skill。
- 3D 重建、配乐等可选工具需另装对应 Skill / Python 依赖，不属于干净安装的核心能力。
- 图中界面为功能示意，具体 Node 最低版本以安装说明为准。

## License

[MIT](LICENSE)
