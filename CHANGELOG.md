# Changelog

## Unreleased

- Replaced `description` with `spec` throughout task records and CLI output. Existing task records using `description` must be updated.
- Added `tsk edit`, `tsk add-note`, and guarded `tsk del` commands for updating tasks and deleting unreferenced tasks through the CLI.
- Added `tsk ls` filters and opt-in full specs, notes, and incoming `foldInto` links. Task summaries include note counts and spec lengths; `tsk show` includes incoming fold links.
- Added `tsk tree` to visualize prerequisites and dependents, with branch connectors for shared paths and separate `foldInto` annotations. JSON and ASON formats expose the graph's nodes and edges.
- Human-readable output is now the default; use `--format json` or `--format ason` for structured data. `ls`, `add`, and `del` use compact task rows; `show` and `add-note` omit empty sections; `reset` reports counts.
- Renamed the structured `tsk show` field `artifacts` to `files`. Consumers of the structured output must use `files`.
- Value-taking options accept both `--option value` and `--option=value` forms.
- Added an optional 1,000- and 10,000-task graph benchmark for task lookup, ID generation, and listing.

## 0.2.2 — 2026-09-27

- Added `foldInto` guidance for rebuilds: a follow-up task can name earlier tasks whose requirements should incorporate it on the next rebuild. It is advisory and does not change dependencies or task readiness.
- `tsk add` accepts repeatable `--fold-into <id>` options; task loading validates fold targets, and `tsk show` displays them.
- Help now covers all commands and task features. Use `tsk --detailed-help` for the project format and rebuild workflow, or `tsk <command> --help` for command-specific usage and examples.

## 0.2.1 — 2026-09-25

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
