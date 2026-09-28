// Help texts. Help never runs commands or needs a Tsk project.
import { readFileSync } from 'node:fs'

/** The package version, read from package.json next to src/ or dist/. */
export function version(): string {
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
	return pkg.version
}

const HELP = '  --help, -h           Show this help'
const FORMAT = '  --format json|ason   Print structured data instead of human-readable output'

type CommandHelp = { usage: string; summary: string; options?: string[]; examples: string[] }

export const COMMANDS: Record<string, CommandHelp> = {
	init: {
		usage: 'tsk init',
		summary: 'Create tasks/, its project.ason marker and a README.md template at the Git root. Never touches an existing tasks/ directory.',
		options: [FORMAT],
		examples: ['tsk init'],
	},
	add: {
		usage: 'tsk add --title <text> --spec <text> [options]',
		summary: 'Add a planned task with a new random ID and print it.',
		options: [
			'  --title <text>       Task title (required)',
			'  --spec <text>        Intended behavior and constraints (required)',
			'  --needs <id>         Prerequisite task; repeat for more',
			'  --fold-into <id>     Rebuild target to fold this task into; repeat for more',
			'  --status done        Add the task as already done',
			'  --once               Mark one-off work that stays done across rebuilds',
			FORMAT,
		],
		examples: [
			"tsk add --title 'Cover the parser' --spec 'Tests exercise valid and invalid input'",
			"tsk add --title 'Document the parser' --spec 'README explains parser behavior' --needs 4k",
		],
	},
	ls: {
		usage: 'tsk ls [--status planned|done] [--spec] [--notes] [--folded-by]',
		summary: 'List tasks sorted by ID: status, ID, title, counts, a spec excerpt and its size.',
		options: [
			'  --status <status>    Only planned or only done tasks',
			'  --spec               Show full specs',
			'  --notes              Show notes',
			'  --folded-by          Show tasks that fold into each task',
			FORMAT,
		],
		examples: ['tsk ls', 'tsk ls --status planned --spec', 'tsk ls --format json'],
	},
	ready: {
		usage: 'tsk ready',
		summary: 'List planned tasks whose whole prerequisite chain is done.',
		options: [FORMAT],
		examples: ['tsk ready', 'tsk ready --format ason'],
	},
	foldable: {
		usage: 'tsk foldable',
		summary:
			'List tasks with foldInto targets that no other folding task targets, regardless of status. Changes nothing; refuses foldInto cycles.',
		options: [FORMAT],
		examples: ['tsk foldable'],
	},
	show: {
		usage: 'tsk show <id>',
		summary: 'Show a task: spec, status, once, dependencies, dependents, foldInto and foldedBy links, notes and files.',
		options: [FORMAT],
		examples: ['tsk show 4k', 'tsk show 4k --format json'],
	},
	tree: {
		usage: 'tsk tree [<id>]',
		summary: 'Draw the dependency graph from prerequisite roots toward dependents. An ID limits it to that task and its downstream dependents.',
		options: [FORMAT],
		examples: ['tsk tree', 'tsk tree 4k'],
	},
	done: {
		usage: 'tsk done <id>',
		summary: 'Mark a planned task done once every prerequisite in its chain is done.',
		options: [FORMAT],
		examples: ['tsk done 4k'],
	},
	edit: {
		usage: 'tsk edit <id> [options]',
		summary:
			'Update task fields with flags, or with no flags open the record in $VISUAL, $EDITOR or vi (notes too). The whole graph is validated before the task is replaced.',
		options: [
			'  --title <text>       New title',
			'  --spec <text>        New spec',
			'  --status <status>    planned or done',
			'  --once [true|false]  Set or clear the one-off marker',
			'  --needs <id>         Replace prerequisites; repeat for more',
			'  --fold-into <id>     Replace foldInto targets; repeat for more',
			FORMAT,
		],
		examples: ["tsk edit 4k --title 'Cover the lexer'", 'tsk edit 4k --needs 2x --needs 7q', 'tsk edit 4k'],
	},
	'add-note': {
		usage: 'tsk add-note <id> <text>',
		summary: "Append an observation to a task's notes.",
		options: [FORMAT],
		examples: ["tsk add-note 4k 'Parser rejects tabs in keys'"],
	},
	del: {
		usage: 'tsk del <id> [--force]',
		summary: 'Delete a task directory. Refuses tasks that other tasks need or fold into, and directories with symlinks; files require --force.',
		options: ['  --force              Also delete the files in the task directory', FORMAT],
		examples: ['tsk del 4k'],
	},
	reset: {
		usage: 'tsk reset',
		summary: 'Set done tasks back to planned for a rebuild, except once: true tasks.',
		options: [FORMAT],
		examples: ['tsk reset'],
	},
	clean: {
		usage: 'tsk clean -f',
		summary: 'Delete everything at the Git root except .git/, tasks/ and the keep list in tasks/project.ason. Without -f, only list the top-level entries it would delete.',
		options: ['  -f, --force          Delete; without it nothing is deleted', FORMAT],
		examples: ['tsk clean', 'tsk clean -f'],
	},
	version: {
		usage: 'tsk version',
		summary: 'Print the installed package version (also tsk --version).',
		examples: ['tsk --version'],
	},
	help: {
		usage: 'tsk help [<command>]',
		summary: 'Show the command summary (also tsk --help and tsk -h); tsk --detailed-help explains the task format and rebuild workflow.',
		examples: ['tsk help', 'tsk help add', 'tsk --detailed-help'],
	},
}

