# Tasks for Tsk

Tsk is a small command-line tool for agents. Its task graph is stored in a project's Git repository so that it can serve as a recipe for rebuilding the project. Prefer clear ASON output and small, readable commands over a database, daemon, web interface, or elaborate workflow.

This directory is both Tsk's own build plan and an example of its format. `project.ason` identifies it as a Tsk task directory. Each ID has a flat directory containing `task.ason` and, if needed, supporting files. IDs are short, lowercase Crockford base32 (`0123456789abcdefghjkmnpqrstvwxyz`); don't infer dependencies from their order. The directory name is the ID; the file needn't repeat it.

A task has a title, description, `status: 'planned' | 'done'`, and `needs`, a list of task IDs. `b` with `needs: ['a']` requires `a` to be done first. Reverse links are derived, not stored. A planned task is ready when all its needs are done. A done task is satisfied by code or other versioned project files in this repository; mark it done in the same readable commit that implements it. For a fresh rebuild, copy the task graph and reset statuses to planned.

Descriptions are instructions for a fresh build, not diaries of how this build happened. Correct or remove notes that become wrong, useless, or misleading. Delete tasks for behavior no longer wanted rather than leaving them planned. Until Tsk can manage its own graph, edit these files manually.

The whole project, including these task files, is MIT licensed; see [`LICENSE`](../LICENSE).
