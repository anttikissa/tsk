# Changelog

## 0.2.0 — 2026-09-25

Tsk was rebuilt from scratch from its own task graph; behavior is otherwise compatible with 0.1.1.

- Added optional `once: true` and `notes` task fields; `tsk show` prints them.
- `tsk ready` and `tsk done` now require every prerequisite in the dependency chain to be done, including those behind completed one-off tasks.
- `tsk done` keeps comments in `task.ason`.
- Unknown fields in `task.ason` are now errors.
- The npm package now ships only compiled JavaScript, the launcher, and docs.

## 0.1.1 — 2026-09-25

- Added `tsk version` and `tsk --version`, and included the version in help output.
- Added support for Node.js.
- Added GitHub Actions publishing through npm trusted publishing, pending verification with this release.

## 0.1.0 — 2026-09-25

Initial release of the task workflow used to build Tsk itself: `tsk init`, `tsk add`, `tsk ls`, `tsk ready`, `tsk show`, and `tsk done`.

Requires Bun. Existing task descriptions and dependencies are edited in their files; implementing tasks and committing changes are left to the developer and Git.
