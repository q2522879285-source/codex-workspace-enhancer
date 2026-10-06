# Optional workspace surfaces

## Embedded web browser

The runtime includes `inject/global-browser.js`, loaded by the injector. Tab metadata and its navigation history persist locally, not website processes, full DOM snapshots, or arbitrary login profiles. It presents tabs, an address/search field, navigation state, and Codex quick-chat controls inside the desktop window. Use HTTP(S) addresses. Site embedding restrictions, authentication redirects, and the current Codex renderer can prevent a page from loading; this is not a universal Chrome replacement. Do not disable site or local-service isolation to make a page work.

The browser requires no personal homepage/bookmarks in the package. A quick-chat submission sends to the explicitly selected native task only on the user's submit action; opening or switching a tab must not send messages.

## Local Asset Console

Both release ZIPs contain the backend. Configure personal project roots in the local `asset-browser.config.json`, not public source. Fresh installs have no personal projects and capture/routing disabled. The runtime obtains its configured source/state roots through `lib/install-config.mjs`; the default backend is inside the installation and mutable configuration is inside the state's `asset-browser/` directory.

Selected assets enter the composer as absolute paths. Existing file ownership and registered generation tickets determine routing; folder membership alone does not establish the originating task. Keep unrelated downloads untouched.

## MOKE cloud library

The Library surface integrates a separately configured native MCP server named `moke`. The package includes the UI and connection flow, not a server account, token, resource collection, or author-owned data. Inspect the current native MCP configuration/status first. Use the provider's current connection instructions and user-authorized login; do not invent an endpoint or silently write MCP config.

The authorization bridge uses the locally available Codex CLI's `mcp login moke --no-browser` flow and opens the provider authorization URL. Verify CLI availability, configured server name, and current scopes before using it. A connection entry, an opened login page, authorized status, and a successfully returned library list are distinct states. Missing tools/authentication should remain visible as unavailable, not as an empty verified catalogue. Remote downloads or publishing require their own user authorization.

## Usage, account switching, and Tibo signals

Actual remaining usage and reset timestamps come from native account/rate-limit state; current task Token usage is a separate metric. Public Tibo reset-related updates and forecast-style percentages are a separate opt-in signal layer, not evidence that this account received a reset.

Enable requests only by setting `CODEX_TIBO_FEED_URL`. Leaving it unset disables public requests in the injector. The BetterOPC adapter uses `https://betteropc.com/api/browser/product-tracking/codex/history` plus `https://betteropc.com/api/browser/product-tracking/codex/challenge`; its public reset-signals page may supply a concrete reset target. Custom feeds must match the existing schema.

The challenge covers October 5–November 1, 2026, ending November 2 at 00:00 Beijing time. Each active day starts with a self-defined 50% display baseline. A confirmed executed hard reset on that Beijing day sets it to 0%; the next active day restores 50%. Product improvements affect daily progress only. Concrete future-reset signals can raise the indicator. The baseline and percentages are not calibrated statistical probabilities, official guarantees, or proof of an account reset.

Keep challenge day/progress, Beijing deadline, latest news timestamp, expected reset time, sources, and probability reason distinct. A challenge deadline is not an expected reset timestamp; leave the latter unavailable without a concrete signal. The 60-second cache and 5-second request timeout do not freeze time: each cache read recalculates countdowns and day transitions using the challenge server's clock offset. Failed requests mark retained values stale; an initial failure shows unavailable rather than a fabricated 0%. Missing challenge data must not appear freshly confirmed.

Account menus and local profile switching use the native bridge. Profiles/credentials belong to the user and are never bundled. Switching requires user action, a configured profile, native `account/login/start`, then `account/read` confirmation. A website login page or accepted write alone does not confirm desktop switching. Test with an authorized user's profiles only; no live account change is needed to validate package syntax.

## Original-history archive and native update

The original-history archive is opt-in. Its default automatic mode is disabled. Manual save or enabled automatic processing copies stable finished main-task transcripts into `CODEX_HOME/cold-history` and keyword-indexes them with `scripts/cold_history.py`; Python is required. It never deletes or rewrites active history. Archives contain full private transcripts and must not enter a release package. Check actual copied bytes/index/manifest and usable results rather than treating queued status as completion.

The update shortcut calls the official native UI after confirmation. Detecting an update control or invoking a check is not proof that a release was downloaded/installed. Do not trigger a live update to validate package syntax.

## Checks

Test each changed surface only when its prerequisites exist: browser navigation/tab switching without automatic message send; local folder/task switching without stale results; library disconnected, authorizing, failure, and authorized read states. Package syntax tests cannot prove a user's cloud login or site compatibility.



## Default Skills

The UI manages two scopes in `$CODEX_HOME/skill-defaults.json`: global defaults apply to all conversations, while project defaults apply only to that project. Defaults start empty and are separate from task summaries, `agreements`, and notes. Removing a default does not uninstall its Skill. After the user enables and trusts summary hooks, the next-turn reminder can request reading applicable Skill files. Selection, saving, and reminders do not prove loading or execution. Do not restore deleted defaults from old summaries.
