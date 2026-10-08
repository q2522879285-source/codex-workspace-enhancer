Codex Workspace Enhancer 3.0.3 for Windows

需要 Node.js >=22.13.0 与 Codex 桌面应用。
解压后运行：
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1

两个发布 ZIP 都包含本地资产服务；安装不强制退出运行中的 Codex。
需要调试入口时，正常退出后使用安装生成的增强器快捷方式。
启动视频是可选功能，需要用户本地视频和 ffplay.exe；没有私人视频随包提供。

程序默认：%LOCALAPPDATA%\Programs\Codex Sidebar Enhancer
资产配置/令牌/台账：%LOCALAPPDATA%\CodexSidebarEnhancer\asset-browser
项目根、公用参考库和 MJ 库通过本地 projects 配置；新安装无个人项目，捕获/路由关闭。
升级保留配置与台账；卸载保留用户状态和资产；旧独立 AssetBrowser 不会自动迁移。
端口冲突明确报错，不终止其他服务。账号 profiles 与原文冷档是用户私有数据，不随包分发。

摘要提醒为自选功能，在安装目录运行：
node .\scripts\setup-task-context-hooks.mjs
然后通过 Codex /hooks 审阅信任；移除添加 --remove。
templates/task-context-rules.md 与 task-organization-rules.md 由用户按需采用，不自动写 AGENTS.md。
会话整理由助手使用原生工具执行并回读，不是后台 watcher 自动修改数据库。

MOKE 需用户配置授权 moke MCP；CortexDB 需 CODEX_CORTEXDB_EXECUTABLE；
Tibo 公共源需 CODEX_TIBO_FEED_URL，百分比是启发式信号，非实际账号重置保证；
原文冷存自动模式默认关闭，关键词索引需要 Python。

完整说明见 README.md、docs/EXTENDING.md；可复现检查见 VERIFICATION.txt。
