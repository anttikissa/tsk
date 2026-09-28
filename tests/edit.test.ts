import { expect, test } from 'bun:test'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../tasks/9/ason.ts'
import { err, ok, read, repo, task, tempDir, tsk } from './helpers.ts'

function fixture(): string {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'planned', needs: [] }")
	task(root, 'b', `{
	// about b
	title: 'B',
	spec: 'b',
	status: 'planned',
	notes: [
		// why
		'n1'
	],
	needs: ['a']
}`)
	return root
}

function editor(script: string): string {
	const path = join(tempDir(), 'editor.sh')
	writeFileSync(path, `#!/bin/sh\n${script}\n`)
	chmodSync(path, 0o755)
	return path
}

test('edit flags update fields, preserve the rest and keep comments', () => {
	const root = fixture()
	expect(ok(root, 'edit', 'b', '--title=B2', '--spec', 'new spec')).toBe('PLANNED task b: B2 (needs a; 1 note)\n  new spec\n  notes:\n    - n1\n')
	const source = read(root, 'b')
	expect(source).toContain('// about b')
	expect(source).toContain('// why')
	expect(parse(source)).toEqual({ title: 'B2', spec: 'new spec', status: 'planned', notes: ['n1'], needs: ['a'] })
})

test('repeated --needs and --fold-into replace the lists, deduplicated', () => {
	const root = fixture()
	task(root, 'c', "{ title: 'C', spec: 'c', status: 'planned', needs: [] }")
	ok(root, 'edit', 'b', '--needs', 'c', '--needs', 'a', '--needs', 'c', '--fold-into', 'a', '--fold-into=a')
	expect(parse(read(root, 'b'))).toMatchObject({ needs: ['c', 'a'], foldInto: ['a'] })
})

test('edit --once writes true and --once false writes once: false', () => {
	const root = fixture()
	ok(root, 'edit', 'a', '--once')
	expect(read(root, 'a')).toContain('once: true')
	ok(root, 'edit', 'a', '--once', 'false')
	expect(read(root, 'a')).toContain('once: false')
})

test('invalid edits leave the file unchanged', () => {
	const root = fixture()
	const before = read(root, 'a')
	expect(err(root, 'edit', 'a', '--needs', 'b')).toBe('dependency cycle: a -> b -> a; task unchanged')
	expect(err(root, 'edit', 'a', '--needs', 'zz')).toBe('unknown dependency zz')
	expect(err(root, 'edit', 'a', '--needs', 'a')).toBe('task a cannot need itself; task unchanged')
	expect(err(root, 'edit', 'a', '--status', 'wip')).toBe('--status must be planned or done')
	expect(err(root, 'edit', 'b', '--status', 'done')).toBe('task b cannot be done with unfinished prerequisites: a; task unchanged')
	expect(err(root, 'edit', 'zz', '--title', 'x')).toBe('unknown task: zz')
	expect(err(root, 'edit', 'a', '--title')).toBe('--title requires a value')
	expect(err(root, 'edit', 'a', '--title', '--spec', 'x')).toBe('--title requires a value')
	expect(err(root, 'edit', 'a', '--title', 'x', '--title', 'y')).toBe('--title may be given only once')
	expect(err(root, 'edit', 'a', '--description', 'x')).toBe('unknown option --description; use --spec')
	expect(read(root, 'a')).toBe(before)
})

test('without flags, edit opens $VISUAL, then $EDITOR, with the record including notes', () => {
	const root = fixture()
	const seen = join(tempDir(), 'seen')
	const env = { VISUAL: editor(`cp "$1" ${seen}; sed -i "s/'n1'/'n1', 'n2'/" "$1"`), EDITOR: editor('exit 9') }
	const result = tsk(root, ['edit', 'b'], env)
	expect(result.code).toBe(0)
	expect(parse(read(root, 'b'))).toMatchObject({ notes: ['n1', 'n2'] })
	expect(read(root, 'b')).toContain('// about b')
	expect(parse(readFileSync(seen, 'utf8'))).toMatchObject({ title: 'B' })
})

test('editor failures and invalid results keep the original', () => {
	const root = fixture()
	const before = read(root, 'b')
	const failing = tsk(root, ['edit', 'b'], { VISUAL: '', EDITOR: editor('exit 3') })
	expect(failing.stderr).toBe('tsk: editor exited with status 3; task unchanged\n')
	const invalid = tsk(root, ['edit', 'b'], { VISUAL: editor('echo "{ title: 1 }" > "$1"') })
	expect(invalid.stderr).toBe('tsk: task b: title must be a nonempty string; task unchanged\n')
	const done = tsk(root, ['edit', 'b'], { VISUAL: editor(`sed -i "s/'planned'/'done'/" "$1"`) })
	expect(done.stderr).toBe('tsk: task b cannot be done with unfinished prerequisites: a; task unchanged\n')
	expect(read(root, 'b')).toBe(before)
})
