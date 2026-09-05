Codex Workspace Enhancer for Windows

需要 Node.js 22.13 或更新版本与 Codex 桌面应用。
在解压目录运行：powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
安装包含本地资产服务，不修改当前运行中的 Codex。请正常退出 Codex 后再使用增强器快捷方式。

配置和凭据保存在 %LOCALAPPDATA%\CodexSidebarEnhancer\asset-browser；初次安装生成随机本地 token。
升级保留配置与台账，卸载保留用户状态和资产；不访问或覆盖旧版独立 AssetBrowser 数据。
项目根、公用参考库与 MJ 库通过资产配置 projects 配置；参考库 id=ai-reference-library，MJ 库 id=mj-library。
MJ 库按文件名中完整原顺序 P 值组合分类；无法识别的不猜测。

摘要提醒为自选功能：
node "%LOCALAPPDATA%\Programs\Codex Sidebar Enhancer\scripts\setup-task-context-hooks.mjs"
然后在 Codex 的 /hooks 界面审阅信任。templates/task-context-rules.md 可手动合并到自己的 AGENTS.md。
停用：同一命令加 --remove。脚本仅处理自己登记的条目，不写信任库，不覆盖 AGENTS.md。
