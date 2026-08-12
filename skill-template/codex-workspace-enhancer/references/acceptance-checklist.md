# Acceptance checklist

## Layout and task recall

- Fixed controls move no more than 1 px during sidebar scrolling.
- Controls are normal-flow siblings before the scroll region; no content paints underneath.
- Search, pinned/project/recent modes, and task previews remain keyboard reachable.
- Sidebar width has no horizontal overflow at supported desktop sizes.

## Usage display

- The shown percentage equals `round((1 - used_percent / 100) * 100)` from the newest valid primary weekly-window event.
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
