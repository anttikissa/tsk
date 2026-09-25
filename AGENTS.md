# Rules

Keep committing as you go.

When a commit completes a task, end its commit message with a separate line `Implements task <id>` (for example, `Implements task ks`).

When documenting things, don't provide needless examples of incorrect usage. Wrong: "To add multiple dependencies, use `--needs id1 --needs id2`. Don't use syntax like `--needs=id1,id2`." Right: "To add multiple dependencies, use `--needs id1 --needs id2`."

When publishing a new version, update CHANGELOG.md. It's a list of relevant things that changed.
