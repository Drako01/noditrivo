import * as path from 'node:path';
import { NO_CACHE, type AnalysisCache, type CacheMaterial } from './cache';
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

/** Extension-less import targets that resolve to this file: itself, and its directory when it is an `index`. */
function importKeys(changed: string): string[] {
  const name = stripSourceExtension(normalizeRelative(changed));
  return name.endsWith('/index') ? [name, name.slice(0, -'/index'.length)] : [name];
}

/**
 * Matches a resolved import target against a changed file, tolerating
 * explicit extensions (`./a.js` for `a.ts`) and directory imports (`./dir` for `dir/index.ts`).
 */
export function isImportOfChangedFile(target: string, changed: string): boolean {
  return importKeys(changed).includes(stripSourceExtension(target));
}

/** Everything an analyzer's result depends on for one document. */
const documentMaterial = (document: DocumentChange): CacheMaterial => [document.path, document.status, document.before, document.after];

export function analyzeImpact(
  baseline: string,
  changedFiles: readonly ChangedFile[],
  sources: ReadonlyMap<string, string>,
  coverage: ScanCoverage = EMPTY_COVERAGE,
  documents: readonly DocumentChange[] = [],
  cache: AnalysisCache = NO_CACHE,
): ImpactReport {
  const byPath = new Map<string, ChangedFile>();
  for (const file of changedFiles) {
    const normalized: ChangedFile = { ...file, path: normalizeRelative(file.path), ...(file.oldPath ? { oldPath: normalizeRelative(file.oldPath) } : {}) };
    byPath.set(normalized.path, normalized);
  }
  const changed = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));

  // Index changed paths by the import targets that resolve to them: one lookup per import instead of a scan of all changes.
  const changedByTarget = new Map<string, Array<{ readonly change: ChangedFile; readonly candidate: string }>>();
  for (const change of changed) {
    for (const candidate of affectedPaths(change)) {
      for (const key of importKeys(candidate)) {
        const entries = changedByTarget.get(key) ?? [];
        entries.push({ change, candidate });
        changedByTarget.set(key, entries);
      }
    }
  }

  const findings: ImpactFinding[] = [];
  for (const [rawFile, content] of sources) {
    const file = normalizeRelative(rawFile);
    for (const specifier of cache.memo('imports', [content], () => extractLocalImports(content))) {
      const target = stripSourceExtension(resolveLocalImport(file, specifier));
      for (const { change, candidate } of changedByTarget.get(target) ?? []) {
        if (file === candidate) continue;
        findings.push({ changedFile: candidate, changeStatus: change.status, affectedFile: file, kind: 'direct-import', specifier, confidence: 'high' });
      }
    }
  }
  findings.sort((a, b) => a.affectedFile.localeCompare(b.affectedFile) || a.changedFile.localeCompare(b.changedFile) || a.specifier.localeCompare(b.specifier));

  const limitations: LimitationCode[] = ['direct-imports-only', 'no-dynamic-or-external', 'no-runtime-claim'];
  if (coverage.truncated) limitations.push('scan-truncated');
  if (coverage.skippedLarge + coverage.skippedUnreadable > 0) limitations.push('files-skipped');

  // Documents arrive in read-completion order; sorting makes the result independent of it.
  const ordered = [...documents].sort((a, b) => a.path.localeCompare(b.path));
  const openApiDocuments = ordered.filter(document => [document.before, document.after].some(text => text !== undefined && looksLikeOpenApi(text)));
  const openApi = openApiDocuments.flatMap(document => cache.memo('evidence', ['openapi', ...documentMaterial(document)], () => analyzeOpenApi(document)));
  const sql = ordered
    .filter(document => SQL_FILE.test(document.path))
    .flatMap(document => cache.memo('evidence', ['sql', ...documentMaterial(document)], () => analyzeSql(document)));
  // Infrastructure analyzers relate documents to each other, so they are cached for the whole set of relevant documents.
  const infraDocuments = ordered.filter(isInfraDocument);
  const infra = cache.memo('evidence', ['infra', ...infraDocuments.flatMap(documentMaterial)], () => analyzeInfra(infraDocuments));
  if (openApiDocuments.length > 0) limitations.push('openapi-static-comparison');
  if (ordered.some(document => SQL_FILE.test(document.path))) limitations.push('sql-static-parse');
  if (infraDocuments.length > 0) limitations.push('infra-static-analysis');

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    baseline,
    changedFiles: changed,
    findings,
    evidence: dedupeEvidence([...openApi, ...sql, ...infra]),
    coverage,
    limitations,
  };
}
