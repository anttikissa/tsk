# Changelog

## Unreleased (0.2.1)

- Added `tsk reset`, which sets done tasks back to planned for a rebuild, except `once: true` tasks.
- `tsk show` lists the files in a task's directory as `artifacts`.
- New task IDs grow longer once 25% of the shorter IDs are taken, as in 0.1.1; 0.2.0 waited until 50%.
- The npm package again ships the TypeScript sources and `CHANGELOG.md` next to the compiled JavaScript; installed copies still run the compiled JavaScript.
- `tasks/project.ason` may list files to keep during a rebuild in `keep`.

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
