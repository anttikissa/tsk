# Tsk

A minimal task manager for rebuilding software.

## Motivation

In the LLM era, software is easy to build and extend, but it's just as easy to produce unmaintainable code. Agents also make it easier to rebuild software from scratch: you can start fresh with better guidance, a better harness, or a more capable model.

`tsk` offers a minimal way to do this: split the functionality into tasks linked by dependencies, then turn those tasks into working software by following this loop:

```
while planned tasks remain:
    pick a planned task whose dependencies are all done
    implement the task
    mark it as done
    commit
```

## The anatomy of a task

`tsk` is deliberately minimal. A task lives in `tasks/<id>/` and has:

- a title, such as `Mark a task done`;
- a description of what to build, such as `tsk done <id> marks a task done when its dependencies are done`;
- a status (`planned` or `done`);
- a list of dependencies, such as `['r']`;
- optionally, supporting files (e.g. screenshots, tests, or detailed specifications).

Task IDs use lowercase Crockford base32. Early IDs are short, like `r` or `9`, and grow longer as the task list grows.

A `tasks/README.md` provides shared guidance for implementing all tasks.

Tasks are either done (implemented in this codebase) or planned (not yet implemented). In-progress work stays uncommitted, so it doesn't need a separate status.

## Using `tsk`

Run these commands from anywhere inside a Git repository. Tsk discovers the project's `tasks/` directory at the Git root.

| Command | What it does |
| --- | --- |
| `tsk init` | Create `tasks/` and its project marker at the Git root. |
| `tsk add --title <text> --description <text> [--needs <id>]...` | Add a planned task; repeat `--needs` for multiple dependencies. Optionally pass `--status done`. |
| `tsk ls` | List every task's ID, title, status, and dependencies. |
| `tsk ready` | List planned tasks whose dependencies are all done. |
| `tsk show <id>` | Show a task with its direct dependencies and dependents. |
| `tsk done <id>` | Mark a task done, provided all its dependencies are done. |
| `tsk version` (or `tsk --version`) | Print the installed package version. |
| `tsk help` (or `tsk --help`, `tsk -h`) | Show the current command summary and version. |

Task listings and `tsk add` print ASON. For example, `tsk add --title 'Write tests' --description 'Cover the parser' --needs r --needs e` creates a task that depends on both `r` and `e`. Repeat `--needs` once per dependency.

## Installing

With Bun or Node.js:

```sh
bun install -g @anttikissa/tsk
# or
npm install -g @anttikissa/tsk
```

For development from a clone (Bun or Node.js ≥22.18):

- `./install` installs dependencies and links `tsk` into `~/.local/bin`
- or invoke the checkout directly via `./run <command>`

## Release history

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

MIT. See [LICENSE](LICENSE).
