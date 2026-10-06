# Codex Workspace Enhancer v3.0.1 更新说明

本次更新 Tibo 公共动态与概率展示，保留 v3.0.0 的其余工作台功能。

## 28 天挑战与概率规则

BetterOPC 适配合并 history 和 challenge 双源。挑战覆盖北京时间 2026-10-05 至 2026-11-01，每天按午夜切日，11-02 `00:00` 结束。

活动期每日采用 50% 自定展示基准。当天确认已执行全面重置后归零，下一活动日恢复 50%；具体的未来重置预告可按状态与时间提高指标。产品改进只影响今日进展，不会被当作全面重置。

50% 未经统计校准，显示的百分比不代表 OpenAI 承诺或当前账号实际已重置。

## 展示与缓存

界面分开显示活动第几天、今日进展、北京时间截止、最新消息发布时间、预计重置时间、来源和概率原因。活动截止时间与预计重置时间分别处理，没有具体预告时不填入预计重置时间。

每次读取缓存都重算倒计时、跨日状态和指标，并使用挑战源的服务器时钟偏差。网络失败时，保留的数据标记过期；首次失败显示不可用，不把缺失数据写成 0%。

## 启用方式与发布文件

公共源仍按需启用。配置 `CODEX_TIBO_FEED_URL` 才发起请求，未配置时不请求。BetterOPC 兼容入口为 `https://betteropc.com/api/browser/product-tracking/codex/history`，该适配同时读取公开挑战源。

发布附件包含 Windows ZIP、完整 Skill ZIP、SHA-256 校验文件和本更新说明。使用既有工作台功能图。

源码和发布包校验不包含新界面的真机交互或云账号验收。

[下载发布包](https://github.com/q2522879285-source/codex-workspace-enhancer/releases/tag/v3.0.1) · [安装与配置](https://github.com/q2522879285-source/codex-workspace-enhancer/blob/main/README.md)
