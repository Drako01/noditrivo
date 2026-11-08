// Executable checks for docs/THREAT_MODEL.md: read-only, local-only, workspace trust and hostile input.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isValidGitBaseline, getChangedFiles } = require('../dist/core/git.js');
const { renderControlCenter } = require('../dist/ui/controlCenter.js');
const { createEvidence } = require('../dist/core/evidence.js');
const { analyzeImpact } = require('../dist/core/impact.js');
const { MemoryAnalysisCache } = require('../dist/core/cache.js');
const { createRepo } = require('./helpers/repo.cjs');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function sourceFiles(dir = SRC) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
/** Source text without comments, so rules cannot be satisfied or tripped by prose. */
const code = file => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const rel = file => path.relative(ROOT, file).replace(/\\/g, '/');
const offenders = pattern => sourceFiles().filter(file => pattern.test(code(file))).map(rel);

test('no network, dynamic code evaluation or shell execution anywhere in the extension', () => {
  assert.deepEqual(offenders(/from 'node:(?:https?|net|tls|dns|dgram|http2)'|require\('(?:https?|net|tls|dns)'\)|\bfetch\(|XMLHttpRequest|WebSocket/), []);
  assert.deepEqual(offenders(/\beval\(|new Function\(|\bvm\.run|node:vm/), []);
  assert.deepEqual(offenders(/shell:\s*true|\bexecSync\(|\bspawnSync\(|(?<![.\w])spawn\(|(?<![.\w])exec\(/), []);
});

test('only Git runs as a child process, and only read-only subcommands', () => {
  const spawning = offenders(/child_process/);
  assert.deepEqual(spawning, ['src/core/git.ts']);
  const subcommands = [...code(path.join(SRC, 'core', 'git.ts')).matchAll(/runGit\(\w+,\s*\[\s*'([a-z-]+)'/g)].map(match => match[1]).sort();
  assert.deepEqual(subcommands, ['diff', 'ls-files', 'show']);
  assert.match(code(path.join(SRC, 'core', 'git.ts')), /core\.fsmonitor=false/);
  assert.match(code(path.join(SRC, 'core', 'git.ts')), /GIT_OPTIONAL_LOCKS:\s*'0'/);
});

test('the extension never writes to the project, the database or the infrastructure', () => {
  assert.deepEqual(offenders(/writeFile|appendFile|createWriteStream|\bunlink|\brmSync|\brmdir|\bmkdir|\brename\(|copyFile|applyEdit|\.edit\(|workspace\.fs\.(?:write|delete|createDirectory|copy|rename)/), []);
  const mutating = offenders(/workspaceState\.update|globalState\.update/);
  assert.deepEqual(mutating, ['src/extension.ts'], 'extension storage is the only thing it persists');
});

test('workspace trust: limited capability in the manifest and a runtime check before any analysis', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, 'limited');
  assert.match(manifest.capabilities.untrustedWorkspaces.description, /noditrivo\.untrusted\.description/);
  assert.ok(!('virtualWorkspaces' in manifest.capabilities) || manifest.capabilities.virtualWorkspaces.supported !== true);
  const extension = code(path.join(SRC, 'extension.ts'));
  const trust = extension.indexOf('isTrusted');
  assert.ok(trust > 0 && trust < extension.indexOf('runAnalysis('), 'the trust check precedes the analysis');
  assert.ok(trust < extension.indexOf('isValidGitBaseline(baseline)'), 'untrusted workspaces fail before anything is validated or run');
  for (const locale of ['package.nls.json', 'package.nls.es.json']) {
    assert.ok(JSON.parse(fs.readFileSync(path.join(ROOT, locale), 'utf8'))['noditrivo.untrusted.description'], locale);
  }
});

test('the Webview is locked down: no resource roots, strict CSP, no remote content', () => {
  const extension = code(path.join(SRC, 'extension.ts'));
  assert.match(extension, /localResourceRoots:\s*\[\]/);
  assert.ok(!/enableCommandUris|enableForms/.test(extension));
  const html = renderControlCenter({ baseline: 'HEAD', phase: 'idle' }, 'en', 'n0nce');
  assert.match(html, /default-src 'none'; style-src 'nonce-n0nce'; script-src 'nonce-n0nce';/);
  assert.ok(!/(?:src|href)=|https?:\/\/|<iframe|<img|unsafe-eval|unsafe-inline/i.test(html));
  assert.equal((html.match(/<script/g) ?? []).length, 1);
});

test('hostile text from the repository is escaped everywhere it is rendered', () => {
  const attack = '<img src=x onerror=alert(1)>"\'';
  const evidence = createEvidence({ analyzer: 'openapi', rule: 'openapi.path-removed', severity: 'breaking', confidence: 'high', file: attack, subject: attack, location: attack });
  const finding = { changedFile: attack, changeStatus: 'modified', affectedFile: attack, kind: 'direct-import', specifier: attack, confidence: 'high' };
  const report = { ...analyzeImpact(attack, [{ path: attack, status: 'modified', oldPath: attack }], new Map()), findings: [finding], evidence: [evidence] };
  const comparison = { baseline: attack, evidence: { added: [evidence], existing: [], resolved: [evidence] }, findings: { added: [finding], existing: [], resolved: [finding] } };
  const html = renderControlCenter({ baseline: attack, phase: 'done', report, comparison, error: attack }, 'en', 'n');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('onerror=alert(1)>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;'));
  const errorHtml = renderControlCenter({ baseline: attack, phase: 'error', error: attack }, 'en', 'n');
  assert.ok(!errorHtml.includes('<img'));
});

test('hostile Git refs never reach a process', async () => {
  const hostile = ['--upload-pack=x', '-p', '--output=/tmp/x', 'a b', 'a;b', 'a&&b', 'a|b', '$(id)', '`id`', 'a\nb', 'a\0b', '@{-1}', 'HEAD^{tree}', 'a:b', '*', '', ' HEAD', 'HEAD '];
  for (const ref of hostile) {
    assert.ok(!isValidGitBaseline(ref), JSON.stringify(ref));
    await assert.rejects(getChangedFiles(ROOT, ref), /Invalid Git baseline/, JSON.stringify(ref));
  }
});

test('repository-configured commands are not executed while analyzing', async t => {
  const repo = createRepo();
  try {
    const marker = path.join(repo.dir, '..', `noditrivo-marker-${path.basename(repo.dir)}`);
    const hook = path.join(repo.dir, '..', `noditrivo-hook-${path.basename(repo.dir)}.cjs`);
    fs.writeFileSync(hook, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
    repo.git('config', 'core.fsmonitor', `node "${hook.replace(/\\/g, '/')}"`);
    repo.write('src/b.ts', 'export const b = 2;\n');

    // Precondition: with default settings Git would run the configured command.
    try { execFileSync('git', ['status', '--porcelain'], { cwd: repo.dir, stdio: 'pipe' }); } catch { /* the hook may fail; only its side effect matters */ }
    const triggered = fs.existsSync(marker);
    fs.rmSync(marker, { force: true });
    if (!triggered) t.diagnostic('this Git build did not run core.fsmonitor on status; the precondition could not be established');

    const files = await getChangedFiles(repo.dir, 'HEAD');
    assert.deepEqual(files.map(file => file.path), ['src/b.ts']);
    assert.ok(!fs.existsSync(marker), 'core.fsmonitor from the repository must not run');
    fs.rmSync(hook, { force: true });
  } finally {
    repo.remove();
  }
});

test('the persisted cache holds no secret values', () => {
  const secret = 'sup3r-s3cret-p4ssw0rd-value';
  const cache = new MemoryAnalysisCache();
  analyzeImpact('HEAD', [], new Map(), undefined, [
    { path: 'docker-compose.yml', status: 'added', after: `services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: ${secret}\n` },
    { path: 'main.tf', status: 'added', after: `provider "x" {\n  password = "${secret}"\n}\n` },
    { path: 'secret.yaml', status: 'added', after: `apiVersion: v1\nkind: Secret\nmetadata:\n  name: s\nstringData:\n  token: ${secret}\n` },
  ], cache);
  const stored = JSON.stringify(cache.snapshot());
  assert.ok(stored.includes('inline-secret') || stored.includes('sensitive-literal') || stored.includes('secret-in-manifest'), 'the scenario must report the secrets');
  assert.ok(!stored.includes(secret));
});
