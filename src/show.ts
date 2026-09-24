import { stringify } from './ason.ts'
import { loadProject } from './project.ts'

/** Show a task and its direct dependency links as ASON. */
export async function showTask(id: string, cwd = process.cwd()): Promise<string> {
	const { tasks } = await loadProject(cwd)
	const task = tasks.get(id)
	if (!task) throw new Error(`Unknown task ID '${id}'`)

	const needs = task.needs.map((need) => {
		const dependency = tasks.get(need)!
		return { id: dependency.id, title: dependency.title, status: dependency.status }
	})
	const neededBy = [...tasks.values()]
		.filter((candidate) => candidate.needs.includes(id))
		.map((candidate) => candidate.id)
		.sort()

	return stringify({
		id: task.id,
		title: task.title,
		description: task.description,
		status: task.status,
		needs,
		neededBy,
	})
}
