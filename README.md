# Tsk

A minimal task manager for rebuilding software.

A task is a small, durable description of work:

```ason
// Simplified from tasks/ks/task.ason, before implementation:
{
    title: 'Mark a task done',
    spec: 'tsk done <id> marks a task done when its dependencies are done',
    status: 'planned', // 'planned' | 'done'
    needs: ['r']       // r: "Project discovery and task loading" must be done first
}
```

The title names the work; the spec says what a fresh build must produce and
records important constraints. Tasks form a dependency graph in the project's
Git repository, providing a recipe for rebuilding the software.

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

## Work with tasks

Run Tsk from anywhere inside a Git repository. It discovers the `tasks/`
directory at the Git root. Start a task collection, add work, and inspect what
is ready:

```sh
tsk init
tsk add --title 'Cover the parser' --spec 'Tests exercise valid and invalid input'
tsk ready
tsk show <id>
```

Tsk assigns each added task an ID and prints it. Add prerequisites with
`--needs <id>` (repeat the option for multiple prerequisites). A planned task
is ready when its dependencies are done:

```sh
tsk add --title 'Document the parser' \
  --spec 'README explains parser behavior' --needs <id>
tsk ready
```

Implement a ready task, then mark it done with `tsk done <id>`. Stage the
implementation and updated task record, and commit them together.

Repeat with the next ready task. `tsk` is the interface for creating, browsing,
and updating tasks; use commands rather than editing task files directly.

Task specs describe intended behavior for a fresh build. Optional `notes` record
observations from this build or during later changes; keep them accurate and
use `tsk add-note <id> <text>` to append one. Optional `once: true` marks
one-off work, which stays done during a rebuild. Optional `foldInto` links
guide rewrite agents to incorporate a task's requirements into named targets
instead of implementing it separately on a rebuild. `foldInto` is advisory and
does not create a dependency; use `--needs` when work must wait for a target.

## Commands

| Command | Purpose |
| --- | --- |
| `tsk init` | Create `tasks/` and its project marker at the Git root. |
| `tsk add --title <text> --spec <text> [--needs <id>]... [--fold-into <id>]...` | Add a planned task. Repeat `--needs` or `--fold-into` for multiple IDs; optionally pass `--status done`. |
| `tsk ready` | List planned tasks whose dependencies are all done. |
| `tsk show <id>` | Show a task with its direct dependencies, dependents, incoming fold links, and files. |
| `tsk done <id>` | Mark a task done when all dependencies are done. |
| `tsk ls [--status planned|done] [--spec] [--notes] [--folded-by]` | List task summaries; opt in to full specs, notes, or incoming fold links. |
| `tsk tree [<id>]` | Visualize the dependency graph; an ID limits the view to that task and its downstream dependents. |
| `tsk edit <id> [options]` | Update task fields with flags or an editor. |
| `tsk add-note <id> <text>` | Append an observation to a task's notes. |
| `tsk del <id> [--force]` | Delete an unreferenced task; `--force` is required when files are present. |
| `tsk reset` | Set done tasks back to planned for a rebuild, except `once: true` tasks. |
| `tsk version` (`tsk --version`) | Print the installed package version. |
| `tsk help` (`tsk --help`, `tsk -h`) | Show the command summary and version. |
| `tsk --detailed-help` | Show the task format and rebuild workflow in detail. |

## Installing

With Bun or Node.js:

```sh
bun install -g @anttikissa/tsk
# or
npm install -g @anttikissa/tsk
```

For development from a clone, use Bun or Node.js ≥22.18. Run `./install` to
install dependencies and link `tsk` into `~/.local/bin`, or invoke the checkout
directly with `./run <command>`.

## Performance checks

Run `bun run bench` from the checkout to generate reproducible 1,000- and
10,000-task graphs and measure warm lookup, ID generation, listing, and ready
queries. Startup and full project loading are reported separately. Timings are
machine-dependent; the benchmark reports them without failing on a fixed
threshold.

## Storage format

Tsk stores tasks under `tasks/` at a project's Git root. `tasks/project.ason`
identifies a Tsk project and can list paths to keep during a rebuild; a freeform
`tasks/README.md` provides shared context. Each task lives in a flat directory
named for its short, lowercase Crockford base32 ID, with a `task.ason` record
and optional supporting files. Task records require a `spec` describing intended
behavior and constraints; `once: true` identifies one-off work and `notes` hold
observations. The task data uses [ASON](#whats-ason), a readable notation for
structured values.

## Release history

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

MIT. See [LICENSE](LICENSE).

## What's ASON?

ASON (A Saner Object Notation) is like JSON, but allows unquoted keys,
single-quoted strings, comments, and trailing commas. Tsk uses it for task files
and optional `--format ason` output. Its implementation is [one .ts file](src/ason.ts).
