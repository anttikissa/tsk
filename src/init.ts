// tsk init: create a Tsk task directory at the nearest Git root.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findGitRoot, formatAson, isTskMarker, readAson, TskError } from './project.ts'

const README = `# Tasks

Shared context for implementing every task in this project: goals, constraints, conventions, and anything a fresh build needs to know.

Each task lives in a directory named by its ID, with a task.ason record and optional supporting files. Use \`tsk ready\` to find work, \`tsk show <id>\` for details, and \`tsk done <id>\` when it is implemented.
`

function hasTskMarker(path: string): boolean {
	try {
		return isTskMarker(readAson(path))
	} catch {
		return false
	}
}

export function init(cwd: string): string {
	const root = findGitRoot(cwd)
	const tasksDir = join(root, 'tasks')
	if (existsSync(tasksDir)) {
		const isTsk = hasTskMarker(join(tasksDir, 'project.ason'))
		throw new TskError(isTsk ? `${tasksDir} is already a Tsk task directory` : `${tasksDir} already exists and is not a Tsk task directory; leaving it untouched`)
	}
	mkdirSync(tasksDir)
	writeFileSync(join(tasksDir, 'project.ason'), formatAson({ format: 'tsk', version: 1 }))
	writeFileSync(join(tasksDir, 'README.md'), README)
	return tasksDir
}
