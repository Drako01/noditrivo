const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { MemoryAnalysisCache, cacheKey, ANALYZER_VERSION, CACHE_SALT } = require('../dist/core/cache.js');
const { analyzeImpact } = require('../dist/core/impact.js');
const { analyzeInfra, isInfraDocument } = require('../dist/core/infra.js');
const { compareReports, diffByKey, ReportHistory } = require('../dist/core/compare.js');
const { parseEvidence } = require('../dist/core/evidence.js');

const OPENAPI_BEFORE = "openapi: 3.0.0\ninfo: {title: t, version: '1'}\npaths:\n  /a:\n    get:\n      responses:\n        '200': {description: ok}\n  /b:\n    get:\n      responses:\n        '200': {description: ok}\n";
const OPENAPI_AFTER = OPENAPI_BEFORE.split('  /b:')[0];
const COMPOSE_BEFORE = 'services:\n  web:\n    image: nginx:1\n  db:\n    image: postgres:16\n';
const COMPOSE_AFTER = 'services:\n  web:\n    image: nginx:1\n    depends_on: [db]\n';
const K8S = kind => `apiVersion: v1\nkind: ${kind}\nmetadata:\n  name: x\n`;

const documents = () => [
  { path: 'sql/migrations/001.sql', status: 'modified', before: '-- init\nSELECT 1;\n', after: '-- init\nSELECT 1;\nDROP TABLE a;\n' },
  { path: 'api/openapi.yaml', status: 'modified', before: OPENAPI_BEFORE, after: OPENAPI_AFTER },
  { path: 'docker-compose.yml', status: 'modified', before: COMPOSE_BEFORE, after: COMPOSE_AFTER },
  { path: 'k8s/cm.yaml', status: 'deleted', before: K8S('ConfigMap') },
  { path: 'README.md', status: 'modified', before: 'a', after: 'b' },
];
const changed = [{ path: 'src/b.ts', status: 'modified' }];
const sources = new Map([['src/a.ts', "import './b';"], ['src/c.ts', "import x from './b.js'; import y from './nope';"]]);
const run = (cache, docs = documents()) => analyzeImpact('HEAD', changed, sources, undefined, docs, cache);

test('cache keys are unambiguous and namespaced', () => {
  assert.notEqual(cacheKey('imports', ['ab', 'c']), cacheKey('imports', ['a', 'bc']));
  assert.notEqual(cacheKey('imports', [undefined]), cacheKey('imports', ['']));
  assert.notEqual(cacheKey('imports', ['x']), cacheKey('evidence', ['x']));
  assert.equal(cacheKey('imports', ['x']), cacheKey('imports', ['x']));
  assert.match(cacheKey('evidence', ['x']), /^evidence:[0-9a-f]{32}$/);
});

test('memoizes, counts hits and evicts the least recently used entry', () => {
  const cache = new MemoryAnalysisCache(2);
  let computed = 0;
  const get = key => cache.memo('imports', [key], () => { computed++; return [key]; });
  get('a'); get('b'); get('a'); get('c');
  assert.deepEqual(cache.stats, { hits: 1, misses: 3 });
  assert.equal(cache.size, 2);
  get('a');
  assert.equal(computed, 3, 'a stayed (recently used)');
  get('b');
  assert.equal(computed, 4, 'b was evicted');
  assert.throws(() => new MemoryAnalysisCache(0), RangeError);
  cache.clear();
  assert.deepEqual([cache.size, cache.stats], [0, { hits: 0, misses: 0 }]);
});

test('deterministic replay: cached, cold and uncached runs are identical, whatever the document order', () => {
  const baseline = run(undefined);
  assert.ok(baseline.evidence.length >= 4, 'the scenario must produce evidence from several analyzers');
  const cache = new MemoryAnalysisCache();
  const cold = run(cache);
  const coldStats = cache.stats;
  assert.equal(coldStats.hits, 0);
  const warm = run(cache, documents().reverse());
  assert.deepEqual(JSON.parse(JSON.stringify(cold)), JSON.parse(JSON.stringify(baseline)));
  assert.deepEqual(JSON.parse(JSON.stringify(warm)), JSON.parse(JSON.stringify(baseline)));
  assert.equal(cache.stats.misses, coldStats.misses, 'the warm run computed nothing');
  assert.equal(cache.stats.hits, coldStats.misses);
});

test('invalidation: only the changed input is recomputed', () => {
  const cache = new MemoryAnalysisCache();
  run(cache);
  const before = cache.stats;
  const docs = documents();
  docs[0] = { ...docs[0], after: '-- init\nSELECT 1;\nTRUNCATE a;\n' };
  const report = run(cache, docs);
  assert.equal(cache.stats.misses - before.misses, 1, 'only the edited SQL document');
  assert.ok(report.evidence.some(item => item.rule === 'sql.truncate'));
  assert.ok(!report.evidence.some(item => item.rule === 'sql.drop-table'), 'the stale result is not replayed');

  const mid = cache.stats;
  const docs2 = documents();
  docs2[2] = { ...docs2[2], after: COMPOSE_BEFORE };
  run(cache, docs2);
  assert.equal(cache.stats.misses - mid.misses, 1, 'the infrastructure set is recomputed once');
});

