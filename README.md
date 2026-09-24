# Tsk

A minimal, Git-backed task manager for agents rebuilding software from small, reusable tasks.

Each task says what to build, which earlier tasks it needs, and whether it is `planned` or `done` in this repository. The first tasks for Tsk live in [`tasks/`](tasks/README.md); Tsk itself uses `tsk add`, `tsk ready`, and `tsk done` to maintain them.

## Install

Tsk runs on [Bun](https://bun.sh). Install globally with either npm or Bun:

```sh
npm install -g @anttikissa/tsk
# or
bun install -g @anttikissa/tsk
```

Bun must be installed and available on your `PATH` for either install method, because it runs the `tsk` command.

For development from a clone, run `./install` to install dependencies and link `tsk` into `~/.local/bin`. Or run `bun install` and invoke the checkout without installing it via `./run <command>`.
