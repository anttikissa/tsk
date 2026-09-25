# Rules

Keep committing as you go.

When a (and only when) commit marks a task as done, end its commit message with a separate line `Implemented task <id>` (for example, `Implemented task ks`). If you know the LLM model id that aided with implementation, mention that too, like: "Implemented task <id> with openai/gpt-6-sol"

When documenting things, don't provide needless examples of incorrect usage. Wrong: "To add multiple dependencies, use `--needs id1 --needs id2`. Don't use syntax like `--needs=id1,id2`." Right: "To add multiple dependencies, use `--needs id1 --needs id2`."

When releasing version X.Y.Z, update package.json and CHANGELOG.md in a commit with the subject `Release vX.Y.Z`. Tag that exact commit `vX.Y.Z`; push the tag only when publishing is authorized, since pushing it triggers publication.

When adding tasks, keep descriptions concise: specify the behavior and important constraints, not implementation or test minutiae.

When changing a file, keep the task that defines its behavior in sync with the change. If the change affects dependent tasks, update their specifications and files as needed. When that would cause a large cascade, create a new task that depends on the affected work and explicitly describes the change instead. In either case, the tasks must remain sufficient to rebuild the intended result.

When adding tasks, mention them in commit messages: "Plan version reporting (re) and dual-runtime installation (nw)"
