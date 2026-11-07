const test = require('node:test');
const assert = require('node:assert/strict');
const {analyzeImpact,extractLocalImports,resolveLocalImport} = require('../dist/core/impact.js');

test('extracts only relative module imports', () => {
  assert.deepEqual(extractLocalImports("import x from './a'; const y = require('../b'); import 'react';"), ['./a','../b']);
});
test('normalizes import paths', () => {
  assert.equal(resolveLocalImport('src/views/list.ts','../models/user'),'src/models/user');
});
test('detects direct import evidence with deterministic findings', () => {
  const report=analyzeImpact('HEAD',['src/models/user.ts'], new Map([['src/views/list.ts',"import {User} from '../models/user';"]]));
  assert.equal(report.findings.length,1);
  assert.equal(report.findings[0].confidence,'high');
  assert.equal(report.findings[0].affectedFile,'src/views/list.ts');
});
test('does not assert unknown dependencies', () => {
  const report=analyzeImpact('main',['src/models/user.ts'],new Map([['src/a.ts',"import x from 'other';"]]));
  assert.equal(report.findings.length,0);
  assert.ok(report.limitations.some(x=>x.includes('database')));
});
