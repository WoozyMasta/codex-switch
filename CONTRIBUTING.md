# Contributing

Thanks for contributing to Codex Switch.

## Local Setup

* Use Node.js 24.
* Install dependencies with `npm ci`.

## Development Commands

* `npm run watch` for TypeScript watch build.
* `npm run compile` for one-off TypeScript build.
* `npm run lint:ts` for ESLint on TypeScript sources.
* `npm run lint:md` for markdownlint checks.
* `npm run format` to apply Prettier formatting.
* `npm run format:check` to verify Prettier formatting.
* `npm run lint` to run all lint and format checks.
* `npm run vscode:package` to build a `.vsix` package.

## Pull Requests

* Keep changes focused and scoped.
* Make sure `npm run lint` and `npm run compile` pass.
* Update `CHANGELOG.md` when behavior or user-facing features change.

## Releases

* Release notes are generated from the latest version section in
  `CHANGELOG.md` using `scripts/release-notes.awk`.
* The tag-based GitHub Actions workflow publishes the GitHub release.
