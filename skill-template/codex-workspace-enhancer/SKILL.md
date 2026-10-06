---
name: codex-workspace-enhancer
description: Install, inspect, configure, repair, or extend the Codex desktop workspace enhancement with task recall, a per-thread task map, Skill selection, embedded browsing, and local assets. Use for this enhancement's Windows package and adapter work, not for ordinary task naming or general file management.
---

# Codex Workspace Enhancer

Keep Codex's native conversation, sidebar, projects, and composer in control. This package supplies a Windows reference runtime; other platforms require their own validated adapter. It has no dependency on private Skills.

## Choose the working scope

Run paths below from this Skill directory. In the source repository, runtime files live at the repository root; in the Skill release, inspect them inside `assets/runtime/codex-sidebar-enhancer-windows.zip` after extracting to a temporary directory. Do not modify the manifest-verified bundle in place.

- **Inspect/install/update:** read [installation.md](references/installation.md), run `scripts/inspect.ps1`, review `scripts/install-bundled.ps1 -WhatIf`, then install only within the user's authorized scope. Run `scripts/verify.ps1` against the actual install/state paths.
- **Task recall, layout or map:** read [interaction-model.md](references/interaction-model.md), [global-work-map.md](references/global-work-map.md), [thread-task-map.md](references/thread-task-map.md), and the relevant sections of [acceptance-checklist.md](references/acceptance-checklist.md).
- **Embedded browser, local assets, cloud library, account/usage or Tibo signals:** read [optional-surfaces.md](references/optional-surfaces.md) and their relevant acceptance checks. Existing service/account configuration is a prerequisite, not something installation silently supplies.
- **Port or extend:** read [architecture.md](references/architecture.md) and [adapter-contract.md](references/adapter-contract.md). Report missing adapter capabilities; do not claim untested platform support.
- **Opt-in task naming/grouping:** read [task-organization.md](references/task-organization.md). This is an assistant workflow using native tools, not a watcher feature. Installing the runtime does not enable it.

## Shared invariants

- Preserve user configuration, ledgers, projects, media, notes, manual titles, and native controls. Keep fixed controls in normal layout flow above scrolling content.
- Bind task context and map reads/writes to the current task and request generation. Ignore late responses; never show task A's data as task B's.
- Keep map node text, states, references, and layout as derived editable data, not copied conversation history. Preserve manual edits on source refresh; editing a node never sends a message.
- Display actual current rate-limit state and unknown when unavailable. Account reset estimates are not confirmed account events.
- Return explicit absolute local paths to the composer; selecting a Skill or asset never submits a message. A user-initiated quick-chat send is a separate explicit action.
- Keep local asset proxy access limited to its dedicated frame/session. Keep API tokens out of page JavaScript, source packages, and logs.
- Use registered generation provenance for capture/routing. Ordinary Downloads and same-project files are not evidence of task ownership.
- Filesystem mutations remain explicit and scoped. Preserve protected project content; cleanup touches only owned cache roots. Rollback restores owned runtime files, not arbitrary project directories.
- Startup completion follows application readiness with explicit timeout fallbacks, not only a fixed cosmetic delay. Respect reduced motion and make loading/error states inspectable.

## Completion evidence

Use the relevant [acceptance checks](references/acceptance-checklist.md), not all modes on every request. Run deterministic checks before desktop interaction tests. Source checks, bundle integrity, installed-file equality, service health, and observed UI behavior are separate claims. Report a missing prerequisite or failed check without implying full completion. Never install live, configure a cloud account, edit global rules/hooks, or change trust merely to validate a package.
