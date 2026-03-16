# Codex Switch

Codex Switch is a VS Code extension that keeps
multiple Codex accounts organized and makes switching between them fast
(for example "work" and "personal").  
It is a lightweight account manager and status bar selector.
When you switch profiles,
it updates the current environment `auth.json` so Codex CLI uses the active profile.
On Windows, if `chatgpt.runCodexInWindowsSubsystemForLinux` is enabled, this uses
the WSL-side `~/.codex/auth.json`; otherwise it uses the Windows/local one.

Tokens are stored in VS Code SecretStorage.
Profile metadata (name, email, plan) is stored in the extension global storage.

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
* `codexSwitch.debugLogging`: enable debug logs (never prints tokens)
* `codexSwitch.reloadWindowAfterProfileSwitch`: reload VS Code window
  after successful profile switch/import so Codex extension re-reads
  `auth.json` (default: `false`)

## IDE Reload Behavior

After switching profiles,
IDE may still use cached auth state until the window is reloaded.
You can enable `codexSwitch.reloadWindowAfterProfileSwitch`
to reload automatically after a successful switch/import.

This option is disabled by default because it reloads only the current
VS Code window and cannot restart every open IDE window/session.
