/**
 * Smoke test of a packaged VSIX: inspects its contents, unpacks it into a fresh temporary directory and
 * activates the *unpacked* extension in the simulated host against a throwaway Git repository.
 * It proves the package is self-contained (compiled code, bundled dependencies, localization, license).
 * It does not install into a real VS Code; that step is part of the manual release checklist.
 *
 * Usage: node scripts/smoke-vsix.cjs [path/to/file.vsix]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');

const REQUIRED = [
  'extension.vsixmanifest',
  '[Content_Types].xml',
  'extension/package.json',
  'extension/package.nls.json',
  'extension/package.nls.es.json',
  'extension/dist/extension.js',
  'extension/dist/analysis.js',
  'extension/dist/core/impact.js',
  'extension/dist/core/cache.js',
  'extension/node_modules/yaml/package.json',
  'extension/readme.md',
  'extension/media/brand/noditrivo-icon-256.png',
];
/** Anything matching must never ship: sources, tests, docs, tooling, maps, environment files, nested packages. */
const FORBIDDEN = [
  /^extension\/(?:src|test|docs|demo|scripts|\.github|\.git|\.vscode-test)\//,
  /\.(?:ts|map|vsix|log|env)$/i,
  /(?:^|\/)\.env/,
  /^extension\/(?:tsconfig\.json|\.gitignore|\.vscodeignore)$/,
];
const FORBIDDEN_EXCEPT = /\.d\.ts$/i;

/** Minimal ZIP reader (central directory, stored/deflate); enough for what `vsce` produces. */
function readZip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('Not a ZIP file: end of central directory not found.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP method ${method} for ${name}.`);
    entries.set(name, () => (method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw)));
  }
  return entries;
}

function check(condition, message, failures) {
  if (!condition) failures.push(message);
}

async function smokeVsix(vsixPath) {
  const failures = [];
  const entries = readZip(fs.readFileSync(vsixPath));
  const names = [...entries.keys()];

  for (const required of REQUIRED) check(entries.has(required), `missing entry: ${required}`, failures);
  for (const name of names) {
    if (FORBIDDEN.some(pattern => pattern.test(name)) && !FORBIDDEN_EXCEPT.test(name) && !name.startsWith('extension/node_modules/')) failures.push(`must not ship: ${name}`);
  }
  check(names.some(name => /^extension\/LICEN[CS]E/i.test(name)), 'missing license file', failures);
  if (failures.length) return { failures, entries: names.length };

  const manifest = JSON.parse(entries.get('extension/package.json')().toString('utf8'));
  const vsixManifest = entries.get('extension.vsixmanifest')().toString('utf8');
  check(vsixManifest.includes(`Version="${manifest.version}"`), 'vsix manifest version differs from package.json', failures);
  check(entries.has(`extension/${manifest.main.replace(/^\.\//, '')}`), `main entry ${manifest.main} is not packaged`, failures);
  check(!manifest.scripts || !/publish|deploy/i.test(Object.keys(manifest.scripts).join(' ')), 'package defines a publish/deploy script', failures);
  const secrets = names.filter(name => !name.startsWith('extension/node_modules/')).filter(name => /\.(?:pem|key|p12|pfx)$|id_rsa/i.test(name));
  check(secrets.length === 0, `credential-looking files: ${secrets.join(', ')}`, failures);

  // Unpack into a fresh, empty directory (never into the project) and run the unpacked build.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'noditrivo-vsix-'));
  const { createHost, loadExtension } = require('../test/helpers/vscodeHost.cjs');
  const { createRepo, until } = require('../test/helpers/repo.cjs');
  const repo = createRepo();
  try {
    for (const [name, read] of entries) {
      const destination = path.resolve(target, name);
      if (destination !== target && !destination.startsWith(target + path.sep)) throw new Error(`Refusing to extract outside the target: ${name}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, read());
    }
    const host = createHost({ rootPath: repo.dir });
    loadExtension(path.join(target, 'extension', manifest.main)).activate(host.context);
    check(host.commands.size === manifest.contributes.commands.length && manifest.contributes.commands.every(({ command }) => host.commands.has(command)), 'activation did not register every contributed command', failures);

    repo.write('src/b.ts', 'export const b = 2;\n');
    repo.write('openapi.yaml', 'openapi: 3.0.0\ninfo: {title: t, version: "1"}\npaths:\n  /pets:\n    get:\n      responses:\n        "200": {description: ok}\n');
    host.commands.get('noditrivo.openControlCenter')();
    host.panels[0].post({ type: 'analyze', baseline: 'HEAD' });
    await until(() => host.panels[0].renders.some(html => html.includes('data-focus="true"')), 'analysis in the unpacked extension');
    const html = host.panels[0].renders.at(-1);
    check(host.errors.length === 0, `analysis reported errors: ${host.errors.join('; ')}`, failures);
    check(html.includes('src/a.ts imports src/b.ts'), 'unpacked extension did not report the direct import', failures);
    check(html.includes('openapi.yaml'), 'unpacked extension did not report the OpenAPI evidence (is the yaml dependency bundled?)', failures);
  } finally {
    repo.remove();
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  return { failures, entries: names.length, version: manifest.version };
}

function defaultVsix() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  return path.join(ROOT, `noditrivo-${version}.vsix`);
}

module.exports = { smokeVsix, readZip, defaultVsix };

if (require.main === module) {
  const vsix = path.resolve(process.argv[2] ?? defaultVsix());
  smokeVsix(vsix).then(({ failures, entries, version }) => {
    if (failures.length) {
      console.error(`VSIX smoke test FAILED (${vsix}):\n- ${failures.join('\n- ')}`);
      process.exitCode = 1;
    } else {
      console.log(`VSIX smoke test passed: ${path.basename(vsix)} · ${entries} entries · version ${version}`);
    }
  }, error => {
    console.error(`VSIX smoke test crashed: ${error.stack ?? error}`);
    process.exitCode = 1;
  });
}
