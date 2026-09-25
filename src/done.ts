import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from './ason.ts'
import { loadProject } from './project.ts'

/** Complete a ready task, updating only its task record (never its attachments). */
export async function doneTask(id: string, cwd = process.cwd()): Promise<string> {
	const project = await loadProject(cwd)
	const task = project.tasks.get(id)
	if (!task) throw new Error(`Unknown task ID '${id}'`)
	if (task.status === 'done') throw new Error(`Task ${id} is already done`)
	const unfinished = task.needs.filter((need) => project.tasks.get(need)!.status !== 'done')
	if (unfinished.length) throw new Error(`Task ${id} has planned needs: ${unfinished.join(', ')}`)

	const path = join(project.tasksDir, id, 'task.ason')
	const source = parse(await readFile(path, 'utf8'), { comments: true })
	if (source === null || typeof source !== 'object' || Array.isArray(source)) throw new Error(`${path}: expected a task object`)
	source.status = 'done'
	const updated = stringify(source)
	await writeFile(path, `${updated}\n`)
	return updated
}
