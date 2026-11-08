const test = require('node:test');
const assert = require('node:assert/strict');
const {analyzeImpact,extractLocalImports,resolveLocalImport,isImportOfChangedFile} = require('../dist/core/impact.js');

const modified = (path) => ({path, status: 'modified'});

test('extracts only relative module imports', () => {
  assert.deepEqual(extractLocalImports("import x from './a'; const y = require('../b'); import 'react';"), ['./a','../b']);
});
test('extracts side-effect imports', () => {
  assert.deepEqual(extractLocalImports("import './setup'; import \"./x\";"), ['./setup','./x']);
});
test('normalizes import paths', () => {
  assert.equal(resolveLocalImport('src/views/list.ts','../models/user'),'src/models/user');
});
test('detects direct import evidence with deterministic findings', () => {
  const report=analyzeImpact('HEAD',[modified('src/models/user.ts')], new Map([['src/views/list.ts',"import {User} from '../models/user';"]]));
  assert.equal(report.findings.length,1);
  assert.equal(report.findings[0].confidence,'high');
  assert.equal(report.findings[0].affectedFile,'src/views/list.ts');
  assert.equal(report.findings[0].specifier,'../models/user');
  assert.equal(report.findings[0].changeStatus,'modified');
});
test('does not assert unknown dependencies', () => {
  const report=analyzeImpact('main',[modified('src/models/user.ts')],new Map([['src/a.ts',"import x from 'other';"]]));
  assert.equal(report.findings.length,0);
  assert.ok(report.limitations.includes('no-dynamic-or-external'));
});
test('matches explicit extensions and directory imports', () => {
  assert.ok(isImportOfChangedFile('src/a.js','src/a.ts'));
  assert.ok(isImportOfChangedFile('src/dir','src/dir/index.ts'));
  assert.ok(isImportOfChangedFile('src/dir/index','src/dir/index.ts'));
  assert.ok(!isImportOfChangedFile('src/dir/index','src/dir.ts'));
  assert.ok(!isImportOfChangedFile('src/ab','src/a.ts'));
});
test('a rename affects importers of both old and new paths', () => {
  const sources = new Map([
    ['src/old-user.ts', ''],
    ['src/x.ts', "import a from './old';"],
    ['src/y.ts', "import b from './new';"],
  ]);
  const report=analyzeImpact('HEAD',[{path:'src/new.ts',status:'renamed',oldPath:'src/old.ts'}],sources);
  assert.deepEqual(report.findings.map(f=>[f.affectedFile,f.changedFile]),[['src/x.ts','src/old.ts'],['src/y.ts','src/new.ts']]);
});
test('deleted and untracked files are reported with their status', () => {
  const sources = new Map([['src/a.ts',"import './gone'; import './fresh';"]]);
  const report=analyzeImpact('HEAD',[{path:'src/gone.ts',status:'deleted'},{path:'src/fresh.ts',status:'untracked'}],sources);
  assert.deepEqual(report.findings.map(f=>f.changeStatus).sort(),['deleted','untracked']);
});
test('a changed file is never its own importer', () => {
  const report=analyzeImpact('HEAD',[modified('src/a.ts')],new Map([['src/a.ts',"import './a';"]]));
  assert.equal(report.findings.length,0);
});
test('coverage gaps surface as limitations', () => {
  const report=analyzeImpact('HEAD',[],new Map(),{scannedFiles:1,skippedLarge:1,skippedUnreadable:0,truncated:true});
  assert.ok(report.limitations.includes('scan-truncated'));
  assert.ok(report.limitations.includes('files-skipped'));
});
