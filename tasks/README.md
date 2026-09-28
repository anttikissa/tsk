# Tasks for Tsk

Tsk is a small command-line tool for agents. Its task graph is stored in a project's Git repository so that it can serve as a recipe for rebuilding the project. Prefer clear ASON output and small, readable commands over a database, daemon, web interface, or elaborate workflow.

This directory is both Tsk's own build plan and an example of its format. `project.ason` identifies it as a Tsk task directory. Each ID has a flat directory containing `task.ason` and, if needed, other files. IDs are short, lowercase Crockford base32 (`0123456789abcdefghjkmnpqrstvwxyz`); don't infer dependencies from their order. The directory name is the ID.

A task has a title, `spec` for intended behavior and constraints, `status: 'planned' | 'done'`, and `needs`, a list of task IDs. Optional `once: true` identifies one-off work; optional `notes` is a list of observations, one entry per line. `b` with `needs: ['a']` requires `a` to be done first. Reverse links are derived, not stored. A planned task is ready only when every prerequisite in its dependency chain is done, including prerequisites behind completed one-off tasks. For a fresh rebuild, retain completed one-off tasks as done and reset other completed tasks to planned. A rebuild deletes every file except `.git/`, `tasks/`, and the paths listed in the optional `keep` array of `project.ason`.

Optional `foldInto: ['a']` is guidance for rewrite agents: in the current build the follow-up is ordinary work, while on a rebuild its requirements are incorporated into each named target instead of implemented separately. Targets may also appear in `needs`, but `foldInto` does not add dependencies or affect ready, done, or reset. Targets must exist, cannot be the task itself, a one-off task, or downstream of the task.

For a rebuild, run `tsk reset`, then repeatedly take a task from `tsk foldable`: merge its requirements and useful notes into its targets, move files that must survive, update references to it, and delete it. A task appears in `tsk foldable` when it has foldInto targets and no other folding task targets it; thus a chain is folded from its outer end inward. The command does not change tasks or guarantee `tsk del` will accept them before references are updated, and refuses fold cycles with a fix-your-graph error. Once folding is complete, repeatedly implement a task from `tsk ready` and mark it done.

Value options accept `--option value` and `--option=value`; a value option at the end of the arguments or followed by another `--option` is a missing-value error.

Every task-facing command prints concise human-readable output by default. Commands that return task data also accept `--format json` or `--format ason`; both retain the same structured task information. Errors go to stderr, keeping structured stdout clean.

Specs state what a fresh build must produce; notes record observations from this build. Correct or remove notes that become wrong, useless, or misleading. Delete tasks for behavior no longer wanted rather than leaving them planned. Use `tsk add` to create tasks, `tsk add-note` to append observations, `tsk done` to complete tasks, and `tsk edit` to update task fields through flags or an editor.

ASON reads input into values and writes normalized output; it does not preserve source formatting. The parser accepts trailing commas and comments, but the writer omits trailing commas and may change whitespace or quotes. Some comments can be retained when parsing with comment preservation enabled; do not rely on byte-for-byte round trips.

Every user-facing CLI command must appear in the help output. Update help when adding or removing a command; the initial `tsk help` behavior is specified by task `77`.

Tsk has one CLI implementation and one public launcher: `./run`. The package's `tsk` bin and the link installed by `./install` both point to that launcher. Keep checkout and installed behavior aligned.
