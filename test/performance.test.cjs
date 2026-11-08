const test = require('node:test');
const assert = require('node:assert/strict');
const { runScenarios } = require('../scripts/benchmark.cjs');

test('performance budgets on synthetic medium and large repositories', t => {
  for (const r of runScenarios()) {
    const { name, budgetMs, sources, changed } = r.scenario;
    t.diagnostic(`${name} (${sources} sources, ${changed} changed): cold ${r.coldMs.toFixed(0)} ms, warm ${r.warmMs.toFixed(0)} ms, ${r.findings} findings, ${r.evidence} evidence`);
    assert.ok(r.findings > 0 && r.evidence > 0, `${name}: the workload must exercise the analyzers`);
    assert.ok(r.coldMs < budgetMs, `${name}: cold run took ${r.coldMs.toFixed(0)} ms, budget ${budgetMs} ms`);
    assert.ok(r.warmMs < budgetMs, `${name}: warm run took ${r.warmMs.toFixed(0)} ms, budget ${budgetMs} ms`);
    assert.equal(r.warmMisses, 0, `${name}: a warm run must not recompute anything`);
    assert.ok(r.identical, `${name}: replay must be identical`);
  }
});
