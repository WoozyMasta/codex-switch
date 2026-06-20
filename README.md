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
1. Run `Codex Switch: Manage Profiles`.
1. Import from current `auth.json` or from a selected JSON file.
1. Switch profiles from the status bar, tooltip links, or the manage command.

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

## CODEX_HOME-Aware State

Codex Switch can separate active profile state by the `CODEX_HOME`
that VS Code was launched with.
This is useful when several VS Code windows
are opened from different launchers or shells,
each with its own `CODEX_HOME` and Codex account.

This feature is off by default.
Enable `codexSwitch.codexHome.enabled` to make active
and previous profile selection local to the resolved `CODEX_HOME`.
It does not change which `CODEX_HOME` or auth path the extension resolves.
It only changes which profile state bucket is used.

When a new non-default `CODEX_HOME` has no `auth.json` yet,
Codex Switch can bootstrap it from the default home active profile.
If `auth.json` already exists, Codex Switch leaves it untouched
and tries to match it to a saved profile instead.
This bootstrap behavior is controlled by
`codexSwitch.codexHome.inheritDefaultProfileWhenEmpty`.

Codex Switch does not change `CODEX_HOME` for an already running IDE.
Start each VS Code window with the desired environment value instead,
for example:

```sh
CODEX_HOME="$HOME/.codex-client-a" code .
```

Supported runtime matrix:

* Native Windows, Linux, and macOS: `CODEX_HOME` is resolved from the
  environment the IDE was started with, or falls back to `~/.codex`.
* Windows + WSL: when `chatgpt.runCodexInWindowsSubsystemForLinux` is on,
  auth resolution uses the WSL-side Codex home;
  custom `CODEX_HOME` is not supported in that mode.
* SSH remote: `codexSwitch.storageMode=remoteFiles` keeps shared active state
  per resolved home, while `secretStorage` remains local to the client.
* Default home vs custom environment home: active
  and previous profile state can be isolated per resolved `CODEX_HOME`,
  but the resolved auth path still comes from the launched environment value.

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
* `active-profiles/<home-id>.json` stores shared active-profile state per
  Codex home.

Directories are created with `0700`, files with `0600`.

In `secretStorage` mode, profile metadata is still stored in a local
`profiles.json` file under VS Code global storage,
while credentials stay in SecretStorage.

## SSH Shared Mode

In `remoteFiles` mode, active state is reconciled from both the active
Codex home's `auth.json` and its per-home active-profile marker.
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
* `codexSwitch.codexHome.enabled`
* `codexSwitch.codexHome.inheritDefaultProfileWhenEmpty`
* `codexSwitch.rateLimitAutoRefreshIntervalSeconds`

When `codexSwitch.reloadWindowAfterProfileSwitch` is enabled,
the extension tries to restart only the extension host
after a successful switch or import.
This lets Codex re-read `auth.json` without reloading the full VS Code window.
If extension-host restart is unavailable, it falls back to full window reload.

### Account Limit Refresh

`codexSwitch.rateLimitAutoRefreshIntervalSeconds` controls how often saved
Codex account limits refresh in the background.
The default is 15 minutes (`900`); the enabled range is 30 seconds
through 12 hours (`43200`), and `0` disables automatic refresh
while keeping the manual *Refresh limits* action.

The background refresh covers all saved profiles, not only the active one,
and runs even when the window is not focused.
When Codex rotates its tokens during a refresh,
the updated authentication is written back into the same saved profile
so a later switch does not restore a stale refresh token.
Auth is only written to the profile's existing credential backend
(`secretStorage` or `remoteFiles`);
it is never written into any live `CODEX_HOME/auth.json`.

Profile usage shows the age of the last successful result
and the next scheduled refresh or retry beside each profile.

Multiple windows of the same IDE product coordinate
so that only one window runs a given background check at a time,
with no permanent leader:
any window can take over after another closes or crashes.
Different IDE products (VS Code, Cursor, VSCodium) stay isolated
because they normally use independent credential stores.
Coordination uses small files under:

```text
~/.codex-switch/maintenance/v1/
```

These files hold only scheduling status and normalized usage - never tokens,
auth payloads, account identity, or profile names.
The directory is safe to delete while all related IDE windows are closed;
doing so removes only cached limits and scheduling state,
never profiles or credentials.
If it cannot be written, automatic refresh stops rather than running
uncoordinated checks; the manual *Refresh limits* action remains available.

## Development

Development commands are documented in [CONTRIBUTING.md](CONTRIBUTING.md).
Use `npm run check` for the fast gate and
`npm run check:release` for the full release gate.

## Security Notes

For local single-client use, `secretStorage` is the safer default.
Use `remoteFiles` only on trusted SSH hosts
where shared profile state is expected.

Sync writes `auth.json` via a temp-file-and-replace flow
to reduce partial write risk.
The extension does not create rotated backup files like `auth.json.bak.*`.