test('filtering to infrastructure documents does not change what the infra analyzers report', () => {
  const docs = [...documents(), { path: 'infra/main.tf', status: 'deleted', before: 'resource "aws_s3_bucket" "b" {\n  bucket = "x"\n}\n' }];
  assert.deepEqual(analyzeInfra(docs.filter(isInfraDocument)), analyzeInfra(docs));
});

test('snapshots survive JSON and are validated on restore', () => {
  const source = new MemoryAnalysisCache();
  run(source);
  const snapshot = JSON.parse(JSON.stringify(source.snapshot()));

  const restored = new MemoryAnalysisCache();
  assert.equal(restored.restore(snapshot), source.size);
  run(restored);
  assert.equal(restored.stats.misses, 0, 'a restored cache replays everything');

  const withEvidence = snapshot.entries.find(([, kind, value]) => kind === 'evidence' && value.length > 0);
  const tampered = structuredClone(snapshot);
  tampered.entries.find(([key]) => key === withEvidence[0])[2][0].subject = 'forged';
  const partial = new MemoryAnalysisCache();
  assert.equal(partial.restore(tampered), snapshot.entries.length - 1, 'forged evidence (id mismatch) is dropped');

  assert.equal(new MemoryAnalysisCache().restore({ ...snapshot, salt: 'old' }), 0);
  for (const junk of [null, 'x', 1, {}, { salt: CACHE_SALT, entries: 'x' }, { salt: CACHE_SALT, entries: [['evidence:1', 'imports', ['a']], ['k', 'imports', []], ['imports:1', 'imports', [1]], ['evidence:2', 'evidence', [{}]], [1, 2]] }]) {
    assert.equal(new MemoryAnalysisCache().restore(junk), 0);
  }
  assert.equal(parseEvidence({ ...source.snapshot().entries[0][2][0], rule: 'not.a.rule' }), undefined);
});

test('snapshot honors its size limit, keeping the most recent entries', () => {
  const cache = new MemoryAnalysisCache();
  for (const key of ['a', 'b', 'c']) cache.memo('imports', [key], () => [key]);
  assert.deepEqual(cache.snapshot(2).entries.map(entry => entry[2]), [['b'], ['c']]);
  assert.equal(cache.snapshot(0).entries.length, 0);
});

test('analyzer fingerprint: changing an analyzer requires bumping ANALYZER_VERSION', () => {
  const dir = path.join(__dirname, '..', 'src', 'core');
  const files = ['openapi', 'sql', 'compose', 'kubernetes', 'terraform', 'secrets', 'values', 'infra'].map(name => `${name}.ts`);
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update(fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n'));
  const actual = { analyzerVersion: ANALYZER_VERSION, sources: hash.digest('hex') };
  const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'analyzer-fingerprint.json'), 'utf8'));
  assert.deepEqual(actual, recorded, 'Analyzer sources changed: bump ANALYZER_VERSION in src/core/cache.ts and update test/analyzer-fingerprint.json with the actual value above.');
});

test('compare: new, existing and resolved are matched by identity', () => {
  assert.deepEqual(diffByKey([1, 2, 3], [2, 3, 4], String), { added: [4], existing: [2, 3], resolved: [1] });
  assert.deepEqual(diffByKey([], [], String), { added: [], existing: [], resolved: [] });

  const first = run(undefined);
  const dropped = run(undefined, documents().slice(1));
  const comparison = compareReports(first, dropped);
  assert.equal(comparison.baseline, 'HEAD');
  assert.ok(comparison.evidence.resolved.some(item => item.rule === 'sql.drop-table'));
  assert.equal(comparison.evidence.added.length, 0);
  assert.equal(comparison.evidence.existing.length + comparison.evidence.resolved.length, first.evidence.length);
  assert.equal(comparison.findings.existing.length, first.findings.length);
  const identical = compareReports(first, first);
  assert.deepEqual([identical.evidence.added, identical.evidence.resolved, identical.findings.added], [[], [], []]);
});

test('report history compares per scope and bounds its memory', () => {
  const history = new ReportHistory(2);
  const report = run(undefined);
  assert.equal(history.record('a', report), undefined);
  assert.ok(history.record('a', report));
  assert.equal(history.record('b', report), undefined, 'another scope has no history');
  history.record('c', report);
  assert.equal(history.record('a', report), undefined, 'the oldest scope was evicted');
  assert.throws(() => new ReportHistory(0), RangeError);
});
