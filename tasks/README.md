# Tasks for Tsk

Tsk is a small command-line tool for agents. Its task graph is stored in a project's Git repository so that it can serve as a recipe for rebuilding the project. Prefer clear ASON output and small, readable commands over a database, daemon, web interface, or elaborate workflow.

This directory is both Tsk's own build plan and an example of its format. `project.ason` identifies it as a Tsk task directory. Each ID has a flat directory containing `task.ason` and, if needed, supporting files. IDs are short, lowercase Crockford base32 (`0123456789abcdefghjkmnpqrstvwxyz`); don't infer dependencies from their order. The directory name is the ID.

A task has a title, description, `status: 'planned' | 'done'`, and `needs`, a list of task IDs. Optional `once: true` identifies one-off work; optional `notes` is a list of observations, one entry per line. `b` with `needs: ['a']` requires `a` to be done first. Reverse links are derived, not stored. A planned task is ready only when every prerequisite in its dependency chain is done, including prerequisites behind completed one-off tasks. A done task is satisfied by code or other versioned project files in this repository; mark it done in the same readable commit that implements it. For a fresh rebuild, retain completed one-off tasks as done and reset other completed tasks to planned.

Descriptions specify what a fresh build must produce; notes record what happened in this build. Correct or remove notes that become wrong, useless, or misleading. Delete tasks for behavior no longer wanted rather than leaving them planned. Use `tsk add` to create tasks and `tsk done` to complete them; edit other task fields manually until Tsk supports updating them.

ASON reads input into values and writes normalized output; it does not preserve source formatting. The parser accepts trailing commas and comments, but the writer omits trailing commas and may change whitespace or quotes. Some comments can be retained when parsing with comment preservation enabled; do not rely on byte-for-byte round trips.

Every user-facing CLI command must appear in the help output. Add or remove its help entry in the same commit as the command; the initial `tsk help` behavior is specified by task `77`.

Tsk has one CLI implementation and one public launcher: `./run`. The package's `tsk` bin and the link installed by `./install` both point to that launcher. Keep checkout and installed behavior aligned.
