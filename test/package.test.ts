import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = fileURLToPath(new URL('..', import.meta.url));
const originalPath = process.env.PATH ?? '';

type Options = { cwd?: string; env?: NodeJS.ProcessEnv };
function run(command: string, args: string[], { cwd = checkout, env = process.env }: Options = {}): string {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 120_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${basename(command)} ${args.join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function isolatedPath(dir: string, binaries: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  for (const [name, executable] of Object.entries(binaries)) symlinkSync(executable, join(dir, name));
  return dir;
}

test('one checkout launcher works from outside checkout, via symlink, on Node and Bun', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tsk-checkout-'));
  try {
    const link = join(tmp, 'tsk');
    symlinkSync(join(checkout, 'run'), link);
    const tools = {
      dirname: run('which', ['dirname']),
      readlink: run('which', ['readlink']),
    };
    const nodePath = isolatedPath(join(tmp, 'node-bin'), { ...tools, node: process.execPath });
    const bunPath = isolatedPath(join(tmp, 'bun-bin'), { ...tools, bun: run('which', ['bun']) });
    const version = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')).version as string;
    expect(run(link, ['--version'], { cwd: tmp, env: { ...process.env, PATH: nodePath } })).toBe(version);
    expect(run(link, ['--version'], { cwd: tmp, env: { ...process.env, PATH: bunPath } })).toBe(version);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 120_000);

test('packed npm and Bun installs launch inside a disposable Git repository', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tsk-package-'));
  try {
    const project = join(tmp, 'project');
    mkdirSync(join(project, 'tasks'), { recursive: true });
    run('git', ['init', '-q', project]);
    writeFileSync(join(project, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }");

    const packOutput = run('npm', ['pack', '--json', '--pack-destination', tmp]);
    const [{ filename }] = JSON.parse(packOutput) as Array<{ filename: string }>;
    const archive = join(tmp, filename);
    expect(existsSync(archive)).toBe(true);
    const members = run('tar', ['-tzf', archive]).split('\n');
    for (const path of ['package/run', 'package/dist/cli.js', 'package/src/cli.ts']) {
      expect(members).toContain(path);
    }

    const npmHome = join(tmp, 'npm-home');
    const npmPrefix = join(tmp, 'npm-global');
    mkdirSync(npmHome);
    const npmEnv = {
      ...process.env,
      HOME: npmHome,
      npm_config_prefix: npmPrefix,
      npm_config_cache: join(tmp, 'npm-cache'),
    };
    run('npm', ['install', '--global', '--ignore-scripts', '--no-audit', '--no-fund', archive], { env: npmEnv });
    const npmBin = join(npmPrefix, 'bin', 'tsk');
    expect(existsSync(npmBin)).toBe(true);

    const nodePath = isolatedPath(join(tmp, 'node-only-bin'), {
      node: process.execPath,
      git: run('which', ['git']),
      dirname: run('which', ['dirname']),
      readlink: run('which', ['readlink']),
    });
    const nodeRuntimeEnv = { ...npmEnv, PATH: nodePath };
    const version = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')).version as string;
    expect(run(npmBin, ['--version'], { cwd: project, env: nodeRuntimeEnv })).toBe(version);
    expect(JSON.parse(run(npmBin, ['ls', '--format', 'json'], { cwd: project, env: nodeRuntimeEnv }))).toEqual([]);

    const bunExecutable = run('which', ['bun']);
    const bunRoot = join(tmp, 'bun-install');
    const bunBinDir = join(tmp, 'bun-global-bin');
    const bunEnv = {
      ...process.env,
      HOME: join(tmp, 'bun-home'),
      BUN_INSTALL: bunRoot,
      BUN_INSTALL_GLOBAL_DIR: join(tmp, 'bun-global'),
      BUN_INSTALL_BIN: bunBinDir,
      BUN_INSTALL_CACHE_DIR: join(tmp, 'bun-cache'),
      PATH: originalPath,
    };
    mkdirSync(bunEnv.HOME);
    run(bunExecutable, ['install', '--global', archive], { env: bunEnv });
    const bunBin = join(bunBinDir, 'tsk');
    expect(existsSync(bunBin)).toBe(true);
    const bunPath = isolatedPath(join(tmp, 'bun-only-bin'), {
      bun: bunExecutable,
      git: run('which', ['git']),
      dirname: run('which', ['dirname']),
      readlink: run('which', ['readlink']),
    });
    const bunRuntimeEnv = { ...bunEnv, PATH: bunPath };
    expect(run(bunBin, ['--version'], { cwd: project, env: bunRuntimeEnv })).toBe(version);
    expect(JSON.parse(run(bunBin, ['ls', '--format', 'json'], { cwd: project, env: bunRuntimeEnv }))).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 120_000);
