# Acceptance checklist

## Layout and task recall

- Fixed controls move no more than 1 px during sidebar scrolling.
- Controls are normal-flow siblings before the scroll region; no content paints underneath.
- Search, pinned/project/recent modes, and task previews remain keyboard reachable.
- Sidebar width has no horizontal overflow at supported desktop sizes.

## Usage display

- Each shown window matches the latest valid native rate-limit data for that window; remaining percent is `100 - usedPercent`, clamped to 0..100. Do not relabel a short window as weekly.
- Missing or stale events show an unknown state instead of a guessed value.
- Updates are monotonic by event timestamp, not DOM discovery order.

## Embedded assets

- No second visible window opens.
- Task A -> B replaces the iframe nonce/context and disables A.
- Only absolute drive or valid UNC paths can enter the composer.
- Adding paths never clicks submit or sends the task.
- Create, rename, folder hierarchy, move, undo, and automatic organization work.
- Automatic organization never targets final/output/generated-record directories.
- Mixed media batches can route each item to its own target directory.

## Reliability and performance

- Rapid A -> B directory switching cannot let late A data overwrite B.
- Cache keys include project and directory generations; mutation invalidates affected keys.
- Media hydrates near viewport; video defaults to `preload=none` in lists.
- Reduced-motion still sets and clears busy state.
- Open/close races leave no CDP listeners, sessions, Fetch interception, or auto-attach state.

## Installation safety

- Install and state roots are validated product-owned locations.
- Rollback removes only files created by the failed run and restores backups.
- Existing AssetBrowser config, ledgers, and media are unchanged.
- Packaged, source, and installed runtime hashes match for claimed files.

## Startup and optional surfaces

- Startup overlay releases after actual desktop readiness; reduced motion remains usable.
- Browser tabs/navigation preserve the current native task and do not send a message.
- A quick-chat submission targets only the user-selected native task and occurs only on submit.
- MOKE shows missing configuration/authentication/error distinctly; opening a login URL is not proof of authorization.
- Optional assistant naming/grouping preserves manual titles, pinned/custom placement, and project containers; completion requires native readback. Installation does not enable this workflow.

## Running the checks

In the extracted runtime/source repository, run `npm test` for changed runtime behavior. In the built Skill package, run `scripts/verify.ps1 -BundleOnly` for manifest integrity and `scripts/verify.ps1` for the targeted installation. Observe layout, startup, and navigation on the actual supported desktop version. Keep bundle, installed-file, service-health, and interactive results distinct; skip a surface only if unchanged/not requested and do not imply its prerequisites were tested.
