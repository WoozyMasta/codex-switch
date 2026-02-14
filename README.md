# Codex Switch

Codex Switch is a VS Code extension that keeps
multiple Codex accounts organized and makes switching between them fast
(for example "work" and "personal").  
It is a lightweight account manager and status bar selector.
It does not modify `~/.codex/auth.json` when switching profiles.

Tokens are stored in VS Code SecretStorage.
Profile metadata (name, email, plan) is stored in the extension global storage.

## Setup

To import an account, first get an `auth.json`
(the easiest way is `codex login` which creates `~/.codex/auth.json`).
Then run `Codex Switch: Manage Profiles` and choose
"Add From ~/.codex/auth.json" or "Import From File...".

## Usage

The status bar shows `$(account) <profile>`.
Click it to toggle to the last used profile,
or use `Codex Switch: Manage Profiles` to switch, rename, or delete profiles.

## Settings

* `codexSwitch.activeProfileScope`: `global` or `workspace`
* `codexSwitch.debugLogging`: enable debug logs (never prints tokens)
