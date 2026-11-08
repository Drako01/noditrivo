import * as path from 'node:path';
import { dedupeEvidence, EVIDENCE_SCHEMA_VERSION, type DocumentChange, type Evidence } from './evidence';
import { analyzeInfra, isInfraDocument } from './infra';
import { analyzeOpenApi, looksLikeOpenApi } from './openapi';
import { analyzeSql } from './sql';
import { isTerraformPath } from './terraform';

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'unsaved';
export type LimitationCode =
  | 'direct-imports-only'
  | 'no-dynamic-or-external'
  | 'no-runtime-claim'
  | 'scan-truncated'
  | 'files-skipped'
  | 'openapi-static-comparison'
  | 'sql-static-parse'
  | 'infra-static-analysis';

export interface ChangedFile {
  readonly path: string;
  readonly status: ChangeStatus;
  /** Previous path; only set for renames. Importers of the old path are affected too. */
  readonly oldPath?: string;
}
export interface ScanCoverage {
  readonly scannedFiles: number;
  readonly skippedLarge: number;
  readonly skippedUnreadable: number;
  readonly truncated: boolean;
}
export interface ImpactFinding {
  readonly changedFile: string;
  readonly changeStatus: ChangeStatus;
  readonly affectedFile: string;
  readonly kind: 'direct-import';
  /** The import specifier found verbatim in `affectedFile`. */
  readonly specifier: string;
  readonly confidence: 'high';
}
export interface ImpactReport {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly baseline: string;
  readonly changedFiles: readonly ChangedFile[];
  readonly findings: readonly ImpactFinding[];
  /** Contract and database evidence, deduplicated and ordered by severity. */
  readonly evidence: readonly Evidence[];
  readonly coverage: ScanCoverage;
  readonly limitations: readonly LimitationCode[];
}

export const EMPTY_COVERAGE: ScanCoverage = { scannedFiles: 0, skippedLarge: 0, skippedUnreadable: 0, truncated: false };

const SOURCE_EXTENSION = /\.(?:tsx?|jsx?|mjs|cjs)$/;
/** Files that may hold a contract or a migration; the extension host reads their baseline content. */
export const CONTRACT_FILE = /\.(?:ya?ml|json)$/i;
export const SQL_FILE = /\.sql$/i;
/** Changed files whose baseline and current text the extension host must read for the document analyzers. */
export const isAnalyzableDocument = (file: string): boolean => CONTRACT_FILE.test(file) || SQL_FILE.test(file) || isTerraformPath(file);

export function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

const stripSourceExtension = (value: string): string => value.replace(SOURCE_EXTENSION, '');

export function extractLocalImports(content: string): string[] {
  const paths = new Set<string>();
  const re = /(?:\bfrom\s*|\bimport\s*\(|\bimport\s+|\brequire\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of content.matchAll(re)) {
    if (match[1].startsWith('.')) paths.add(match[1]);
  }
  return [...paths];
}

export function resolveLocalImport(importer: string, specifier: string): string {
  return normalizeRelative(path.posix.normalize(path.posix.join(path.posix.dirname(normalizeRelative(importer)), specifier)));
}

/** Paths whose importers are affected by this change (a rename affects both names). */
export function affectedPaths(file: ChangedFile): string[] {
  return file.oldPath ? [file.path, file.oldPath] : [file.path];
}

/**
 * Matches a resolved import target against a changed file, tolerating
 * explicit extensions (`./a.js` for `a.ts`) and directory imports (`./dir` for `dir/index.ts`).
 */
export function isImportOfChangedFile(target: string, changed: string): boolean {
  const name = stripSourceExtension(normalizeRelative(changed));
  const bare = stripSourceExtension(target);
  return bare === name || name === bare + '/index';
}

export function analyzeImpact(
  baseline: string,
  changedFiles: readonly ChangedFile[],
  sources: ReadonlyMap<string, string>,
  coverage: ScanCoverage = EMPTY_COVERAGE,
  documents: readonly DocumentChange[] = [],
): ImpactReport {
  const byPath = new Map<string, ChangedFile>();
  for (const file of changedFiles) {
    const normalized: ChangedFile = { ...file, path: normalizeRelative(file.path), ...(file.oldPath ? { oldPath: normalizeRelative(file.oldPath) } : {}) };
    byPath.set(normalized.path, normalized);
  }
  const changed = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));

  const findings: ImpactFinding[] = [];
  for (const [rawFile, content] of sources) {
    const file = normalizeRelative(rawFile);
    for (const specifier of extractLocalImports(content)) {
      const target = resolveLocalImport(file, specifier);
      for (const change of changed) {
        for (const candidate of affectedPaths(change)) {
          if (file === candidate) continue;
          if (isImportOfChangedFile(target, candidate)) {
            findings.push({ changedFile: candidate, changeStatus: change.status, affectedFile: file, kind: 'direct-import', specifier, confidence: 'high' });
          }
        }
      }
    }
  }
  findings.sort((a, b) => a.affectedFile.localeCompare(b.affectedFile) || a.changedFile.localeCompare(b.changedFile) || a.specifier.localeCompare(b.specifier));

  const limitations: LimitationCode[] = ['direct-imports-only', 'no-dynamic-or-external', 'no-runtime-claim'];
  if (coverage.truncated) limitations.push('scan-truncated');
  if (coverage.skippedLarge + coverage.skippedUnreadable > 0) limitations.push('files-skipped');

  const openApi = documents.flatMap(analyzeOpenApi);
  const sql = documents.filter(document => SQL_FILE.test(document.path)).flatMap(analyzeSql);
  if (documents.some(document => [document.before, document.after].some(text => text !== undefined && looksLikeOpenApi(text)))) {
    limitations.push('openapi-static-comparison');
  }
  if (documents.some(document => SQL_FILE.test(document.path))) limitations.push('sql-static-parse');
  if (documents.some(isInfraDocument)) limitations.push('infra-static-analysis');

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    baseline,
    changedFiles: changed,
    findings,
    evidence: dedupeEvidence([...openApi, ...sql, ...analyzeInfra(documents)]),
    coverage,
    limitations,
  };
}
