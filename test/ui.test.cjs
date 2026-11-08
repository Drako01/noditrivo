const test = require('node:test');
const assert = require('node:assert/strict');
const {resolveLocale,translate} = require('../dist/i18n.js');
const {renderControlCenter,escapeHtml,MAX_LISTED_ITEMS} = require('../dist/ui/controlCenter.js');
const {analyzeImpact} = require('../dist/core/impact.js');

const report = analyzeImpact('HEAD',[{path:'src/<b>.ts',status:'modified'}],new Map([['src/a.ts',"import x from './<b>';"]]));

test('resolves locale from the editor language', () => {
  assert.equal(resolveLocale('es'),'es');
  assert.equal(resolveLocale('es-AR'),'es');
  assert.equal(resolveLocale('en-US'),'en');
  assert.equal(resolveLocale('fr'),'en');
});
test('translates with parameters and fails on missing ones', () => {
  assert.equal(translate('en','findings.item',{affected:'a',changed:'b'}),'a imports b');
  assert.equal(translate('es','findings.item',{affected:'a',changed:'b'}),'a importa b');
  assert.throws(()=>translate('en','findings.item',{affected:'a'}),/Missing i18n parameter/);
});
test('renders a strict CSP with a per-render nonce and no inline-unsafe', () => {
  const html = renderControlCenter({baseline:'HEAD',phase:'idle'},'en','NONCE123');
  assert.match(html,/script-src 'nonce-NONCE123'/);
  assert.match(html,/style-src 'nonce-NONCE123'/);
  assert.ok(!html.includes('unsafe-inline'));
  assert.match(html,/<label for="baseline">/);
  assert.match(html,/role="status"/);
});
test('escapes untrusted paths exactly once', () => {
  const html = renderControlCenter({baseline:'HEAD',phase:'done',report},'en','n');
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('src/&lt;b&gt;.ts'));
  assert.ok(!html.includes('&amp;lt;'));
  assert.equal(escapeHtml(`"'<>&`),'&quot;&#39;&lt;&gt;&amp;');
});
test('renders Spanish copy and lang attribute', () => {
  const html = renderControlCenter({baseline:'HEAD',phase:'done',report},'es','n');
  assert.match(html,/<html lang="es">/);
  assert.ok(html.includes('Analizar cambios'));
});
test('disables the action while running and focuses status when finished', () => {
  assert.match(renderControlCenter({baseline:'HEAD',phase:'running'},'en','n'),/<button type="submit" disabled/);
  assert.match(renderControlCenter({baseline:'HEAD',phase:'done',report},'en','n'),/data-focus="true"/);
});
test('long lists are truncated in the UI', () => {
  const many = Array.from({length:MAX_LISTED_ITEMS+5},(_,i)=>({path:`f${i}.ts`,status:'added'}));
  const html = renderControlCenter({baseline:'HEAD',phase:'done',report:analyzeImpact('HEAD',many,new Map())},'en','n');
  assert.ok(html.includes('and 5 more'));
});
