# Install, verify, and rollback

## Prerequisites

Windows Codex desktop, Node.js >=22.13.0, and a built Skill release containing `assets/runtime/manifest.sha256.json` and `codex-sidebar-enhancer-windows.zip`. The source `skill-template/` alone is not an installable bundle. The installer owns runtime files under `%LOCALAPPDATA%\Programs\Codex Sidebar Enhancer`; mutable state defaults to `%LOCALAPPDATA%\CodexSidebarEnhancer`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\inspect.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-bundled.ps1 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-bundled.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

`-WhatIf` validates the archive and reports the plan without installation. `-SkipStart` and `-SkipShortcuts` are available for an authorized install without launching or shortcut changes. `-EnhancerDir`, `-StateDir`, and `-DebugPort` select custom paths/transport. Pass the same install/state paths to inspect and verify; `-BackendDir` can override the derived backend path, and `-BackendPort` selects service health port.

## What verification establishes

- `verify.ps1 -BundleOnly` checks the packaged archive/backend against its manifest without touching an installation.
- Normal verification additionally compares claimed installed runtime files, parses the state config, and probes the authenticated local service.
- `-SkipHealth` skips only the service probe; report health as unverified.
- Runtime unit tests and interactive task-switch/layout checks remain necessary for changed behavior; package hashes do not prove it.

Inspect output is diagnostic, not a pass certificate. A running service at the expected port is not sufficient without the matching token/configuration. Do not terminate an unrelated process to resolve a conflict.

## Recovery

The Windows installer backs up owned runtime files and restores them if installation fails. For an intentional downgrade, use the selected earlier release's installer against the same install/state paths, after preserving current state. This does not restore project content or cloud accounts. For removal, review the installed `windows/uninstall.ps1` and its parameters; remove only enhancer-owned runtime components. Keep mutable state and assets unless the user separately requests their deletion.

Hook setup and task organization are separate opt-ins. Installation never grants hook trust or rewrites `AGENTS.md`.

For a source-only check of custom diagnostic paths, run `scripts/test-inspect-paths.ps1`; it creates and removes a temporary fixture without installing.
