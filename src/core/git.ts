import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

export async function getChangedFiles(workspacePath: string, baseline: string): Promise<string[]> {
  // Do not invoke a shell. Git receives an argument vector to avoid injection.
  if (!/^[A-Za-z0-9._/~-]+$/.test(baseline) || baseline.startsWith('-')) {
    throw new Error('Invalid Git baseline.');
  }
  const { stdout } = await execFileAsync('git', [
    'diff', '--name-only', '-z', '--diff-filter=ACMRT', baseline, '--'
  ], { cwd:workspacePath, maxBuffer: 4 * 1024 * 1024, timeout: 15000, encoding:'utf8' });
  return stdout.split('\0').filter(Boolean);
}
