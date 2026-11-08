/**
 * Performance benchmark of the analysis core on synthetic repositories (no Git, no VS Code).
 * `npm run bench` prints the timings; test/performance.test.cjs reuses `runScenarios` and gates budgets.
 * Numbers describe this machine and this synthetic workload only; they are regression gates, not guarantees.
 */
const { performance } = require('node:perf_hooks');
const { analyzeImpact } = require('../dist/core/impact.js');
const { MemoryAnalysisCache } = require('../dist/core/cache.js');

/** Scenario sizes. `budgetMs` is a deliberately loose ceiling for a cold run on a slow CI machine. */
const SCENARIOS = [
  { name: 'medium', sources: 500, changed: 50, importsPerFile: 6, openApiDocs: 5, sqlDocs: 10, budgetMs: 3000 },
  { name: 'large', sources: 3000, changed: 1000, importsPerFile: 8, openApiDocs: 30, sqlDocs: 100, budgetMs: 15000 },
];

/** Deterministic pseudo-random generator so every run analyzes the same workload. */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** An OpenAPI document with `paths` paths, or one fewer when `dropLast` (a breaking removal). */
const openApi = (paths, dropLast) => {
  const lines = ["openapi: 3.0.0", "info: {title: bench, version: '1'}", 'paths:'];
  for (let i = 0; i < paths - (dropLast ? 1 : 0); i++) lines.push(`  /items${i}:`, '    get:', '      responses:', "        '200': {description: ok}");
  return lines.join('\n') + '\n';
};

function buildWorkload(scenario) {
  const random = lcg(42);
  const names = Array.from({ length: scenario.sources }, (_, i) => `src/m${i % 40}/f${i}.ts`);
  const sources = new Map();
  for (const [index, file] of names.entries()) {
    const imports = Array.from({ length: scenario.importsPerFile }, () => {
      const target = names[Math.floor(random() * names.length)];
      const from = file.slice(0, file.lastIndexOf('/'));
      const to = target.slice(0, target.lastIndexOf('/'));
      const base = target.slice(target.lastIndexOf('/') + 1).replace(/\.ts$/, '');
      return `import { x${index} } from '${from === to ? './' : `../${to.slice(4)}/`}${base}';`;
    });
    sources.set(file, `${imports.join('\n')}\nexport const v${index} = ${index};\n`);
  }
  const changed = names.slice(0, scenario.changed).map(path => ({ path, status: 'modified' }));
  const documents = [];
  for (let i = 0; i < scenario.openApiDocs; i++) documents.push({ path: `api/v${i}.yaml`, status: 'modified', before: openApi(60, false), after: openApi(60, true) });
  for (let i = 0; i < scenario.sqlDocs; i++) {
    documents.push({ path: `db/migrations/${String(i).padStart(4, '0')}.sql`, status: 'added', after: `CREATE TABLE t${i} (id int);\nALTER TABLE t${i} ADD COLUMN c text;\nDROP TABLE old${i};\n` });
  }
  return { changed, sources, documents };
}

const time = work => {
  const started = performance.now();
  const value = work();
  return { value, ms: performance.now() - started };
};

function runScenarios(scenarios = SCENARIOS) {
  return scenarios.map(scenario => {
    const { changed, sources, documents } = buildWorkload(scenario);
    const cache = new MemoryAnalysisCache(100000);
    const analyze = () => analyzeImpact('HEAD', changed, sources, undefined, documents, cache);
    const cold = time(analyze);
    const coldMisses = cache.stats.misses;
    const warm = time(analyze);
    return {
      scenario,
      coldMs: cold.ms,
      warmMs: warm.ms,
      findings: cold.value.findings.length,
      evidence: cold.value.evidence.length,
      coldMisses,
      warmMisses: cache.stats.misses - coldMisses,
      identical: JSON.stringify(cold.value) === JSON.stringify(warm.value),
    };
  });
}

module.exports = { SCENARIOS, runScenarios };

if (require.main === module) {
  for (const r of runScenarios()) {
    const { name, sources, changed, openApiDocs, sqlDocs } = r.scenario;
    console.log(`${name}: ${sources} sources, ${changed} changed, ${openApiDocs + sqlDocs} documents -> ${r.findings} findings, ${r.evidence} evidence`);
    console.log(`  cold ${r.coldMs.toFixed(0)} ms (${r.coldMisses} computations) · warm ${r.warmMs.toFixed(0)} ms (${r.warmMisses} computations) · identical replay: ${r.identical}`);
  }
}
