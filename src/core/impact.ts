import * as path from 'node:path';

export interface ImpactFinding {
  readonly changedFile: string;
  readonly affectedFile: string;
  readonly kind: 'direct-import';
  readonly evidence: string;
  readonly confidence: 'high';
}
export interface ImpactReport {
  readonly baseline: string;
  readonly changedFiles: readonly string[];
  readonly findings: readonly ImpactFinding[];
  readonly limitations: readonly string[];
}

export function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function extractLocalImports(content: string): string[] {
  const paths = new Set<string>();
  const re = /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of content.matchAll(re)) {
    if (match[1].startsWith('.')) paths.add(match[1]);
  }
  return [...paths];
}

export function resolveLocalImport(importer: string, specifier: string): string {
  return normalizeRelative(path.posix.normalize(path.posix.join(path.posix.dirname(normalizeRelative(importer)), specifier)));
}

export function isImportOfChangedFile(target: string, changed: string): boolean {
  const name = normalizeRelative(changed).replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
  return target === name || target === name + '/index';
}

export function analyzeImpact(
  baseline: string,
  changedFiles: readonly string[],
  sources: ReadonlyMap<string, string>,
): ImpactReport {
  const normalized = [...new Set(changedFiles.map(normalizeRelative))].sort();
  const findings: ImpactFinding[] = [];
  for (const [file, content] of sources) {
    for (const specifier of extractLocalImports(content)) {
      const target = resolveLocalImport(file, specifier);
      for (const changed of normalized) {
        if (normalizeRelative(file) === changed) continue;
        if (isImportOfChangedFile(target, changed)) {
          findings.push({changedFile:changed,affectedFile:normalizeRelative(file),kind:'direct-import',evidence:`Import ${specifier} in ${normalizeRelative(file)}`,confidence:'high'});
        }
      }
    }
  }
  findings.sort((a,b) => a.affectedFile.localeCompare(b.affectedFile) || a.changedFile.localeCompare(b.changedFile));
  return {
    baseline,
    changedFiles: normalized,
    findings,
    limitations:[
      'Only direct relative JavaScript/TypeScript imports are traced.',
      'Dynamic references, aliases, external consumers, database and infrastructure risks are not assessed.',
      'No claim of runtime breakage or comprehensive dependency coverage is made.',
    ],
  };
}
