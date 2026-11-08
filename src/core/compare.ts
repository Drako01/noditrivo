import type { Evidence } from './evidence';
import type { ImpactFinding, ImpactReport } from './impact';

/** Items split by how they relate to the previous analysis. */
export interface Delta<T> {
  /** Present now, absent before. */
  readonly added: readonly T[];
  /** Present in both analyses. */
  readonly existing: readonly T[];
  /** Present before, absent now. */
  readonly resolved: readonly T[];
}

export interface BaselineComparison {
  /** Git baseline both analyses used. */
  readonly baseline: string;
  readonly evidence: Delta<Evidence>;
  readonly findings: Delta<ImpactFinding>;
}

/** Identity of a direct-import finding across runs; the change status is not part of it. */
export const findingKey = (finding: ImpactFinding): string => [finding.changedFile, finding.affectedFile, finding.specifier].join('\0');

/** `added` and `existing` keep the order of `current`, `resolved` the order of `previous`. */
export function diffByKey<T>(previous: readonly T[], current: readonly T[], keyOf: (item: T) => string): Delta<T> {
  const before = new Set(previous.map(keyOf));
  const now = new Set(current.map(keyOf));
  return {
    added: current.filter(item => !before.has(keyOf(item))),
    existing: current.filter(item => before.has(keyOf(item))),
    resolved: previous.filter(item => !now.has(keyOf(item))),
  };
}

/**
 * Compares two reports of the same baseline. Evidence is matched by its content-hash id, which includes
 * the location: a statement that moves inside a file therefore shows up as one resolved and one new item.
 */
export function compareReports(previous: ImpactReport, current: ImpactReport): BaselineComparison {
  return {
    baseline: current.baseline,
    evidence: diffByKey(previous.evidence, current.evidence, item => item.id),
    findings: diffByKey(previous.findings, current.findings, findingKey),
  };
}

/**
 * Remembers the latest report per scope (for example workspace folder + Git baseline) so each new
 * analysis can be compared with the previous one. In memory only: nothing is persisted or sent anywhere.
 */
export class ReportHistory {
  private readonly latest = new Map<string, ImpactReport>();

  constructor(private readonly maxScopes = 20) {
    if (!Number.isInteger(maxScopes) || maxScopes < 1) throw new RangeError('maxScopes must be a positive integer.');
  }

  /** Stores `report` as the latest of `scope` and returns how it differs from the previous one, if any. */
  record(scope: string, report: ImpactReport): BaselineComparison | undefined {
    const previous = this.latest.get(scope);
    this.latest.delete(scope);
    this.latest.set(scope, report);
    while (this.latest.size > this.maxScopes) {
      const oldest = this.latest.keys().next();
      if (oldest.done) break;
      this.latest.delete(oldest.value);
    }
    return previous ? compareReports(previous, report) : undefined;
  }
}
