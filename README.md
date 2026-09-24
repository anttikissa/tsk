# Tsk

A minimal, Git-backed task manager for agents rebuilding software from small, reusable tasks.

Each task says what to build, which earlier tasks it needs, and whether it is `planned` or `done` in this repository. The first tasks for Tsk live in [`tasks/`](tasks/README.md); until the CLI exists, we edit them by hand.

## Install

Tsk needs [Bun](https://bun.sh). From a clone:

```sh
./install   # installs dependencies, links ~/.local/bin/tsk, puts it on PATH
tsk --help
```

Or run the checkout directly with `./run <command>`.
