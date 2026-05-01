# Codex Switch

Codex Switch is a VS Code extension
for people who work with more than one Codex account, workspace, or environment.
It keeps named profiles, lets you switch them from the UI,
and syncs the selected profile into the auth file
used by the current Codex runtime.

## Why It Exists

Profile switching is easy in simple setups and fragile in real ones.
Team accounts can share account-level fields across different users.
One user can have multiple workspaces.
SSH sessions can be opened from several local clients to one remote host.

This project focuses on those edge cases.
It tries to avoid false duplicate matches
and keep profile state consistent across clients.

## Quick Start

1. Sign in with Codex CLI in the runtime you actually use.
   If you use WSL from Windows and enabled
   `chatgpt.runCodexInWindowsSubsystemForLinux`, run `wsl codex login`.
   Alternatively, sign in from the Chat/Codex UI.
2. Run `Codex Switch: Manage Profiles`.
3. Import from current `auth.json` or from a selected JSON file.
4. Switch profiles from the status bar, tooltip links, or the manage command.

## Adding Another Chat Login

Use `Codex Switch: Prepare for New Login (Chat)` before signing in
with another Chat/Codex account.

The command preserves the current live auth into a matching saved profile
when possible, removes the local `auth.json`, clears the active profile,
and reloads so Chat can show the login screen again.
If the current live account is not saved as a profile,
Codex Switch asks you to choose `Cancel`,
`Save Profile and Continue`, or `Continue without saving`.

Do not use logout as the way to add the next account.
Logout can invalidate the current token session.

## How Switching Works

The status bar shows the current active profile.
Click behavior is configurable:

* `cycle`: switch through all saved profiles in order.
* `toggleLast`: switch between current and previous profile.
* `selector`: open the profile picker menu.

After a successful switch,
Codex Switch writes the chosen auth data into the active auth file,
so CLI and extension state stay aligned.

Before switching away from an unsaved live account,
Codex Switch asks whether to cancel, save the profile and continue,
or continue without saving.

## Auth File Resolution

By default, auth is resolved as `<CODEX_HOME>/auth.json`.
If `CODEX_HOME` is not set, the fallback path is `~/.codex/auth.json`.

On Windows, the extension also checks
`chatgpt.runCodexInWindowsSubsystemForLinux`.
If enabled, it resolves and uses the WSL-side `~/.codex/auth.json` path.
If disabled, it uses the Windows-local path.

This prevents importing from one environment and switching in another.

## Profile Matching

Duplicate detection is identity-first.
When available, it matches by user identity fields from auth payloads:
`chatgptUserId`, `userId`, and JWT `sub`.

If identity fields are missing, matching falls back to combinations of
`email`, `accountId`, and default organization/workspace id when present.
If organization id exists only on one side,
profiles are treated as distinct to avoid accidental collapse.

## Storage Modes

`codexSwitch.storageMode` controls where profile data is stored:

* `secretStorage`: tokens are stored in VS Code SecretStorage.
* `remoteFiles`: tokens are stored in a shared remote filesystem location.
* `auto`: uses `remoteFiles` in SSH remote sessions, otherwise
  `secretStorage`.

In `remoteFiles` mode, data lives under `~/.codex-switch/`:

* `profiles.json` stores profile metadata.
* `profiles/<profile-id>.json` stores per-profile auth payloads.
* `active-profile.json` stores shared active-profile state.

Directories are created with `0700`, files with `0600`.

In `secretStorage` mode, profile metadata is still stored in a local
`profiles.json` file under VS Code global storage,
while credentials stay in SecretStorage.

## SSH Shared Mode

In `remoteFiles` mode, active state is reconciled from both
`~/.codex/auth.json` and `active-profile.json`.
If current auth clearly matches a saved profile,
that match wins and the shared active marker is updated.

This keeps multiple clients in sync when one client switches profiles,
runs `codex login`, or writes `auth.json` directly.

## Recovery

If profile metadata exists but stored auth data is missing,
the extension offers recovery options:

* recover from remote store data (when available),
* import from current `auth.json`,
* or delete the broken profile.

## Configuration

Main settings:

* `codexSwitch.debugLogging`
* `codexSwitch.activeProfileScope` (`global` or `workspace`)
* `codexSwitch.storageMode` (`auto`, `secretStorage`, `remoteFiles`)
* `codexSwitch.reloadWindowAfterProfileSwitch`
* `codexSwitch.statusBarClickBehavior` (`cycle`, `toggleLast` or `selector`)

When `codexSwitch.reloadWindowAfterProfileSwitch` is enabled, the extension
tries to restart only the extension host after a successful switch or import.
This lets Codex re-read `auth.json` without reloading the full VS Code window.
If extension-host restart is unavailable, it falls back to full window reload.

## Security Notes

For local single-client use, `secretStorage` is the safer default.
Use `remoteFiles` only on trusted SSH hosts
where shared profile state is expected.

Sync writes `auth.json` via a temp-file-and-replace flow
to reduce partial write risk.
The extension does not create rotated backup files like `auth.json.bak.*`.
