import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from './ason.ts'
import { gitRoot } from './project.ts'

/** Create a project only when no tasks directory exists. */
export function initProject(cwd: string = process.cwd()): string {
	const directory = join(gitRoot(cwd), 'tasks')
	mkdirSync(directory)
	writeFileSync(join(directory, 'project.ason'), stringify({ format: 'tsk', version: 1 }) + '\n', { flag: 'wx' })
	writeFileSync(join(directory, 'README.md'), '# Tasks\n\nDescribe shared build context here.\n', { flag: 'wx' })
	return directory
}
