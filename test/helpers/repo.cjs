const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const OPENAPI_TWO_PATHS = `openapi: 3.0.0
info: {title: t, version: '1'}
paths:
  /pets:
    get:
      responses:
        '200': {description: ok}
  /owners:
    get:
      responses:
        '200': {description: ok}
`;
const OPENAPI_ONE_PATH = OPENAPI_TWO_PATHS.split('  /owners:')[0];

/** Creates a throwaway Git repository with one commit; the caller removes `dir` when done. */
function createRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noditrivo-repo-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
  write('src/b.ts', 'export const b = 1;\n');
  write('openapi.yaml', OPENAPI_TWO_PATHS);
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return { dir, git, write, remove: () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) };
}

/** Polls until `predicate` is truthy; fails the test with `label` on timeout. */
async function until(predicate, label, timeoutMs = 15000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

module.exports = { createRepo, until, OPENAPI_TWO_PATHS, OPENAPI_ONE_PATH };
