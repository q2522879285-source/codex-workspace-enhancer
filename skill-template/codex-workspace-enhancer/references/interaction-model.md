# Interaction model

## Sidebar

Keep Codex's native density. Fixed shortcuts and the Pinned / Projects / Recent tabs are layout siblings above the scroll region, not a translucent cover. Search and task previews belong below the tabs. A task card should answer: what this task is, where it stopped, and what can be resumed.

## Asset Console

Open in the current Codex workspace and retain the native task list. The primary navigation is Pending -> Project Assets -> Curated. Within a project, folder hierarchy must be directly navigable. Primary actions are create folder, rename, move, automatic organization, select/compare, and return to task.

Task changes while the panel is open must replace the old frame context before any further action. Loading transitions may animate briefly, but reduced-motion users still receive `aria-busy` state and old content is not interactive.

## Handoff and error recovery

- "Add to current task" writes one to eight absolute paths into the active composer and dispatches input events only.
- "Undo move" is available after successful movement.
- Partial failure reports successful and failed items separately.
- Stale responses are ignored by project, folder, request, and workspace generations.
- Empty states explain the next useful action; errors offer retry or a reversible exit.
