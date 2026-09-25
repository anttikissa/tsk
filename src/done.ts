import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify, type AsonObject } from './ason.ts'
import { loadProject, type Task } from './project.ts'

/** Complete a ready task, updating only its task record (never its attachments). */
export async function doneTask(id: string, cwd = process.cwd()): Promise<Task> {
	const project = await loadProject(cwd)
	const task = project.tasks.get(id)
	if (!task) throw new Error(`Unknown task ID: ${id}`)
	if (task.status === 'done') throw new Error(`Task ${id} is already done`)
	const unfinished = task.needs.filter((need) => project.tasks.get(need)!.status !== 'done')
	if (unfinished.length) throw new Error(`Task ${id} has unfinished dependencies: ${unfinished.join(', ')}`)

	const path = join(project.tasksDir, id, 'task.ason')
	const source = parse(await readFile(path, 'utf8'), { comments: true }) as AsonObject
	source.status = 'done'
	await writeFile(path, `${stringify(source, 'long')}\n`)
	return { ...task, status: 'done' }
}
