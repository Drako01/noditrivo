const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {isValidGitBaseline,parseNameStatus,parseUntracked,readFileAtBaseline} = require('../dist/core/git.js');

test('reads file content at the baseline and reports missing files as undefined', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'noditrivo-git-'));
  try {
    const git = (...args) => execFileSync('git',['-c','user.name=t','-c','user.email=t@example.com','-c','commit.gpgsign=false',...args],{cwd:dir,stdio:'pipe'});
    git('init','-q');
    fs.mkdirSync(path.join(dir,'sub'));
    fs.writeFileSync(path.join(dir,'sub','a.sql'),'SELECT 1;\n');
    git('add','.');
    git('commit','-q','-m','init');
    fs.writeFileSync(path.join(dir,'sub','a.sql'),'SELECT 2;\n');
    assert.equal(await readFileAtBaseline(path.join(dir,'sub'),'HEAD','a.sql'),'SELECT 1;\n');
    assert.equal(await readFileAtBaseline(dir,'HEAD','missing.sql'),undefined);
    await assert.rejects(readFileAtBaseline(dir,'--bad','a.sql'),/Invalid Git baseline/);
    await assert.rejects(readFileAtBaseline(dir,'no-such-ref','sub/a.sql'));
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('baseline validation rejects option-like and shell-like refs', () => {
  for (const ok of ['HEAD','main','origin/main','v1.0.0','HEAD~2']) assert.ok(isValidGitBaseline(ok), ok);
  for (const bad of ['','--output=x','-p','a b','a;b','$(x)','a`b`']) assert.ok(!isValidGitBaseline(bad), bad);
});
test('parses name-status output including renames and deletions', () => {
  const raw = ['M','src/a.ts','A','src/b.ts','D','src/c.ts','R100','src/old.ts','src/new.ts','T','src/t.ts',''].join('\0');
  assert.deepEqual(parseNameStatus(raw),[
    {path:'src/a.ts',status:'modified'},
    {path:'src/b.ts',status:'added'},
    {path:'src/c.ts',status:'deleted'},
    {path:'src/new.ts',status:'renamed',oldPath:'src/old.ts'},
    {path:'src/t.ts',status:'modified'},
  ]);
});
test('copies keep only the new path', () => {
  assert.deepEqual(parseNameStatus(['C90','src/a.ts','src/b.ts',''].join('\0')),[{path:'src/b.ts',status:'copied'}]);
});
test('fails loudly on unknown or truncated output', () => {
  assert.throws(()=>parseNameStatus(['X','a',''].join('\0')),/Unexpected Git status/);
  assert.throws(()=>parseNameStatus(['R100','a',''].join('\0')),/Malformed/);
});
test('parses untracked files with unusual names', () => {
  assert.deepEqual(parseUntracked(['a b.ts','ñ.ts',''].join('\0')),[{path:'a b.ts',status:'untracked'},{path:'ñ.ts',status:'untracked'}]);
});
