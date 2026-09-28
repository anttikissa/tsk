import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RUN, makeRepo, task, tsk } from './helpers.ts'

function editWith(root: string, source: string, exit = 0) {
	const editor = join(root, 'editor.mjs')
	writeFileSync(editor, `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], ${JSON.stringify(source)}); process.exit(${exit})`)
	const result = Bun.spawnSync([RUN, 'edit', 'b'], { cwd: root, env: { ...process.env, EDITOR: `node ${editor}` } })
	return { code: result.exitCode, err: result.stderr.toString() }
}

test('edit flags update selected values and preserve other fields', () => {
	const root = makeRepo({ a: task('done'), b: task('planned', ['a'], "once: true, notes: ['keep'], foldInto: ['a'],") })
	const { code } = tsk(root, 'edit', 'b', '--title', 'Revised', '--once', 'false', '--needs', 'a')
	expect(code).toBe(0)
	expect(readFileSync(join(root, 'tasks', 'b', 'task.ason'), 'utf8')).toContain("title: 'Revised'")
	const record = readFileSync(join(root, 'tasks', 'b', 'task.ason'), 'utf8')
	expect(record).toContain("notes: ['keep']")
	expect(record).toContain('once: false')
	expect(record).toContain("foldInto: ['a']")
})

test('editor edits task including notes and validates before replacing', () => {
	const root = makeRepo({ a: task('done'), b: task('planned', ['a']) })
	const valid = "{ title: 'Edited', spec: 'D', status: 'planned', needs: ['a'], notes: ['editor note'] }\n"
	expect(editWith(root, valid).code).toBe(0)
	expect(readFileSync(join(root, 'tasks', 'b', 'task.ason'), 'utf8')).toContain("notes: ['editor note']")
	const path = join(root, 'tasks', 'b', 'task.ason')
	const before = readFileSync(path, 'utf8')
	expect(editWith(root, "{ title: 'Bad', spec: 'D', status: 'planned', needs: ['unknown'] }\n").code).toBe(1)
	expect(readFileSync(path, 'utf8')).toBe(before)
})

test('editor failure and blocked done transition leave original unchanged', () => {
	const root = makeRepo({ a: task('planned'), b: task('planned', ['a']) })
	const path = join(root, 'tasks', 'b', 'task.ason')
	const before = readFileSync(path, 'utf8')
	expect(editWith(root, "{ title: 'Bad', spec: 'D', status: 'planned', needs: ['a'] }", 2).code).toBe(1)
	expect(readFileSync(path, 'utf8')).toBe(before)
	expect(tsk(root, 'edit', 'b', '--status', 'done')).toMatchObject({ code: 1 })
	expect(readFileSync(path, 'utf8')).toBe(before)
})
