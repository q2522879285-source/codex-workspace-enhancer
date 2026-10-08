# Codex Workspace Enhancer v3.0.3 — Windows 10 flavor

Win10 专用构建沿用 v3.0.3 的运行时和安装流程，输出文件名增加 `-win10` 后缀，默认构建行为不变。

该 flavor 与通用 Windows 包共用安装目录和状态目录，不能并行安装；按升级流程切换即可保留配置、台账和资产。

## 构建

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-release.ps1 -Flavor win10 -OutputDir .\release-win10
```

## 验收边界

要求 Node.js >=22.13.0 与官方 OpenAI.Codex AppX。当前仅完成静态和构建检查，未完成真实 Windows 10 实机验收；不要将构建通过视为现场兼容性证明。

## 发布附件校验

| 文件 | SHA-256 |
| --- | --- |
| `codex-sidebar-enhancer-win10.zip` | `1401ac08d765684bd809e0faaaba2f5bc17895ab4611b3fa9fa37439db671306` |
| `codex-workspace-enhancer-skill-win10.zip` | `f778baf811bc99c101da46cecf83dd9df259aa387f1c363b21b51b55a22d4001` |

本次发布沿用通用包已有的 TapNow 生成平台选项，但不包含任何 TapNow 私人项目、账号或项目资产。
