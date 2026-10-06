# Codex Workspace Enhancer v3.0.2 更新说明

本次是 v3.0.1 的稳定性修复版，保留现有工作台功能与 Tibo 活动概率规则，沿用原介绍图。

## 修复内容

- **初始化**：恢复 `currentConversationThreadId`，修复缺失函数导致的 `ReferenceError`。优先使用当前活动任务，必要时读取并规范化任务快照。
- **任务跳转**：恢复 `navigateToCodexThread`，让全局搜索结果与全局地图的关联任务入口发送正确的原生导航请求；空 ID 与临时任务键不生成路由。
- **MOKE 资料库**：增强器销毁后停止状态重试，并忽略迟到的配置或状态失败，不再修改旧资料库状态。

## 回归与压测

新增 8 项回归测试；全量 `npm test` 共 227 项，**223 通过、0 失败、4 项 macOS 平台测试跳过**。

| 检查 | 结果 |
| --- | --- |
| 100 次 A/B 任务切换、1000 次显式刷新、30 次重注入 | 页面异常与未处理 rejection 均为 0 |
| 40 次原生刷新调用 | 合并为 2 次 refetch |
| 60 次重注入后的 GC 采样 | 预热后 DOM 与监听器计数稳定，堆增量 2700 bytes |
| 销毁后的两阶段 MCP 迟到失败 | 请求数量不增加，旧状态不变 |
| 384 次任务数据读取，并发 24，80 个同目录任务 | 未发生任务串台，缓存上限 64 |
| 192 次地图与目录回包 | 逆序响应保持请求关联 |
| 104 次本地 HTTP 请求，并发上限 16 | 中断、超量、超时、拒绝连接正确收尾，结束后 sockets 为 0 |

测试可从源码运行：`npm test`。renderer 测试使用已有 Playwright 与 Chromium；可通过 `RENDERER_PLAYWRIGHT` 和 `RENDERER_BROWSER` 指定本地路径，未找到 Playwright 时会明确跳过浏览器测试。

## 验证范围

压力测试使用隔离 Chromium、合成原生 DOM、synthetic binding 与本地 HTTP；不包含 live Codex、真实 CortexDB、外部 API、登录、启动器或视觉体验验收。GC 采样不是完整的零内存泄漏证明。无回包的已有 MCP 请求仍等待原超时，并未增加即时取消机制。

发布附件包含 Windows ZIP、完整 Skill ZIP、SHA-256 校验文件和本更新说明。升级方法与配置边界不变。

[下载发布包](https://github.com/q2522879285-source/codex-workspace-enhancer/releases/tag/v3.0.2) · [安装与配置](https://github.com/q2522879285-source/codex-workspace-enhancer/blob/main/README.md)
