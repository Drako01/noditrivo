const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {analyzeOpenApi} = require('../dist/core/openapi.js');
const {analyzeSql,splitStatements,detectDialect,isMigrationPath} = require('../dist/core/sql.js');
const {createEvidence,dedupeEvidence,EVIDENCE_SCHEMA_VERSION,RULE_IDS} = require('../dist/core/evidence.js');
const {analyzeImpact} = require('../dist/core/impact.js');
const {translate} = require('../dist/i18n.js');
const {renderControlCenter} = require('../dist/ui/controlCenter.js');

const FIXTURES = path.join(__dirname,'fixtures');
const readFixtures = dir => fs.readdirSync(path.join(FIXTURES,dir)).sort().map(name => ({name,text:fs.readFileSync(path.join(FIXTURES,dir,name),'utf8')}));
const parseHeader = (name,text) => {
  const match = /^(?:#|\/\/|--) expect: (.+)$/m.exec(text);
  assert.ok(match,`fixture ${name} must declare "expect:"`);
  const body = text.slice(text.indexOf('\n') + 1);
  return {expected:match[1].trim() === 'none' ? [] : match[1].trim().split(/\s+/).sort(),body};
};
const runOpenApi = ({name,text}) => {
  const {expected,body} = parseHeader(name,text);
  const [before,after,...extra] = body.split(/^---\s*$/m);
  assert.equal(extra.length,0,`${name} must have exactly two documents`);
  return {name,expected,actual:analyzeOpenApi({path:name,status:'modified',before,after}).map(e => e.rule).sort()};
};
const runSql = ({name,text}) => {
  const {expected} = parseHeader(name,text);
  return {name,expected,actual:analyzeSql({path:`db/migrations/${name}`,status:'added',after:text}).map(e => e.rule).sort()};
};

/** Compares multisets of rules and returns true/false positive and false negative counts. */
function score(results) {
  let truePositives = 0, falsePositives = 0, falseNegatives = 0, negativesWithEvidence = 0, negatives = 0;
  for (const {expected,actual} of results) {
    const remaining = [...expected];
    for (const rule of actual) {
      const index = remaining.indexOf(rule);
      if (index >= 0) { remaining.splice(index,1); truePositives++; } else falsePositives++;
    }
    falseNegatives += remaining.length;
    if (expected.length === 0) { negatives++; if (actual.length > 0) negativesWithEvidence++; }
  }
  const produced = truePositives + falsePositives;
  return {
    truePositives,falsePositives,falseNegatives,negatives,negativesWithEvidence,
    falsePositiveRate: produced ? falsePositives / produced : 0,
    recall: truePositives + falseNegatives ? truePositives / (truePositives + falseNegatives) : 1,
  };
}

// Release gates for the fixture corpora. Any regression must be fixed in the analyzer, not by loosening these.
const MAX_FALSE_POSITIVE_RATE = 0;
const MIN_RECALL = 1;

for (const [label,dir,run] of [['OpenAPI','openapi',runOpenApi],['SQL','sql',runSql]]) {
  test(`${label} fixtures: every case yields exactly the expected rules`, t => {
    const results = readFixtures(dir).map(run);
    for (const {name,expected,actual} of results) assert.deepEqual(actual,expected,name);
    const metrics = score(results);
    t.diagnostic(`${label}: ${results.length} fixtures · ${JSON.stringify(metrics)}`);
    assert.ok(metrics.negatives >= 5,'the corpus needs negative fixtures');
    assert.ok(metrics.falsePositiveRate <= MAX_FALSE_POSITIVE_RATE,`false positive rate ${metrics.falsePositiveRate}`);
    assert.ok(metrics.recall >= MIN_RECALL,`recall ${metrics.recall}`);
    assert.equal(metrics.negativesWithEvidence,0);
  });
}

test('every rule id has English and Spanish copy', () => {
  for (const rule of RULE_IDS) for (const locale of ['en','es']) assert.ok(translate(locale,`rule.${rule}`).length > 0,`${locale}:${rule}`);
});

test('evidence ids are stable and identical findings are deduplicated', () => {
  const draft = {analyzer:'sql',rule:'sql.drop-table',severity:'breaking',confidence:'high',file:'a.sql',subject:'t',location:'statement[1]'};
  const a = createEvidence(draft), b = createEvidence({...draft});
  assert.equal(a.id,b.id);
  assert.equal(a.schemaVersion,EVIDENCE_SCHEMA_VERSION);
  assert.notEqual(a.id,createEvidence({...draft,location:'statement[2]'}).id);
  const info = createEvidence({...draft,rule:'sql.drop-index',severity:'info',location:'statement[0]'});
  assert.deepEqual(dedupeEvidence([info,a,b]).map(e => e.id),[a.id,info.id]);
});

test('deleting an OpenAPI document and unrelated files', () => {
  const spec = 'openapi: 3.0.3\npaths: {}\n';
  assert.deepEqual(analyzeOpenApi({path:'api.yaml',status:'deleted',before:spec}).map(e => e.rule),['openapi.document-removed']);
  assert.deepEqual(analyzeOpenApi({path:'api.yaml',status:'untracked',after:spec}),[]);
  assert.deepEqual(analyzeOpenApi({path:'package.json',status:'modified',before:'{"name":"x"}',after:'{"name":"y"}'}),[]);
});

test('SQL splitting ignores comments, literals and dollar-quoted bodies', () => {
  const sql = "SELECT 'a;b'; -- c;\n/* d; */ SELECT $x$ e; $x$; SELECT \"f;g\";";
  assert.deepEqual(splitStatements(sql,'postgresql').map(s => s.text),["SELECT '?'","SELECT '?'",'SELECT "f;g"']);
  assert.equal(detectDialect('SELECT `a` FROM t'),'mysql');
  assert.equal(detectDialect('SELECT a::int'),'postgresql');
  assert.equal(detectDialect('SELECT 1'),'generic');
});

test('editing an applied migration is flagged, and only new statements of a modified file are analyzed', () => {
  assert.ok(isMigrationPath('db/migrations/001_init.sql'));
  assert.ok(!isMigrationPath('scripts/seed.sql'));
  const before = 'DROP TABLE old_one;\nCREATE TABLE a (id int);';
  const after = 'DROP TABLE old_one;\nCREATE TABLE a (id int);\nDROP TABLE newly_added;';
  const rules = analyzeSql({path:'db/migrations/001.sql',status:'modified',before,after});
  assert.deepEqual(rules.map(e => [e.rule,e.subject]).sort(),[['sql.drop-table','newly_added'],['sql.migration-edited','db/migrations/001.sql']]);
  assert.deepEqual(analyzeSql({path:'db/migrations/001.sql',status:'deleted',before}).map(e => e.rule),['sql.migration-edited']);
  assert.deepEqual(analyzeSql({path:'scripts/seed.sql',status:'modified',before,after}).map(e => e.subject),['newly_added']);
});

test('evidence carries its file, location and versioned schema', () => {
  const [item] = analyzeSql({path:'db/migrations/002.sql',status:'added',after:'SELECT 1;\nDROP TABLE users;'});
  assert.equal(item.file,'db/migrations/002.sql');
  assert.equal(item.location,'statement[2]');
  assert.equal(item.subject,'users');
  assert.equal(item.schemaVersion,1);
});

test('impact report aggregates evidence, adds scope limitations and renders in the UI', () => {
  const documents = [
    {path:'api.yaml',status:'modified',before:'openapi: 3.0.3\npaths:\n  /a: {get: {responses: {"200": {description: ok}}}}\n',after:'openapi: 3.0.3\npaths: {}\n'},
    {path:'db/migrations/003.sql',status:'added',after:'DROP TABLE "<users>";'},
  ];
  const report = analyzeImpact('HEAD',[{path:'api.yaml',status:'modified'}],new Map(),undefined,documents);
  assert.equal(report.schemaVersion,1);
  assert.deepEqual(report.evidence.map(e => e.rule),['openapi.path-removed','sql.drop-table']);
  assert.ok(report.limitations.includes('openapi-static-comparison'));
  assert.ok(report.limitations.includes('sql-static-parse'));
  const html = renderControlCenter({baseline:'HEAD',phase:'done',report},'es','n');
  assert.ok(html.includes('Ruta eliminada'));
  assert.ok(html.includes('db/migrations/003.sql · statement[1]'));
  assert.ok(html.includes('&lt;users&gt;') && !html.includes('<users>'));
  assert.ok(!analyzeImpact('HEAD',[],new Map()).limitations.includes('sql-static-parse'));
});
