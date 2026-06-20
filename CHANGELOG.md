# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog][],
and this project adheres to [Semantic Versioning][].

<!--
## Unreleased

### Added
### Changed
### Removed
-->

## [1.4.0][] - 2026-06-20

### Added

* Saved Codex authentication is now updated when
  a periodic account-limit check causes Codex to rotate its tokens,
  so rarely selected profiles no longer restore a stale refresh token.
* Profile usage now shows how long ago the limits were last refreshed
  and when the next refresh or retry is scheduled.
* Multiple windows of the same IDE product now coordinate background checks
  so only one window refreshes a given profile at a time,
  recovering automatically when a window closes or crashes.
  Different IDE products stay isolated,
  and the coordination files under `~/.codex-switch/maintenance/v1/`
  never store tokens or account identity.
* Optional `CODEX_HOME`-aware active profile state.
  When enabled, VS Code windows launched with different `CODEX_HOME`
  values keep separate active and previous profile selections.
* `codexSwitch.codexHome.inheritDefaultProfileWhenEmpty`
  to bootstrap an empty non-default `CODEX_HOME`
  from the default home active profile.
* `Codex Switch: Use Default CODEX_HOME Profile Here`
  for manually syncing the current home to the default home active profile.
* Codex account rate limits to the profile tooltip and switcher,
  showing remaining 5-hour and weekly limits for saved profiles.
* Automatic focused-window limit refresh, a manual Refresh limits action,
  and `codexSwitch.codexCliPath` for choosing a Codex CLI binary when needed.
* `Codex Switch: Prepare for New Login (Chat)`
  to clear the local `auth.json`, preserve matching saved auth when possible,
  and reload the window so Chat can show the login flow again.
  (PR #23 #24 by @panella87)

### Changed

* The default account-limit refresh interval is now 15 minutes
  (was 30 seconds), with a supported range of 30 seconds to 12 hours
  and `0` to disable automatic refresh.
* Automatic limit refresh no longer requires the window to be focused, so an
  open background window keeps saved profiles maintained.
* Active and previous profile state can now be stored per resolved `CODEX_HOME`,
  including per-home shared active-profile files in `remoteFiles` mode.
* Warn before switching, activating, cycling, importing,
  or starting a new login when the current live Codex auth
  is not saved as a profile, with an option to save it first.
  (PR #23 #24 by @panella87)
* Preserve refreshed live Codex auth into the matching saved profile before
  destructive replacement flows to avoid restoring stale `auth.json` data.
  (PR #23 #24 by @panella87)

[1.4.0]: https://github.com/WoozyMasta/codex-switch/compare/1.3.2...1.4.0

## [1.3.2][] - 2026-04-28

### Changed

* When `codexSwitch.reloadWindowAfterProfileSwitch` is enabled, profile
  switch/import now prefers restarting only the extension host and falls back
  to full window reload if restart is unavailable or fails.
  (PR #13 by @hugodeco)
* Added `selector` behavior for `codexSwitch.statusBarClickBehavior` to open
  the profile picker from status bar click.
* Updated localization and docs for the reload-after-switch behavior.

### Fixed

* Recover active profile from current `auth.json` when saved active profile id
  is missing or points to an orphaned profile.
  (PR #14 by @hugodeco)
* Preserve refreshed Codex auth across profile switches to avoid restoring
  stale `auth.json` snapshots after token refresh.
  (PR #17 by @panella87)
* Prevent duplicate import popups during `Login via Codex CLI` by guarding
  against repeated auth-file watcher events.
* Cache WSL auth-path resolution and throttle repeated resolve-error logs to
  reduce extension-host stalls and log noise on Windows + WSL setups.
* Escape HTML-significant characters in tooltip markdown values to prevent
  unintended HTML rendering from imported profile data.

[1.3.2]: https://github.com/WoozyMasta/codex-switch/compare/1.3.1...1.3.2

## [1.3.1][] - 2026-04-05

### Added

* Automatic publishing to <https://open-vsx.org/> in the release workflow.

[1.3.1]: https://github.com/WoozyMasta/codex-switch/compare/1.3.0...1.3.1

## [1.3.0][] - 2026-03-16

### Added

* Shared SSH profile storage for remote sessions.
  (PR #9 by @iqdoctor)
* `codexSwitch.storageMode` with `auto`, `secretStorage`, `remoteFiles`.
  (PR #9 by @iqdoctor)
* Direct profile activation from tooltip.
  (PR #8 by @iqdoctor)
* Added `Codex Switch: Export Profiles` and `Codex Switch: Import Profiles`
  for full profile backup/restore, including credentials and active/previous
  profile selection.

### Changed

* `auth.json` resolution now follows the active runtime environment,
  including Windows + WSL scenarios.
  (PR #10 by @panella87)
* Duplicate detection now uses identity-first matching.
  (PR #10 by @panella87)
* Duplicate detection is workspace-aware while preserving identity-first logic.
  (follow-up changes on `master`; aligns with PR #5 by @iqdoctor)
* Status-bar click behavior is explicitly configurable via
  `codexSwitch.statusBarClickBehavior`:
  `cycle` (cycle all profiles) or `toggleLast` (switch current/previous).

### Fixed

* Removed redundant Cancel action in duplicate-account modal prompts.
  (PR #4 by @iqdoctor)
* Prevented false duplicate matches in Team/Business account scenarios.
  (PR #10 by @panella87)

### Removed

* Removed `auth.json.bak.*` backup creation during sync.
  (PR #7 by @iqdoctor)

[1.3.0]: https://github.com/WoozyMasta/codex-switch/compare/1.2.0...1.3.0

## [1.2.0][] - 2026-02-15

### Added

* First public release

[1.2.0]: https://github.com/WoozyMasta/codex-switch/tree/1.2.0

<!--links-->
[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/
[Semantic Versioning]: https://semver.org/spec/2.0.0.html
