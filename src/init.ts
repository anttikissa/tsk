import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify } from './ason.ts'
import { findGitRoot } from './project.ts'

const readme = `# Tasks

Shared build context for this project's Tsk tasks: what the project is, conventions, and constraints every task should follow.

Each task lives in \`tasks/<id>/task.ason\` with a title, description, \`status: 'planned' | 'done'\`, and \`needs\`, a list of task IDs that must be done first.
`

/** Create tasks/ with a format marker and README at the nearest Git root. Returns the created directory. */
export async function initProject(cwd = process.cwd()): Promise<string> {
	const root = await findGitRoot(cwd)
	const tasksDir = join(root, 'tasks')
	// Non-recursive mkdir fails atomically if anything named tasks already exists.
	try {
		await mkdir(tasksDir)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new Error(`${tasksDir} already exists; not overwriting it`)
		}
		throw error
	}
	await writeFile(join(tasksDir, 'project.ason'), stringify({ format: 'tsk', version: 1 }, 'short') + '\n')
	await writeFile(join(tasksDir, 'README.md'), readme)
	return tasksDir
}
