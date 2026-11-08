// Functional tests of the compiled extension inside a simulated VS Code host (see helpers/vscodeHost.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHost, loadExtension } = require('./helpers/vscodeHost.cjs');
const { createRepo, until, OPENAPI_ONE_PATH, OPENAPI_TWO_PATHS } = require('./helpers/repo.cjs');
const { translate } = require('../dist/i18n.js');

const ENTRY = require('node:path').join(__dirname, '..', 'dist', 'extension.js');
const lastHtml = host => host.panels[0].renders.at(-1);
const finished = (host, count) => () => host.panels[0] && host.panels[0].renders.filter(html => /data-focus="true"/.test(html)).length >= count;

function activate(options) {
  const host = createHost(options);
  loadExtension(ENTRY).activate(host.context);
  return host;
}

test('registers its commands and opens a locked-down Control Center', () => {
  const host = activate({ rootPath: process.cwd() });
  assert.deepEqual([...host.commands.keys()].sort(), ['noditrivo.analyzeChanges', 'noditrivo.openControlCenter']);
  host.commands.get('noditrivo.openControlCenter')();
  host.commands.get('noditrivo.openControlCenter')();
  assert.equal(host.panels.length, 1, 'a second open reveals the same panel');
  assert.equal(host.panels[0].revealed, 1);
  assert.deepEqual(host.panels[0].options.localResourceRoots, []);
  assert.match(lastHtml(host), /default-src 'none'/);
});

test('analyzes a real repository, compares with the previous run and persists the cache', async () => {
  const repo = createRepo();
  try {
    const host = activate({ rootPath: repo.dir });
    host.commands.get('noditrivo.openControlCenter')();
    const panel = host.panels[0];

    repo.write('src/b.ts', 'export const b = 2;\n');
    panel.post({ type: 'analyze', baseline: 'HEAD' });
    await until(finished(host, 1), 'first analysis');
    assert.match(lastHtml(host), /src\/a\.ts imports src\/b\.ts/);
    assert.ok(lastHtml(host).includes(translate('en', 'compare.first')));
    assert.deepEqual(host.errors, []);

    repo.write('openapi.yaml', OPENAPI_ONE_PATH);
    panel.post({ type: 'analyze', baseline: 'HEAD' });
    await until(finished(host, 2), 'second analysis');
    assert.ok(lastHtml(host).includes('Evidence: 1 new · 0 existing · 0 resolved. Direct imports: 0 new · 1 existing · 0 resolved.'));
    assert.match(lastHtml(host), /<span class="badge">new<\/span>/);

    repo.write('openapi.yaml', OPENAPI_TWO_PATHS);
    panel.post({ type: 'analyze', baseline: 'HEAD' });
    await until(finished(host, 3), 'third analysis');
    assert.ok(lastHtml(host).includes('Evidence: 0 new · 0 existing · 1 resolved.'));
    assert.ok(lastHtml(host).includes(translate('en', 'compare.resolvedHeading')));

    const persisted = host.storage.get('noditrivo.analysisCache');
    assert.ok(persisted && persisted.entries.length > 0, 'the cache snapshot is stored in extension storage');

    // A new session restores the snapshot and replays without recomputing documents.
    const next = activate({ rootPath: repo.dir, initialState: host.storage });
    next.commands.get('noditrivo.openControlCenter')();
    next.panels[0].post({ type: 'analyze', baseline: 'HEAD' });
    await until(finished(next, 1), 'replayed analysis');
    assert.match(lastHtml(next), /src\/a\.ts imports src\/b\.ts/);
  } finally {
    repo.remove();
  }
});

test('an untrusted workspace is refused before any Git process runs', async () => {
  const host = activate({ rootPath: process.cwd(), trusted: false });
  host.commands.get('noditrivo.openControlCenter')();
  host.panels[0].post({ type: 'analyze', baseline: 'HEAD' });
  await until(() => host.errors.length > 0, 'untrusted error');
  assert.deepEqual(host.errors, [translate('en', 'error.untrusted')]);
  assert.ok(lastHtml(host).includes(translate('en', 'error.untrusted')));
});

test('malformed Webview messages are ignored and bad baselines are rejected', async () => {
  const host = activate({ rootPath: process.cwd() });
  host.commands.get('noditrivo.openControlCenter')();
  const rendersBefore = host.panels[0].renders.length;
  for (const message of [null, 'analyze', 42, {}, { type: 'analyze' }, { type: 'analyze', baseline: 7 }, { type: 'other', baseline: 'HEAD' }]) host.panels[0].post(message);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(host.panels[0].renders.length, rendersBefore);
  assert.deepEqual(host.errors, []);

  for (const baseline of ['--output=x', 'a b', '$(id)', '']) host.panels[0].post({ type: 'analyze', baseline });
  await until(() => host.errors.length === 4, 'invalid baseline errors');
  assert.ok(host.errors.every(message => message === translate('en', 'error.invalidBaseline')));
});

test('reports a missing workspace and honors cancellation', async () => {
  const none = activate({});
  none.commands.get('noditrivo.openControlCenter')();
  none.panels[0].post({ type: 'analyze', baseline: 'HEAD' });
  await until(() => none.errors.length > 0, 'no workspace error');
  assert.deepEqual(none.errors, [translate('en', 'error.noWorkspace')]);

  const repo = createRepo();
  try {
    const host = activate({ rootPath: repo.dir, cancelled: true, language: 'es' });
    host.commands.get('noditrivo.openControlCenter')();
    host.panels[0].post({ type: 'analyze', baseline: 'HEAD' });
    await until(finished(host, 1), 'cancelled analysis');
    assert.ok(lastHtml(host).includes(translate('es', 'phase.cancelled')));
    assert.deepEqual(host.errors, []);
  } finally {
    repo.remove();
  }
});
