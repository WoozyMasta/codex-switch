# Contributing

Thanks for contributing to Codex Switch.

## Local Setup

* Use Node.js 24.
* Install dependencies with `npm ci`.

## Commands

* `npm run build` for a one-off TypeScript build.
* `npm run build:test` for compiled test output.
* `npm run lint` for lint and format checks.
* `npm run test:unit` for the fast Node test suite.
* `npm run test:coverage` for coverage.
* `npm run test:integration` for the VS Code smoke suite.
* `npm run check` for the fast CI gate.
* `npm run check:release` for the full release gate.
* `npm run vscode:package` to build a `.vsix` package.

## Workflow

* Keep changes focused and scoped.
* Run `npm run check` before opening a PR.
* Run `npm run check:release` before release tagging or packaging.
* Update `CHANGELOG.md` when behavior or user-facing features change.

## Releases

* Release notes are generated from the latest version section in
  `CHANGELOG.md` using `scripts/release-notes.awk`.
* The tag-based GitHub Actions workflow publishes the GitHub release.
