# Global work map

The global map models directions, work items, and linked native Codex tasks. It is separate from the per-thread Task Map in [thread-task-map.md](thread-task-map.md); do not describe them as one state store.

`inject/global-task-map.js` provides map/list/relationship views, dragging/zoom, next actions, notes, status, undo, JSON export, and local persistence. Linked tasks remain native conversations. Editing a work item does not send a message or rewrite conversation history. Preserve user structure and links across UI refresh.

Search has three distinct scopes:

- Map search covers work-item/direction text and linked task titles.
- Native task linking searches task titles/working-directory metadata through the paginated catalogue, not conversation bodies.
- Optional CortexDB is a one-way derived lexical index of map fields and linked title/ID metadata. It is not the authoritative map, a full-chat archive, semantic search, or a background reasoning model.

Set `CODEX_CORTEXDB_EXECUTABLE` to the user's installed compatible executable only when enabling that optional index. It is not included in the package. Missing executable/tools leave the index unavailable, while ordinary map editing remains usable. The bridge strips LLM/embedding/remote settings from its child process; do not enable them implicitly.

Check persistence, undo/export, linking and switching tasks without accidental sends. For index changes, test available/unavailable service states and rebuild from the map without changing its authority or copying conversation text. Never treat index synchronization as proof of task completion.
