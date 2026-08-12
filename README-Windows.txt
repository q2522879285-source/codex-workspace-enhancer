Codex Workspace Enhancer · Windows

推荐安装：下载 codex-workspace-enhancer-skill.zip，直接解压到
%USERPROFILE%\.codex\skills

压缩包内已经包含 codex-workspace-enhancer 目录。然后在 PowerShell 中运行：
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-workspace-enhancer\scripts\install-bundled.ps1"

完整包包含：
- Codex 任务侧栏增强
- Skill 管理与折叠分组
- 内嵌资产控制台
- 本地 AssetBrowser 服务
- 安装、验证与可逆回滚脚本

只安装 codex-sidebar-enhancer-windows.zip 时，需要机器上已有兼容的 AssetBrowser 本地服务。

项目地址：
https://github.com/q2522879285-source/codex-workspace-enhancer
