# Rules

Keep committing as you go.

When a commit completes a task, end its commit message with a separate line `Implemented task <id>` (for example, `Implemented task ks`). If you know the LLM model id that aided with implementation, mention that too, like: "Implemented task <id> with openai/gpt-6-sol"

When documenting things, don't provide needless examples of incorrect usage. Wrong: "To add multiple dependencies, use `--needs id1 --needs id2`. Don't use syntax like `--needs=id1,id2`." Right: "To add multiple dependencies, use `--needs id1 --needs id2`."

When publishing a new version, update CHANGELOG.md. It's a list of relevant things that changed.

When adding tasks, keep descriptions concise: specify the behavior and important constraints, not implementation or test minutiae.
