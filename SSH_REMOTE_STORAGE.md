# Shared SSH Profile Store

This document describes the SSH-specific shared profile store used by Codex Switch
when `codexSwitch.storageMode` resolves to `remoteFiles`.

## Why This Exists

VS Code SecretStorage is client-scoped, which means two different local machines
connected to the same SSH remote can see the same remote workspace but still have
different secret payloads for the extension.

That leads to split-brain behavior:

- the remote host has one `~/.codex/auth.json`
- the profile list may appear shared
- the stored tokens may still differ between clients

The shared SSH profile store makes the remote host the source of truth.

## Storage Layout

The shared store lives under:

```text
~/.codex-switch/
```

Files:

- `profiles.json` - profile metadata
- `profiles/<profile-id>.json` - stored auth blob for each profile
- `active-profile.json` - the currently selected profile

Directories are created with `0700` and files are written with `0600`.

## Storage Modes

- `auto`
  - use `remoteFiles` when `vscode.env.remoteName === "ssh-remote"`
  - otherwise use `secretStorage`
- `secretStorage`
  - keep per-profile auth data in VS Code SecretStorage
- `remoteFiles`
  - keep per-profile auth data in `~/.codex-switch/`

## Source Of Truth

In `remoteFiles` mode, the extension reconciles active state from:

1. the current `~/.codex/auth.json`
2. `active-profile.json`

If `auth.json` clearly matches one of the saved profiles, that match wins and
`active-profile.json` is updated to follow it.

This keeps the extension aligned with:

- manual `codex login`
- profile switching from another client
- older clients that only touched `auth.json`

## Sync Between Clients

The extension watches:

- `~/.codex/auth.json`
- `~/.codex-switch/profiles.json`
- `~/.codex-switch/active-profile.json`
- `~/.codex-switch/profiles/*.json`

When any of these files change, connected clients refresh their status bar and
tooltip state.

## Recovery Flow

If a profile exists but its stored auth blob is missing, the extension offers:

- `Recover from remote store`
- `Import current ~/.codex/auth.json`
- `Delete broken profile`

This is intended to make migration from the older SecretStorage-only model less
fragile when users move between local machines.

## Operational Guidance

Use `remoteFiles` only for trusted SSH remotes where sharing profile state across
clients is actually desired.

For local-only usage, `secretStorage` remains the safer model.
