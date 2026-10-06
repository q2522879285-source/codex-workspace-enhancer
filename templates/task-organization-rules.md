# 可选：当前会话命名与模块归组

只有用户明确采用本规则后才启用；安装 Workspace Enhancer 本身不启用。只由主助手处理当前原生 Codex 会话，在首个实质任务已有可交付结果后、最终回复前执行一次。子助手、后台 watcher、定时自动化和 ChatGPT 会话不执行；不批量修改历史。

- 读取当前会话 ID 和匹配的唯一摘要。`sidebarOrganization.status` 为 `complete/preserved` 时不重复；`partial` 时只补未完成动作。
- 用原生 `list_threads` 查询当前会话和现有分区；找不到当前会话或无法确认归属时不写入，不把截断列表当全量历史。
- 标题采用「模块名｜持续目标」，根据当前任务事实确定，不根据目录名猜。保留用户指定、手动修改或已有清晰标题；无法确认是否自动标题时保留。
- 置顶、已有自定义分区和项目容器保持原位；不移动其他会话或项目，不改布局与排序。未分类且无项目的当前会话优先复用同模块分区，没有才创建。
- 仅通过原生 `set_thread_title`、`create_sidebar_section`、`move_thread_to_sidebar_section` 操作，传明确会话 ID；不写数据库、全局状态、hooks 或信任记录。
- 再用 `list_threads` 回读实际标题和分区归属。仅写入回执不算完成；临时侧栏键无法准确匹配时不猜映射。
- 原子合并唯一摘要的 `sidebarOrganization`，保留其他字段：`status`（`complete/preserved/partial`）、`title`、`sectionId`、`titleDone`、`sectionDone`、`organizedAt`；有实际侧栏键时记录 `sidebarItemKey`。仅回读确认后标记完成。没有有效摘要时沿用用户摘要规则，不另建竞争状态源。
- 工具缺失或失败时保留已确认部分，不绕过原生工具。后续用户改名不覆盖。

规则只约束用户选定的适用范围；没有个人 UUID 门槛、历史例外或作者默认分区。用户可随时停用或调整。
