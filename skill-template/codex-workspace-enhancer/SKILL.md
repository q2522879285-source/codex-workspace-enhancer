---
name: codex-workspace-enhancer
description: Audit, install, adapt, or extend a Codex desktop workspace enhancement that keeps the native sidebar usable while adding searchable task recall, truthful usage status, and an embedded local Asset Console. Use for Codex sidebar UI, task-card workflows, in-app local asset management, Windows packaging, performance repair, safe rollback, or porting this reference implementation to another machine or platform.
---

# Codex Workspace Enhancer

Turn Codex into a continuous task-and-asset workspace without replacing its native information architecture. Keep the method portable; treat the bundled Windows runtime as a reference adapter, not as the product definition.

## Route the request

1. Run `scripts/inspect.ps1` for install, repair, or compatibility work.
2. Choose one scope:
   - **Audit/UI:** inspect native structure first; read `references/interaction-model.md` and `references/acceptance-checklist.md`.
   - **Install/update:** run `scripts/install-bundled.ps1 -WhatIf` first, then rerun without `-WhatIf` after reviewing the plan.
   - **Port/adapt:** read `references/architecture.md` and `references/adapter-contract.md`; replace only the platform adapter.
3. Preserve user data and native Codex controls. Add capability around them; do not recreate the whole sidebar as an overlay.
4. Run `scripts/verify.ps1` after any runtime change. Treat failed safety or task-context checks as blockers.

## Non-negotiable behavior

- Keep fixed shortcuts and tabs in normal layout flow; scrolling content must begin below them with no visual cover layer.
- Synchronize the weekly usage display from the latest valid Codex rate-limit event. Never fabricate a percentage.
- Open Asset Console inside the current Codex task. Do not launch a second visible app window.
- Refresh the embedded task context when the active task changes; invalidate the old iframe/session.
- Return selected assets to the current composer as absolute local paths only. Never submit or send automatically.
- Support folder navigation, create, rename, move, undo, and project-level automatic organization.
- Keep destructive actions secondary and explicit. "Discard" must not imply deleting source files.
- Use bounded caches, lazy media loading, request generations, reduced-motion-safe busy states, and stale-response guards.
- Restrict local proxy access to the dedicated asset frame/session and tear it down on close.
- Preserve configuration, ledgers, projects, and assets across install/update/rollback.

## Bundled Windows reference

The skill includes a reviewed snapshot of the sidebar enhancer and its local AssetBrowser service under `assets/runtime/`. It contains no personal project configuration, media, task history, or credentials.

Install or update the reference implementation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-bundled.ps1 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-bundled.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1
```

The installer only owns `%LOCALAPPDATA%\Programs\Codex Sidebar Enhancer`, `%LOCALAPPDATA%\CodexSidebarEnhancer`, and known runtime files under `%LOCALAPPDATA%\AssetBrowser`. It preserves `asset-browser.config.json`, ledgers, and all project folders.

## Adapt instead of forking the method

Keep the stable workflow and acceptance rules unchanged. Implement platform differences behind the adapter contract: Codex discovery, debug transport, local-service lifecycle, shortcut creation, safe install roots, and absolute-path validation. If a required adapter capability is missing, fail closed and report the missing capability.

## Final checks

- Run deterministic syntax and package checks before visual review.
- Verify source, packaged runtime, and installed runtime hashes when claiming consistency.
- Exercise task A -> task B with Asset Console open.
- Exercise rapid folder A -> B switching with reversed response order.
- Confirm no automatic message send and no deletion outside owned paths.
- For a deliverable change, request a fresh independent cold review after tests pass.
