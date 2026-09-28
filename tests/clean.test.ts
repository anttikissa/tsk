import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { err, json, ok, repo } from './helpers.ts'

function fixture(keep: string[]): string {
	const root = repo()
	writeFileSync(join(root, 'tasks', 'project.ason'), `{ format: 'tsk', version: 1, keep: ${JSON.stringify(keep).replace(/"/g, "'")} }\n`)
	writeFileSync(join(root, 'README.md'), 'keep')
	writeFileSync(join(root, 'junk.ts'), 'x')
	mkdirSync(join(root, 'docs', 'deep'), { recursive: true })
	writeFileSync(join(root, 'docs', 'keep.md'), 'keep')
	writeFileSync(join(root, 'docs', 'deep', 'drop.md'), 'x')
	mkdirSync(join(root, 'src'))
	writeFileSync(join(root, 'src', 'a.ts'), 'x')
	return root
}

test('clean lists top-level entries without deleting them', () => {
	const root = fixture(['README.md', 'docs/keep.md'])
	expect(ok(root, 'clean')).toBe('WOULD DELETE docs (partly)\nWOULD DELETE junk.ts\nWOULD DELETE src\nRun tsk clean -f to delete.\n')
	expect(json(root, 'clean')).toEqual(['docs (partly)', 'junk.ts', 'src'])
	expect(existsSync(join(root, 'src', 'a.ts'))).toBe(true)
	expect(existsSync(join(root, 'docs', 'deep', 'drop.md'))).toBe(true)
})

test('clean -f deletes everything except .git, tasks and keep paths', () => {
	const root = fixture(['README.md', 'docs/keep.md'])
	expect(ok(root, 'clean', '-f')).toBe('DELETED docs (partly)\nDELETED junk.ts\nDELETED src\n')
	expect(existsSync(join(root, 'README.md'))).toBe(true)
	expect(existsSync(join(root, 'docs', 'keep.md'))).toBe(true)
	expect(existsSync(join(root, 'docs', 'deep'))).toBe(false)
	expect(existsSync(join(root, 'src'))).toBe(false)
	expect(existsSync(join(root, '.git'))).toBe(true)
	expect(existsSync(join(root, 'tasks', 'project.ason'))).toBe(true)
	expect(ok(root, 'clean', '--force')).toBe('Nothing to clean.\n')
})

test('clean removes symlinks without following them', () => {
	const root = fixture([])
	const outside = join(root, '..', `${root.split('/').pop()}-outside`)
	mkdirSync(outside)
	writeFileSync(join(outside, 'f'), 'keep')
	symlinkSync(outside, join(root, 'link'))
	ok(root, 'clean', '-f')
	expect(existsSync(join(root, 'link'))).toBe(false)
	expect(readFileSync(join(outside, 'f'), 'utf8')).toBe('keep')
})

test('clean rejects keep paths outside the repository', () => {
	expect(err(fixture(['../x']), 'clean')).toMatch(/not inside the repository/)
})
