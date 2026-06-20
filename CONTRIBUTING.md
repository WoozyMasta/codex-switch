# Contributing

Thanks for contributing to Codex Switch.

## Local Setup

* Use Node.js 24.
* Install dependencies with `npm ci`.

## Commands

The two gates below are what you normally run; they build each output once and
run the test suite once.

* `npm run check` for the fast CI gate (PRs and commits):
  `build` + `build:test` + `lint` + the Node suite with coverage.
* `npm run check:release` for the full release gate:
  everything in `check` plus the VS Code integration smoke suite.

Individual targets, mostly for focused local runs:

* `npm run build` for a one-off production TypeScript build.
* `npm run build:test` for compiled test output.
* `npm run lint` for lint and format checks.
* `npm run test:unit` for the fast Node test suite (rebuilds test output first).
* `npm run test:coverage` for the Node suite with coverage (rebuilds first).
* `npm run test:integration` for the VS Code smoke suite (rebuilds first).
* `npm run vscode:package` to build a `.vsix` package.

The `test:*:run` variants run the same suites without rebuilding; the gates use
them after a single `build:test` so the test output is not compiled twice.

## Workflow

* Keep changes focused and scoped.
* Run `npm run check` before opening a PR.
* Run `npm run check:release` before release tagging or packaging.
* Update `CHANGELOG.md` when behavior or user-facing features change.

## Releases

* Release notes are generated from the latest version section in
  `CHANGELOG.md` using `scripts/release-notes.awk`.
* The tag-based GitHub Actions workflow publishes the GitHub release.
