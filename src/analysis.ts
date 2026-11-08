import * as vscode from 'vscode';
import * as path from 'node:path';
import { NO_CACHE, type AnalysisCache } from './core/cache';
import type { DocumentChange } from './core/evidence';
import { getChangedFiles, readFileAtBaseline } from './core/git';
import { analyzeImpact, isAnalyzableDocument, type ChangedFile, type ImpactReport } from './core/impact';
import type { MessageKey, MessageParams } from './i18n';

/** Hard bounds that keep the analysis predictable on large repositories. */
export const LIMITS = {
  maxSourceFiles: 3000,
  maxFileBytes: 1024 * 1024,
  maxChangedFiles: 5000,
  readBatchSize: 50,
} as const;

const SOURCE_GLOB = '**/*.{js,jsx,ts,tsx,mjs,cjs}';
type ReadResult = { readonly kind: 'ok'; readonly text: string } | { readonly kind: 'large' } | { readonly kind: 'unreadable' };
const EXCLUDE_GLOB = '**/{node_modules,dist,build,.next,coverage}/**';

/** An expected failure whose message is localized by the UI layer. */
export class AnalysisError extends Error {
  constructor(readonly key: MessageKey, readonly params: MessageParams = {}) {
    super(key);
    this.name = 'AnalysisError';
  }
}

export function isCancelled(error: unknown): boolean {
  return error instanceof vscode.CancellationError || (error instanceof Error && error.name === 'AbortError');
}

/** Path relative to the workspace folder, or undefined when outside its boundary. */
function toRootRelative(root: vscode.WorkspaceFolder, fsPath: string): string | undefined {
  const rel = path.relative(root.uri.fsPath, fsPath);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return undefined;
  return rel.replace(/\\/g, '/');
}

function collectUnsaved(root: vscode.WorkspaceFolder): Map<string, vscode.TextDocument> {
  const unsaved = new Map<string, vscode.TextDocument>();
  for (const doc of vscode.workspace.textDocuments) {
    if (!doc.isDirty || doc.uri.scheme !== 'file') continue;
    const rel = toRootRelative(root, doc.uri.fsPath);
    if (rel) unsaved.set(rel, doc);
  }
  return unsaved;
}

export async function runAnalysis(root: vscode.WorkspaceFolder, baseline: string, token: vscode.CancellationToken, cache: AnalysisCache = NO_CACHE): Promise<ImpactReport> {
  const abort = new AbortController();
  const subscription = token.onCancellationRequested(() => abort.abort());
  try {
    const tracked = await getChangedFiles(root.uri.fsPath, baseline, abort.signal);
    const unsaved = collectUnsaved(root);
    const known = new Set(tracked.map(file => file.path));
    const changed: ChangedFile[] = [
      ...tracked,
      ...[...unsaved.keys()].filter(rel => !known.has(rel)).map(rel => ({ path: rel, status: 'unsaved' as const })),
    ];
    if (changed.length > LIMITS.maxChangedFiles) {
      throw new AnalysisError('error.tooManyChanges', { count: changed.length, max: LIMITS.maxChangedFiles });
    }

    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(root, SOURCE_GLOB), EXCLUDE_GLOB, LIMITS.maxSourceFiles + 1, token);
    const truncated = found.length > LIMITS.maxSourceFiles;
    const files = found.slice(0, LIMITS.maxSourceFiles);

    const sources = new Map<string, string>();
    let skippedLarge = 0;
    let skippedUnreadable = 0;
    const decoder = new TextDecoder('utf-8');

    /** Current text of a workspace file: the unsaved editor buffer when dirty, otherwise the file on disk. */
    const readCurrent = async (rel: string): Promise<ReadResult> => {
      const buffer = unsaved.get(rel);
      if (buffer) {
        const text = buffer.getText();
        return text.length > LIMITS.maxFileBytes ? { kind: 'large' } : { kind: 'ok', text };
      }
      try {
        const uri = vscode.Uri.joinPath(root.uri, rel);
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > LIMITS.maxFileBytes) return { kind: 'large' };
        return { kind: 'ok', text: decoder.decode(await vscode.workspace.fs.readFile(uri)) };
      } catch {
        // Unreadable files cannot constitute verified evidence; they are counted and reported.
        return { kind: 'unreadable' };
      }
    };
    const count = (result: ReadResult): void => {
      if (result.kind === 'large') skippedLarge++;
      else if (result.kind === 'unreadable') skippedUnreadable++;
    };

    const readSource = async (uri: vscode.Uri): Promise<void> => {
      const rel = toRootRelative(root, uri.fsPath);
      if (!rel) return;
      const result = await readCurrent(rel);
      if (result.kind === 'ok') sources.set(rel, result.text);
      else count(result);
    };

    const readDocument = async (file: ChangedFile): Promise<DocumentChange | undefined> => {
      const hadBaseline = file.status !== 'added' && file.status !== 'untracked' && file.status !== 'copied';
      const before = hadBaseline ? await readFileAtBaseline(root.uri.fsPath, baseline, file.oldPath ?? file.path, abort.signal) : undefined;
      if (before !== undefined && before.length > LIMITS.maxFileBytes) {
        skippedLarge++;
        return undefined;
      }
      if (file.status === 'deleted') return { path: file.path, status: file.status, before };
      const current = await readCurrent(file.path);
      if (current.kind !== 'ok') {
        count(current);
        return undefined;
      }
      return { path: file.path, status: file.status, before, after: current.text };
    };

    const inBatches = async <T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> => {
      for (let i = 0; i < items.length; i += LIMITS.readBatchSize) {
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        await Promise.all(items.slice(i, i + LIMITS.readBatchSize).map(work));
      }
    };

    await inBatches(files, readSource);

    const documents: DocumentChange[] = [];
    await inBatches(changed.filter(file => isAnalyzableDocument(file.path)), async file => {
      const document = await readDocument(file);
      if (document) documents.push(document);
    });

    return analyzeImpact(baseline, changed, sources, { scannedFiles: sources.size, skippedLarge, skippedUnreadable, truncated }, documents, cache);
  } finally {
    subscription.dispose();
  }
}
