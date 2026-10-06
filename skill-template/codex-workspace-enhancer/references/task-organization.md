# Opt-in assistant task organization

Enable this workflow only when the user adopts it for their own workspace or explicitly asks to organize the current task. Installation does not enable it, change global rules, or grant tool permission. The packaged `templates/task-organization-rules.md` is a copyable starting point; the user decides where it applies.

Only the main assistant handles the current native Codex task, once before its first substantive deliverable. Do not run it from a watcher, subagent, background automation, or ChatGPT conversation; do not scan or reorganize historical tasks.

1. Identify the current native task ID and read its matching existing summary. If `sidebarOrganization.status` is `complete` or `preserved`, stop; for `partial`, retry only unfinished actions.
2. Discover native `list_threads`, `set_thread_title`, `create_sidebar_section`, and `move_thread_to_sidebar_section` tools. Query the current task and available sections. If it is absent or its ownership is ambiguous, make no write.
3. Use `Module | ongoing goal` (or `模块名｜持续目标`) from the task's actual evidence. Preserve a user-requested/manual title and an already clear title. If automatic versus manual origin is uncertain, preserve the title.
4. Preserve pinned/custom-section placement and project containers. For an unclassified, projectless task, reuse an existing matching module section; create one only if absent. Never change layout, sort order, another task, or a project.
5. Rename/move through native tools with explicit task ID, then reread the actual title and section membership. An accepted write response alone is not verification. If native temporary item keys cannot be unambiguously mapped to the current task, keep the action unconfirmed.
6. Atomically merge `sidebarOrganization` into the one matching task summary, preserving unknown fields. Record `status` (`complete`, `preserved`, or `partial`), `title`, `sectionId`, `titleDone`, `sectionDone`, and `organizedAt`; include the actual `sidebarItemKey` when available. Mark actions done only after readback. If no summary exists, follow the user's summary policy instead of creating a competing state store.

If native tools are missing or a write fails, retain verified successful actions, record partial state if a valid summary exists, and report the smallest relevant limitation. Never write Codex databases, `.codex-global-state.json`, hooks, trust records, or global agent rules as a fallback. Subsequent user renames take precedence.
