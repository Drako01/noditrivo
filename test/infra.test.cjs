const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {analyzeInfra,isInfraDocument} = require('../dist/core/infra.js');
const {analyzeTerraform} = require('../dist/core/terraform.js');
const {analyzeKubernetes} = require('../dist/core/kubernetes.js');
const {analyzeCompose,isComposePath} = require('../dist/core/compose.js');
const {isSecretName,isLiteralValue} = require('../dist/core/secrets.js');
const {analyzeImpact,isAnalyzableDocument} = require('../dist/core/impact.js');
const {renderControlCenter} = require('../dist/ui/controlCenter.js');

const DIR = path.join(__dirname,'fixtures','infra');
const SOURCE_DIR = path.join(__dirname,'..','src','core');

/** Fixture layout: first line `expect:`, then baseline `@@@@` current (a single part is an added file). */
function runFixture(name) {
  const text = fs.readFileSync(path.join(DIR,name),'utf8');
  const header = /^(?:#|\/\/) expect: (.+)$/m.exec(text);
  assert.ok(header,`fixture ${name} must declare "expect:"`);
  const parts = text.slice(text.indexOf('\n') + 1).split(/^@@@@\s*$/m);
  assert.ok(parts.length <= 2,`${name} must have at most two parts`);
  const [before,after] = parts.length === 2 ? parts : [undefined,parts[0]];
  const file = name.endsWith('.compose.yaml') ? 'docker-compose.yml' : name;
  const expected = header[1].trim() === 'none' ? [] : header[1].trim().split(/\s+/).sort();
  const actual = analyzeInfra([{path:file,status:before === undefined ? 'added' : 'modified',before,after}]).map(e => e.rule).sort();
  return {name,expected,actual};
}

test('infrastructure fixtures: every case yields exactly the expected rules', t => {
  const results = fs.readdirSync(DIR).sort().map(runFixture);
  for (const {name,expected,actual} of results) assert.deepEqual(actual,expected,name);
  const negatives = results.filter(r => r.expected.length === 0);
  const positives = results.length - negatives.length;
  const falsePositives = negatives.reduce((sum,r) => sum + r.actual.length,0);
  t.diagnostic(`infra: ${results.length} fixtures (${positives} positive, ${negatives.length} negative) · false positives on negatives: ${falsePositives}`);
  assert.ok(negatives.length >= 15,'the corpus needs negative fixtures');
  assert.equal(falsePositives,0);
  for (const prefix of ['compose','k8s','tf']) assert.ok(results.some(r => r.name.includes(`-${prefix}-`) && r.expected.length > 0),`${prefix} needs positive cases`);
});

test('every infrastructure rule is exercised by at least one fixture or unit test', () => {
  const {RULE_IDS} = require('../dist/core/evidence.js');
  const covered = new Set(fs.readdirSync(DIR).flatMap(name => runFixture(name).expected));
  // Rules covered by the dedicated tests below.
  for (const rule of ['compose.document-unparseable','kubernetes.document-unparseable','terraform.document-unparseable']) covered.add(rule);
  const missing = RULE_IDS.filter(rule => /^(?:compose|kubernetes|terraform)\./.test(rule) && !covered.has(rule));
  assert.deepEqual(missing,[]);
});

test('unparseable infrastructure files are reported, not guessed', () => {
  assert.deepEqual(analyzeCompose([{path:'compose.yaml',status:'modified',before:'services: [',after:'services: {}'}]).map(e => e.rule),['compose.document-unparseable']);
  assert.deepEqual(analyzeKubernetes([{path:'k.yaml',status:'modified',before:'apiVersion: v1\nkind: Service\n{{- if .Values.enabled }}\nmetadata:\n  name: a\n{{- end }}\n',after:'apiVersion: v1\nkind: Service\nmetadata: {name: a}\n'}]).map(e => e.rule),['kubernetes.document-unparseable']);
  assert.deepEqual(analyzeTerraform([{path:'main.tf',status:'modified',before:'resource "a" "b" {',after:'resource "a" "b" {}'}]).map(e => e.rule),['terraform.document-unparseable']);
});

test('moving a Kubernetes resource or a Terraform resource between changed files is not a removal', () => {
  const manifest = kind => `apiVersion: v1\nkind: ${kind}\nmetadata:\n  name: x\n`;
  assert.deepEqual(analyzeKubernetes([
    {path:'a.yaml',status:'modified',before:manifest('ConfigMap'),after:manifest('Service')},
    {path:'b.yaml',status:'added',after:manifest('ConfigMap')},
  ]).map(e => e.rule),[]);
  const bucket = 'resource "aws_s3_bucket" "logs" {\n  bucket = "l"\n}\n';
  assert.deepEqual(analyzeTerraform([
    {path:'infra/a.tf',status:'modified',before:bucket,after:'# moved\n'},
    {path:'infra/b.tf',status:'added',after:bucket},
  ]).map(e => e.rule),[]);
  assert.deepEqual(analyzeTerraform([
    {path:'infra/a.tf',status:'modified',before:bucket,after:'# moved\n'},
    {path:'other/b.tf',status:'added',after:bucket},
  ]).map(e => e.rule),['terraform.resource-removed']);
});

test('data-bearing Kubernetes kinds are breaking when removed and Lists are expanded', () => {
  const claim = 'apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: data\n';
  const list = 'apiVersion: v1\nkind: List\nitems:\n  - apiVersion: v1\n    kind: ConfigMap\n    metadata:\n      name: c\n';
  const [item] = analyzeKubernetes([{path:'pvc.yaml',status:'deleted',before:claim}]);
  assert.equal(item.severity,'breaking');
  assert.equal(item.subject,'PersistentVolumeClaim/data');
  assert.equal(analyzeKubernetes([{path:'list.yaml',status:'deleted',before:list}])[0].subject,'ConfigMap/c');
});

test('Terraform: new variables only count in directories that existed at the baseline', () => {
  const variable = 'variable "name" {\n  type = string\n}\n';
  assert.deepEqual(analyzeTerraform([{path:'modules/new/variables.tf',status:'added',after:variable}]),[]);
  assert.deepEqual(analyzeTerraform([
    {path:'modules/old/main.tf',status:'modified',before:'# x\n',after:'# y\n'},
    {path:'modules/old/variables.tf',status:'added',after:variable},
  ]).map(e => e.rule),['terraform.variable-added-required']);
});

test('deleting a Compose file removes its services; deleting a Terraform file removes its resources', () => {
  assert.deepEqual(analyzeCompose([{path:'docker-compose.yml',status:'deleted',before:'services:\n  web:\n    image: a\n'}]).map(e => e.rule),['compose.service-removed']);
  assert.deepEqual(analyzeTerraform([{path:'main.tf',status:'deleted',before:'resource "aws_vpc" "main" {}\n'}]).map(e => [e.rule,e.subject]),[['terraform.resource-removed','aws_vpc.main']]);
});

test('secret values never reach the evidence', () => {
  const SECRET = 'hunter2-very-secret';
  const changes = [
    {path:'docker-compose.yml',status:'added',after:`services:\n  db:\n    image: p\n    environment:\n      DB_PASSWORD: ${SECRET}\n`},
    {path:'secret.yaml',status:'added',after:`apiVersion: v1\nkind: Secret\nmetadata:\n  name: s\nstringData:\n  k: ${SECRET}\n`},
    {path:'main.tf',status:'added',after:`resource "x_y" "z" {\n  password = "${SECRET}"\n}\n`},
    {path:'plan.json',status:'added',after:JSON.stringify({format_version:'1.2',resource_changes:[{address:'x_y.z',mode:'managed',change:{actions:['delete'],before:{password:SECRET}}}]})},
  ];
  const evidence = analyzeInfra(changes);
  assert.deepEqual(evidence.map(e => e.rule).sort(),['compose.inline-secret','kubernetes.secret-in-manifest','terraform.plan-delete','terraform.sensitive-literal']);
  assert.ok(!JSON.stringify(evidence).includes(SECRET));
});

test('secret heuristics', () => {
  for (const name of ['DB_PASSWORD','password','api_key','AWS_SECRET_ACCESS_KEY','master_password','JWT_SECRET']) assert.ok(isSecretName(name),name);
  for (const name of ['POSTGRES_PASSWORD_FILE','secret_arn','TOKEN_TTL','password_length','user_name','keyboard']) assert.ok(!isSecretName(name),name);
  assert.ok(isLiteralValue('changeme'));
  assert.ok(!isLiteralValue('${VAR}') && !isLiteralValue('') && !isLiteralValue('{{ .Values.pw }}'));
});

test('infrastructure analyzers are pure: no process, network or filesystem access', () => {
  const forbidden = /from ['"](?:node:)?(?:child_process|net|http|https|dns|fs|dgram|tls|worker_threads)['"]|\bfetch\(|\bprocess\./;
  for (const name of ['compose','kubernetes','terraform','infra','secrets']) {
    assert.ok(!forbidden.test(fs.readFileSync(path.join(SOURCE_DIR,`${name}.ts`),'utf8')),`${name}.ts must stay free of I/O`);
  }
});

test('document classification and the impact report include infrastructure evidence', () => {
  assert.ok(isComposePath('deploy/docker-compose.prod.yml') && isComposePath('compose.yaml') && !isComposePath('src/compose.ts'));
  assert.ok(isAnalyzableDocument('infra/main.tf') && isAnalyzableDocument('k8s/app.yaml') && !isAnalyzableDocument('src/app.ts'));
  assert.ok(isInfraDocument({path:'k8s/app.yaml',status:'modified',after:'apiVersion: v1\nkind: Service\n'}));
  assert.ok(!isInfraDocument({path:'ci.yaml',status:'modified',after:'name: ci\n'}));
  const documents = [{path:'main.tf',status:'modified',before:'resource "aws_vpc" "main" {}\n',after:'# gone <b>\n'}];
  const report = analyzeImpact('HEAD',[{path:'main.tf',status:'modified'}],new Map(),undefined,documents);
  assert.deepEqual(report.evidence.map(e => e.rule),['terraform.resource-removed']);
  assert.ok(report.limitations.includes('infra-static-analysis'));
  assert.ok(!analyzeImpact('HEAD',[],new Map()).limitations.includes('infra-static-analysis'));
  for (const locale of ['en','es']) {
    const html = renderControlCenter({baseline:'HEAD',phase:'done',report},locale,'n');
    assert.ok(html.includes('main.tf · block[aws_vpc.main]'));
    assert.ok(html.toLowerCase().includes('terraform'));
  }
});
