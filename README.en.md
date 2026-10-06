# Codex Workspace Enhancer 3.0

[中文](README.md) · [Customization guide](docs/EXTENDING.md)

A local workspace layer for Codex desktop: find tasks, maintain concise context, work with a task map, select Skills, browse the web, and inspect project files inside the conversation window.

![Workspace overview](docs/codex-workspace-enhancer-onepage.png)

## Included capabilities

- **Launcher and startup:** Windows launcher, hidden injector/backend lifecycle, and an application-readiness startup overlay with timeout fallback. A startup demo video is bundled, and users can select their own local videos; playback requires `ffplay.exe`. Missing playback support does not block Codex.
- **Task workspace:** searchable card/list views, pinned/project/recent navigation, task previews, concise summaries, separate notes, and updated right-rail UI.
- **Global work map:** directions, work items, task links, map/list/relationship views, undo, export, and local persistence. An optional separately configured CortexDB executable provides one-way lexical indexing, not full-chat memory.
- **Per-thread Task Map:** per-thread editable core plan, node states, dragging/zoom, expanded view, source-backed status synchronization, and JSON export. Manual edits survive context refresh; maps never rewrite conversations.
- **Account and usage:** native remaining/reset state, current-task Token display, and explicit profile switching with native account readback. Optional Tibo public signals/heuristic percentages stay separate from actual account resets.
- **Optional original-history archive:** stable task transcripts are copied and keyword-indexed with Python; active history is never deleted or rewritten. Automatic mode starts disabled.
- **Native update shortcut:** confirmed actions call the official Codex update UI rather than a separate updater.
- **Skills:** search, favorites, configurable categories, native composer attachments, and global and project-scoped default Skills. Global defaults apply to all conversations; project defaults apply only to that project. Defaults start empty and live in `$CODEX_HOME/skill-defaults.json`, separate from summaries and notes. Selecting a default does not prove execution; removing it does not uninstall the Skill.
- **Embedded browser:** tabs, address/search navigation, and explicit quick-chat controls without a second visible application window. Tab metadata/history persist locally; this does not preserve arbitrary website processes or login profiles. Website embedding compatibility varies.
- **Local assets:** task/project-aware folder browsing, supported previews, explicit asset-path attachments, and provenance-aware outputs. Both release ZIPs include the backend.
- **Cloud library:** MOKE catalogue UI and connection flow when a native MCP server named `moke` is separately configured and authorized. No account, token, or private catalogue is bundled.
- **Optional task organization:** a portable rule template lets the assistant name and group the current task through native tools, with readback. This is not background watcher automation and is not enabled by installation.

Summaries are maintained by the assistant, not a background model. Optional trusted hooks remind it to read/update the matching task context. This supports selective retrieval, not perfect memory or a measured quota-saving guarantee.

## Install on Windows

Requires Codex desktop and **Node.js >=22.13.0**. Download either package from [Releases](https://github.com/q2522879285-source/codex-workspace-enhancer/releases/latest).

### Skill package

Extract `codex-workspace-enhancer-skill.zip` into your Codex Skills directory, normally `%USERPROFILE%\.codex\skills`, then run from the extracted Skill directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\inspect.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-bundled.ps1 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-bundled.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

The packaged Skill is self-contained and requires no author-owned Skills. The source `skill-template/` needs the release build before bundle installation.

### Windows package

Extract `codex-sidebar-enhancer-windows.zip`, open PowerShell in it, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1
```

Runtime defaults to `%LOCALAPPDATA%\Programs\Codex Sidebar Enhancer`; mutable state/configuration lives in `%LOCALAPPDATA%\CodexSidebarEnhancer\asset-browser`. Existing standalone AssetBrowser state is not silently migrated. A port conflict is reported, not resolved by killing an unrelated service.

## Configure and opt in

- Create `enhancer.config.json` in the install directory for Skill categories and initial favorites.
- Configure your own project roots in the local `asset-browser.config.json`. Fresh installs have no personal projects and capture/routing disabled.
- Task summaries normally use `CODEX_HOME/task-context/<threadId>.json`; `CODEX_HOME` defaults to `~/.codex`.
- Optional hooks: run `scripts/setup-task-context-hooks.mjs`, then review and trust through Codex's `/hooks`. A configuration file alone does not prove active hooks.
- Optional naming/grouping: adopt [task-organization-rules.md](templates/task-organization-rules.md) in your chosen rules scope. The assistant acts once after a substantive result, preserves manual titles/pins/projects/classification, and verifies native tool readback. The installer does not edit your `AGENTS.md` or enable this workflow.
- Optional Tibo feed: set `CODEX_TIBO_FEED_URL` only to enable public-source requests. Displayed percentages are heuristic signals, not calibrated statistics or an official account-reset guarantee.
- Optional CortexDB index: set `CODEX_CORTEXDB_EXECUTABLE` to your installed compatible executable. Basic map editing does not require it.
- Optional original-history archive: use its task controls to save manually or enable automatic mode; keyword indexing requires Python. Archives contain full private transcript text and are not release data.
- Optional MOKE library: configure and authorize your own `moke` MCP server using the provider's current setup. Installation does not connect an account.

See [Customization and extension points](docs/EXTENDING.md) for schemas, source entry points, and opt-in removal.

## Local data and recovery

The asset backend listens locally and uses a local token. The enhancer does not upload local files/media by itself, alter the Codex app package, rewrite conversation text, or automatically submit selected attachments. Explicit quick-chat sends remain user actions.

Generation capture requires registered tickets and explicit configuration; ordinary downloads are not an import source. Project membership alone does not establish originating-task provenance.

Installation preserves mutable configuration and assets and rolls back owned runtime changes on failure. For a deliberate downgrade, install the chosen earlier release against the same paths after preserving state. Runtime rollback is not a project-content or cloud-account restore.

## Development

```powershell
npm install
npm test
npm run inject
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-release.ps1
```

The default debug port is `9231`; match the active launch configuration instead of assuming a port on every machine. Release builds produce the Windows and Skill ZIPs with bundle verification manifests.

## Limitations

- Windows is the validated release target; retained macOS scripts are not physically validated for this release.
- Codex internal UI/bridges can change with desktop updates; verify against the installed version.
- Office previews extract supported content rather than full Office layout/editing.
- Embedded sites may reject framing or require an external authentication flow.
- Cloud-library authorization and returned resources depend on the user's separately configured provider service.
- Cold-history links require an existing archive/retrieval tool; links do not create archives.

## License

[MIT](LICENSE)
