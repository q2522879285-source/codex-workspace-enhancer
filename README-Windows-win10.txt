# Codex Workspace Enhancer 3.0.3 — Windows 10 flavor

此构建 flavor 面向 Windows 10 上的官方 OpenAI Codex AppX 桌面应用。

## 前置条件

- Node.js >=22.13.0
- 官方 OpenAI.Codex AppX（Windows 10）
- PowerShell 5.1 或更高版本

## 构建与安装

在仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-release.ps1 -Flavor win10 -OutputDir .\release-win10
```

输出：

- `codex-sidebar-enhancer-win10.zip`
- `codex-workspace-enhancer-skill-win10.zip`
- 对应的 `.sha256.txt` 校验文件

解压 `codex-sidebar-enhancer-win10.zip` 后运行 `install-windows.ps1`。Skill 包中的运行时归档和 manifest/verify/install 脚本保持兼容，内部运行时文件名为 `codex-sidebar-enhancer-windows.zip`。

本 flavor 与 v3.0.3 通用 Windows 包共用安装目录和状态目录，不能并行安装；切换时按升级流程覆盖，配置、台账和资产会保留。

## 验证边界

构建会执行归档与 manifest 生成；本 flavor 未进行真实 Windows 10 实机验收。文档中的兼容性前提基于 Node 与官方 OpenAI.Codex AppX，不能替代现场验证。