export function usage(): string {
	const rows = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(10)} ${c.summary.split('. ')[0]!.replace(/\.$/, '')}`)
	return `tsk ${version()}
A minimal task manager for rebuilding software.

Usage: tsk <command> [options]

Commands:
${rows.join('\n')}

Tasks live in tasks/<id>/task.ason at the Git root. Output is human-readable
by default; data commands accept --format json or --format ason.

Run tsk <command> --help for a command, or tsk --detailed-help for the task
format, fields (notes, once, foldInto), task files, the project keep list and
the rebuild workflow.
`
}

export function commandHelp(name: string): string {
	const c = COMMANDS[name]!
	let text = `Usage: ${c.usage}\n\n${c.summary}\n`
	text += `\nOptions:\n${[...(c.options ?? []), HELP].join('\n')}\n`
	text += `\nExample:\n${c.examples.map((e) => `  ${e}`).join('\n')}\n`
	return text
}

export function detailedHelp(): string {
	return `${usage()}
PROJECT STRUCTURE

A Git repository keeps its build plan in tasks/ at the Git root:

  tasks/project.ason       Marker: { format: 'tsk', version: 1 }, with an optional
                           keep list of paths that survive a rebuild
  tasks/README.md          Freeform context shared by all tasks
  tasks/<id>/task.ason     One task record per directory; the name is the ID
  tasks/<id>/<files>       Optional files that belong to the task

IDs are short lowercase Crockford base32 (0-9, a-z without i, l, o, u) and are
assigned by tsk add. Records use ASON: like JSON with unquoted keys, single
quotes, comments and trailing commas.

TASK FIELDS

  title      Short name of the work (required)
  spec       What a fresh build must produce, with important constraints (required;
             the obsolete description field is rejected)
  status     'planned' or 'done' (required)
  needs      IDs of prerequisite tasks (required, may be empty)
  once       true for one-off work, such as a release, that stays done across rebuilds
  notes      List of observations from building the task; keep them accurate
  foldInto   IDs of earlier targets that should absorb this task on a rebuild;
             advisory only, it adds no dependency and does not affect ready, done
             or reset

PROJECT FIELDS (tasks/project.ason)

  format     'tsk' (required)
  version    1 (required)
  keep       Paths relative to the Git root that a rebuild keeps besides .git/
             and tasks/

Example task.ason:

  { title: 'Cover the parser', spec: 'Tests exercise valid and invalid input', status: 'planned', needs: ['4k'] }

Files in a task directory other than task.ason are listed by tsk show. A planned
task is ready when every prerequisite in its dependency chain is done, including
prerequisites behind completed once tasks. Reverse links (dependents, foldedBy)
are derived, not stored.

EVERYDAY WORK

  tsk add --title 'Cover the parser' --spec 'Tests exercise valid and invalid input'
  tsk ready                        # pick work whose prerequisites are done
  tsk show 4k                      # read the full spec, notes and files
  tsk done 4k                      # after implementing it
  tsk add-note 4k 'Parser rejects tabs in keys'

REBUILD WORKFLOW

A rebuild deletes everything except .git/, tasks/ and the keep list, then builds
the project again from the task graph:

  tsk reset                        # done tasks become planned; once tasks stay done
  while tsk foldable lists tasks:
      take a task; merge its requirements and useful notes into each foldInto
      target, move files that must survive, update tasks that refer to it,
      then tsk del it
  tsk clean -f                     # delete everything but .git/, tasks/, keep
  while tsk ready lists tasks:
      implement a task, then tsk done <id>

OUTPUT

Commands print concise human-readable output by default. Commands that return
task data accept --format json or --format ason with the same structured
information. Errors go to stderr so structured stdout stays clean.
`
}
