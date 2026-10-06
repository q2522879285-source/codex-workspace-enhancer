# Architecture

## Stable workflow

Read native Codex state, augment task recall without replacing the sidebar, bind one task context/map to the active task, and host optional browser/local-asset/cloud-library surfaces. Return explicit selections to the composer without submission; teardown stale sessions on close or task switch. The assistant maintains concise summaries; no background model writes them.

Task naming/grouping is a separate opt-in assistant workflow through native tools. It is not a runtime watcher or database mutation.

## Platform adapter

Adapters own executable/process discovery, renderer/debug transport, local-service lifecycle, safe install/state roots, shortcut creation, absolute-path validation, and packaging/rollback. The Windows package requires Node.js >=22.13.0. Debug port 9231 and local service port 5177 are defaults, not universal machine facts. Match the actual configured port and install/state paths.

Windows is the validated release target. Retained macOS scripts are not evidence of physical Mac compatibility.

## Runtime boundaries

- `inject/conversation-preview.user.js`: sidebar/right-rail, task context, Skills, map integration, library UI.
- `inject/global-task-map.js`: global directions/items/task-link map. Per-thread map rendering remains in `conversation-preview.user.js`.
- `inject/global-browser.js`: embedded browser and explicit native quick-chat actions.
- `scripts/injector.mjs`: renderer attachment, native bridge, frame proxy, local backend lifecycle, optional MOKE authorization bridge.
- `asset-console/public/`: published local Asset Console frontend.
- `asset-browser/`: local file APIs and scoped operations.
- `windows/`: launcher, startup overlay, lifecycle and removal.
- `templates/`: opt-in rules and neutral defaults, not installed personal policy.

The dedicated asset proxy is authorized by synthetic origin, per-open nonce, session/frame identity, and request generation. Closing/leaving invalidates access. The backend requires a per-install token for protected APIs/media/downloads. The token lives in mutable asset state and is added by the injector's server-side proxy, never exposed to iframe JavaScript or bundled as a value.

Cloud library content/authentication belongs to the separately configured provider account. Browser navigation does not grant local-file API access. Runtime, mutable state, and protected project assets remain separately owned.
