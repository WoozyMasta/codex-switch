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
