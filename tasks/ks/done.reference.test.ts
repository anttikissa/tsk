// Reference behavior for task ks: a completed one-off does not bypass its prerequisites.
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = fileURLToPath(new URL('../../run', import.meta.url))

test('done refuses a planned prerequisite behind a done one-off', async () => {
	const root = await mkdtemp(join(tmpdir(), 'tsk-ks-'))
	try {
		await mkdir(join(root, '.git'))
		await mkdir(join(root, 'tasks'))
		await writeFile(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
		const records = {
			a: "{ title: 'a', description: 'a', status: 'planned', needs: [] }",
			b: "{ title: 'b', description: 'b', status: 'done', once: true, needs: ['a'] }",
			c: "{ title: 'c', description: 'c', status: 'planned', needs: ['b'] }",
		}
		for (const [id, source] of Object.entries(records)) {
			await mkdir(join(root, 'tasks', id))
			await writeFile(join(root, 'tasks', id, 'task.ason'), source)
		}
		const blocked = Bun.spawnSync([run, 'done', 'c'], { cwd: root })
		expect(blocked.exitCode).not.toBe(0)
		expect(await readFile(join(root, 'tasks', 'c', 'task.ason'), 'utf8')).toBe(records.c)
		await writeFile(join(root, 'tasks', 'a', 'task.ason'), "{ title: 'a', description: 'a', status: 'done', needs: [] }")
		const unblocked = Bun.spawnSync([run, 'done', 'c'], { cwd: root })
		expect(unblocked.exitCode).toBe(0)
		expect(await readFile(join(root, 'tasks', 'c', 'task.ason'), 'utf8')).toContain("status: 'done'")
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
