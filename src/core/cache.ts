import { createHash } from 'node:crypto';
import { EVIDENCE_SCHEMA_VERSION, parseEvidence, type Evidence } from './evidence';

/**
 * Bumped by hand whenever an analyzer can produce different output for the same input.
 * `test/cache.test.cjs` fingerprints the analyzer sources and fails until this is bumped,
 * so a stale cache can never replay results of an older rule set.
 */
export const ANALYZER_VERSION = 1;
export const CACHE_FORMAT_VERSION = 1;
export const CACHE_SALT = `${CACHE_FORMAT_VERSION}.${EVIDENCE_SCHEMA_VERSION}.${ANALYZER_VERSION}`;

/** What each cache namespace stores. Values are JSON-serializable and must be treated as immutable. */
export interface CacheValues {
  /** Local import specifiers extracted from one source file. */
  readonly imports: readonly string[];
  /** Evidence produced by an analyzer for one input (a document or a set of documents). */
  readonly evidence: readonly Evidence[];
}
export type CacheKind = keyof CacheValues;
export type CacheMaterial = readonly (string | undefined)[];

export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
}

/** Content-addressed memoization: the key is a hash of everything the result depends on. */
export interface AnalysisCache {
  memo<K extends CacheKind>(kind: K, material: CacheMaterial, compute: () => CacheValues[K]): CacheValues[K];
}

/** Always recomputes; the default when no cache is supplied. */
export const NO_CACHE: AnalysisCache = { memo: (_kind, _material, compute) => compute() };

export interface CacheSnapshot {
  readonly salt: string;
  readonly entries: ReadonlyArray<readonly [key: string, kind: CacheKind, value: unknown]>;
}

/** Length-prefixed, so ('ab','c') and ('a','bc') never collide; `undefined` differs from the empty string. */
export function cacheKey(kind: CacheKind, material: CacheMaterial): string {
  const hash = createHash('sha256').update(CACHE_SALT).update('\0').update(kind);
  for (const part of material) {
    hash.update(part === undefined ? '\0u' : `\0s${Buffer.byteLength(part)}:`);
    if (part !== undefined) hash.update(part);
  }
  return `${kind}:${hash.digest('hex').slice(0, 32)}`;
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

/** Validates a persisted value; `undefined` means it is not trustworthy and must be recomputed. */
const REVIVERS: { readonly [K in CacheKind]: (value: unknown) => CacheValues[K] | undefined } = {
  imports: value => (isStringArray(value) ? value : undefined),
  evidence: value => {
    if (!Array.isArray(value)) return undefined;
    const parsed = value.map(parseEvidence);
    return parsed.every((item): item is Evidence => item !== undefined) ? parsed : undefined;
  },
};

/** Bounded in-memory cache with least-recently-used eviction, hit/miss counters and a validated snapshot. */
export class MemoryAnalysisCache implements AnalysisCache {
  private readonly entries = new Map<string, { readonly kind: CacheKind; readonly value: CacheValues[CacheKind] }>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxEntries = 5000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be a positive integer.');
  }

  get size(): number {
    return this.entries.size;
  }

  get stats(): CacheStats {
    return { hits: this.hits, misses: this.misses };
  }

  memo<K extends CacheKind>(kind: K, material: CacheMaterial, compute: () => CacheValues[K]): CacheValues[K] {
    const key = cacheKey(kind, material);
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      this.hits++;
      return cached.value as CacheValues[K];
    }
    this.misses++;
    const value = compute();
    this.store(key, kind, value);
    return value;
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** The most recently used entries, oldest first, ready for `JSON.stringify`. */
  snapshot(limit = this.maxEntries): CacheSnapshot {
    const all = [...this.entries];
    const recent = limit > 0 ? all.slice(-limit) : [];
    return { salt: CACHE_SALT, entries: recent.map(([key, entry]) => [key, entry.kind, entry.value] as const) };
  }

  /** Loads a snapshot from untrusted storage. Anything stale or malformed is dropped; returns the count kept. */
  restore(snapshot: unknown): number {
    if (typeof snapshot !== 'object' || snapshot === null) return 0;
    const { salt, entries } = snapshot as { salt?: unknown; entries?: unknown };
    if (salt !== CACHE_SALT || !Array.isArray(entries)) return 0;
    let restored = 0;
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 3) continue;
      const [key, kind, value] = entry as unknown[];
      if (typeof key !== 'string' || (kind !== 'imports' && kind !== 'evidence') || !key.startsWith(`${kind}:`)) continue;
      const revived = REVIVERS[kind](value);
      if (revived === undefined) continue;
      this.store(key, kind, revived);
      restored++;
    }
    return restored;
  }

  private store(key: string, kind: CacheKind, value: CacheValues[CacheKind]): void {
    this.entries.set(key, { kind, value });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
