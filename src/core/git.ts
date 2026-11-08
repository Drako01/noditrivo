import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChangedFile, ChangeStatus } from './impact';

const execFileAsync = promisify(execFile);

const GIT_BASELINE = /^[A-Za-z0-9._/~-]+$/;

/** Single source of truth for baseline validation (core and UI). */
export function isValidGitBaseline(baseline: string): boolean {
  return GIT_BASELINE.test(baseline) && !baseline.startsWith('-');
}

const STATUS_BY_CODE: Readonly<Record<string, ChangeStatus>> = {
  A: 'added',
  M: 'modified',
  T: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
};

/** Parses `git diff --name-status -z` output (NUL separated; R/C carry two paths). */
export function parseNameStatus(raw: string): ChangedFile[] {
  const tokens = raw.split('\0').filter(Boolean);
  const files: ChangedFile[] = [];
  for (let i = 0; i < tokens.length;) {
    const code = tokens[i++][0];
    const status = STATUS_BY_CODE[code];
    if (!status) throw new Error(`Unexpected Git status code: ${code}`);
    if (code === 'R' || code === 'C') {
      const oldPath = tokens[i++];
      const path = tokens[i++];
      if (path === undefined) throw new Error('Malformed Git rename output.');
      files.push(code === 'R' ? { path, status, oldPath } : { path, status });
    } else {
      const path = tokens[i++];
      if (path === undefined) throw new Error('Malformed Git status output.');
      files.push({ path, status });
    }
  }
  return files;
}

export function parseUntracked(raw: string): ChangedFile[] {
  return raw.split('\0').filter(Boolean).map(path => ({ path, status: 'untracked' as const }));
}

// No shell is ever invoked: Git receives an argument vector to avoid injection.
// fsmonitor is disabled and optional locks are off so analysis never executes
// repository-configured hooks or writes to the index.
function runGit(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  return execFileAsync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30000,
    encoding: 'utf8',
    signal,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }).then(result => result.stdout);
}

const MISSING_AT_BASELINE = /does not exist|exists on disk, but not in/;

/**
 * Content of `relativePath` (relative to `workspacePath`) at `baseline`, or
 * `undefined` when the file did not exist there. Any other failure is thrown.
 */
export async function readFileAtBaseline(workspacePath: string, baseline: string, relativePath: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!isValidGitBaseline(baseline)) throw new Error('Invalid Git baseline.');
  try {
    return await runGit(workspacePath, ['show', `${baseline}:./${relativePath}`], signal);
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && MISSING_AT_BASELINE.test(stderr)) return undefined;
    throw error;
  }
}

/**
 * Files changed in the working tree relative to `baseline`: tracked changes
 * (with rename detection and deletions) plus untracked, non-ignored files.
 * Paths are relative to `workspacePath`.
 */
export async function getChangedFiles(workspacePath: string, baseline: string, signal?: AbortSignal): Promise<ChangedFile[]> {
  if (!isValidGitBaseline(baseline)) throw new Error('Invalid Git baseline.');
  const [tracked, untracked] = await Promise.all([
    runGit(workspacePath, ['diff', '--name-status', '-z', '-M', '--relative', '--diff-filter=ACDMRT', baseline, '--'], signal),
    runGit(workspacePath, ['ls-files', '--others', '--exclude-standard', '-z'], signal),
  ]);
  return [...parseNameStatus(tracked), ...parseUntracked(untracked)];
}
