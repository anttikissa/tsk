// Reference behavior for task p: a completed one-off does not bypass its prerequisites.
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = fileURLToPath(new URL('../../run', import.meta.url))

test('ready waits for a planned prerequisite behind a done one-off', async () => {
	const root = await mkdtemp(join(tmpdir(), 'tsk-p-'))
	try {
		await mkdir(join(root, '.git'))
		await mkdir(join(root, 'tasks'))
		await writeFile(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
		for (const [id, status, needs, once] of [
			['a', 'planned', '[]', ''],
			['b', 'done', "['a']", 'once: true,'],
			['c', 'planned', "['b']", ''],
		]) {
			await mkdir(join(root, 'tasks', id))
			await writeFile(join(root, 'tasks', id, 'task.ason'), `{ title: '${id}', description: '${id}', status: '${status}', ${once} needs: ${needs} }`)
		}
		const ready = () => Bun.spawnSync([run, 'ready'], { cwd: root })
		const blocked = ready()
		expect(blocked.exitCode).toBe(0)
		expect(blocked.stdout.toString()).toContain("id: 'a'")
		expect(blocked.stdout.toString()).not.toContain("id: 'c'")
		await writeFile(join(root, 'tasks', 'a', 'task.ason'), "{ title: 'a', description: 'a', status: 'done', needs: [] }")
		const unblocked = ready()
		expect(unblocked.exitCode).toBe(0)
		expect(unblocked.stdout.toString()).toContain("id: 'c'")
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
