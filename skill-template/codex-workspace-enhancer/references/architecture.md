# Architecture

## Stable method layer

The product loop is stable across platforms:

1. Read native Codex task and usage state.
2. Present task recall and shortcuts without covering native UI.
3. Bind one embedded Asset Console to the active task.
4. Browse, organize, compare, and select local assets.
5. Hand absolute paths back to the current composer without submitting.
6. Tear down sessions, listeners, and local proxy access on close.

Do not place project paths, user names, debug ports, or platform-specific process discovery in this layer.

## Replaceable adapter layer

Adapters own:

- Codex executable/process discovery
- debug transport and renderer attachment
- local service location and lifecycle
- safe install/state roots
- OS shortcut integration
- absolute-path rules
- packaging and rollback mechanics

The bundled adapter targets current Windows Codex desktop, Node 22+, debug port 9231, and AssetBrowser port 5177.

## Runtime boundaries

- **Injected UI:** native sidebar augmentation and embedded panel host.
- **Injector:** CDP attachment, lifecycle, usage-event observation, and dedicated frame proxy.
- **Asset Console frontend:** task-aware asset workflow and bounded UI cache.
- **Local service:** file indexing and explicit filesystem operations.
- **Install layer:** owned-path validation, backup, rollback, start, and verification.

Local-service access must remain unavailable to unrelated sandbox frames. A frame is authorized by a dedicated synthetic origin, per-open nonce, exact session/frame identity, and generation. Leaving that frame or closing the panel invalidates access.

The Windows adapter also requires a per-install 256-bit token for `/api/*`, `/media`, and `/download`. The injector reads `%LOCALAPPDATA%\AssetBrowser\.api-token` and adds it only to server-side proxy requests; the backend rejects missing tokens and non-local browser origins. Never expose the token to iframe JavaScript, bundle a token value, or disable this check.
