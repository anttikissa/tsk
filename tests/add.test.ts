import { expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALPHABET, claimId } from '../src/add.ts'
import { makeRepo, task, tempDir, tsk } from './helpers.ts'

test('add creates a planned task and prints it with its ID', () => {
	const root = makeRepo()
	const { code, out } = tsk(root, 'add', '--title', 'Write tests', '--description', 'Cover the parser')
	expect(code).toBe(0)
	const id = out.match(/id: '([0-9a-z]+)'/)![1]!
	expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]$/)
	expect(out).toBe(`{\n\tid: '${id}',\n\ttitle: 'Write tests',\n\tdescription: 'Cover the parser',\n\tstatus: 'planned',\n\tneeds: []\n}\n`)
	expect(readFileSync(join(root, 'tasks', id, 'task.ason'), 'utf8')).toBe(`{\n\ttitle: 'Write tests',\n\tdescription: 'Cover the parser',\n\tstatus: 'planned',\n\tneeds: []\n}\n`)
	expect(tsk(root, 'show', id).code).toBe(0)
})

test('add accepts --status done and repeated --needs', () => {
	const root = makeRepo({ a: task('done'), b: task('planned') })
	const { code, out } = tsk(root, 'add', '--title', 'T', '--description', 'D', '--status', 'done', '--needs', 'a', '--needs', 'b')
	expect(code).toBe(0)
	expect(out).toContain("status: 'done'")
	expect(out).toContain("needs: ['a', 'b']")
})

test.each([
	[['--description', 'D'], '--title is required'],
	[['--title', 'T'], '--description is required'],
	[['--title', 'T', '--description', 'D', '--needs', 'zz'], 'unknown dependency zz'],
	[['--title', 'T', '--description', 'D', '--status', 'started'], '--status must be planned or done'],
	[['--title', 'T', '--description', 'D', '--bogus', 'x'], 'unknown option --bogus'],
	[['--title'], '--title needs a value'],
])('add rejects bad input %#', (args, message) => {
	const root = makeRepo()
	const { code, err } = tsk(root, 'add', ...args)
	expect(code).toBe(1)
	expect(err).toContain(message)
	expect(readdirSync(join(root, 'tasks'))).toEqual(['project.ason'])
})

test('IDs grow longer once a quarter of short IDs are used, without reusing existing directories', () => {
	const dir = tempDir()
	const singles = ALPHABET.slice(0, 8).split('')
	for (const id of singles) mkdirSync(join(dir, id))
	for (let i = 0; i < 20; i++) {
		const id = claimId(dir, singles)
		expect(id).toHaveLength(2)
	}
	// Directories unknown to the caller still count as collisions.
	const full = tempDir()
	for (const id of ALPHABET) mkdirSync(join(full, id))
	expect(claimId(full, [])).toHaveLength(2)
	expect(readdirSync(full)).toHaveLength(33)
})
