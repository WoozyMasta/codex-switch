# Codex Switch

Codex Switch is a VS Code extension that keeps
multiple Codex accounts organized and makes switching between them fast
(for example "work" and "personal").  
It is a lightweight account manager and status bar selector.
When you switch profiles,
it updates the current environment `auth.json` so Codex CLI uses the active profile.
On Windows, if `chatgpt.runCodexInWindowsSubsystemForLinux` is enabled, this uses
the WSL-side `~/.codex/auth.json`; otherwise it uses the Windows/local one.

By default, local sessions store profile credentials in VS Code SecretStorage.

When the extension runs in an SSH remote session and
`codexSwitch.storageMode` is set to `auto` (the default),
it switches to a shared remote file store under `~/.codex-switch/`:

- `profiles.json` for profile metadata
- `profiles/<profile-id>.json` for stored auth blobs
- `active-profile.json` for the currently selected profile

The shared store is intended for teams who connect to the same remote host
from different local machines and want profile switching to stay in sync.

For a focused explanation of the SSH-specific shared store, see
[SSH_REMOTE_STORAGE.md](./SSH_REMOTE_STORAGE.md).

## Setup

To import an account, first get an `auth.json`
(the easiest way is `codex login` in your current Codex environment, or
`wsl codex login` on Windows when `chatgpt.runCodexInWindowsSubsystemForLinux` is enabled).
Then run `Codex Switch: Manage Profiles` and choose
"Add From Current auth.json" or "Import From File...".

## Usage

The status bar shows `$(account) <profile>`.
Click it to toggle to the last used profile,
or use `Codex Switch: Manage Profiles` to switch, rename, or delete profiles.

Duplicate detection matches user identity (`chatgptUserId`, `userId`, JWT `sub`,
then email fallback), so different users in the same Team/Business account can
coexist as separate profiles.

## Settings

* `codexSwitch.activeProfileScope`: `global` or `workspace`
* `codexSwitch.storageMode`: `auto`, `secretStorage`, or `remoteFiles`
* `codexSwitch.debugLogging`: enable debug logs (never prints tokens)
* `codexSwitch.reloadWindowAfterProfileSwitch`: reload VS Code window
  after successful profile switch/import so Codex extension re-reads
  `auth.json` (default: `false`)

### Storage Modes

- `auto`: use `remoteFiles` when `vscode.env.remoteName === "ssh-remote"`,
  otherwise use `secretStorage`
- `secretStorage`: always keep per-profile auth data in VS Code SecretStorage
- `remoteFiles`: always keep per-profile auth data in `~/.codex-switch/`

## Shared Remote Behavior

In `remoteFiles` mode, the extension treats the remote host as the source of truth.
It watches both `~/.codex/auth.json` and the shared store under `~/.codex-switch/`
so that if one client switches or imports a profile, other clients connected
to the same SSH host refresh their status bar and tooltip state.

When resolving the active profile in `remoteFiles` mode, the extension prefers
the current `~/.codex/auth.json` match and keeps `active-profile.json` in sync
with it. This makes manual `codex login` recovery and older clients safer.

## Recovery

If a profile exists but its stored auth blob is missing, the extension now offers:

- `Recover from remote store`
- `Import current ~/.codex/auth.json`
- `Delete broken profile`

This is mainly useful when migrating from the old SecretStorage-only behavior
or when one client still has profile metadata but not the corresponding secrets.

## IDE Reload Behavior

After switching profiles,
IDE may still use cached auth state until the window is reloaded.
You can enable `codexSwitch.reloadWindowAfterProfileSwitch`
to reload automatically after a successful switch/import.

This option is disabled by default because it reloads only the current
VS Code window and cannot restart every open IDE window/session.
