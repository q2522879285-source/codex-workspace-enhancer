# Thread Task Map

The map is a durable core plan for one task, not a frequently rewritten context summary. Codex owns the conversation; the enhancer owns only derived node text, states, references, and layout.

## Data and ownership

- Initialize from the matching task context's `taskMap.coreTask` and `taskMap.branches`, or use its goal/progress/next step as bounded fallback data.
- A branch has a stable `id`, `label`, `text`, `state`, optional `source`/`updatedAt`, and optional `children`. Never use a copied conversation as node content.
- Capture the initial structure as a per-task `mapDocument`. Context refresh must not reconstruct it. Normalize the task ID before choosing the document and ignore late responses from a previous task.
- Persist local node edits and canvas coordinates by task. User-edited fields take precedence over source updates. Do not send or rewrite messages when editing the map.
- Use `unknown`, `pending`, `in-progress`, `done`, `blocked`, or `cancelled`; show unknown when evidence is absent. Source labels and timestamps are evidence metadata, not proof of completion.

## Interaction

The center is the core task; branches explain its goal, status, milestones, next action, blockers, and related content. Display short branch summaries rather than empty category labels alone.

- Drag nodes, pan blank space, zoom, fit, and reset layout without recreating the document.
- Double-click edits node text. Add creates a local child. Delete applies to self-created nodes. State selection and JSON export operate on the active task only.
- Synchronize source-backed status fields by stable node ID, automatically on source refresh or through the explicit sync button. Require a source and valid update time, ignore older progress, and preserve manually set states. Do not synchronize core text, branch text, or structure.
- Expanded mode hides task navigation and gives roughly one third to conversation and two thirds to the map on a sufficiently wide window. Collapse restores the previous layout.
- Retain keyboard node movement, inspectable details, and a text outline.

## Checks for changed behavior

Use the runtime's task-map tests to verify task A/B isolation, timestamp-only refresh stability, synchronization surviving cleanup, manual-edit precedence, node actions, export contents, and reloading saved state. Inspect actual desktop behavior when changing layout or event wiring; a passing syntax check alone does not establish clickable controls or user acceptance.

Core source entry points are `taskMapModel` and `renderTaskMapSection` in `inject/conversation-preview.user.js`, with task-context normalization in `lib/preview-data.mjs`. The repository's `docs/thread-task-map.md` documents the user workflow.
