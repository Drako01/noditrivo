import { createHash } from 'node:crypto';
import type { ChangeStatus } from './impact';

/** Bumped whenever the shape of `Evidence` changes incompatibly. */
export const EVIDENCE_SCHEMA_VERSION = 1;

export const ANALYZER_IDS = ['openapi', 'sql', 'compose', 'kubernetes', 'terraform'] as const;
export type AnalyzerId = typeof ANALYZER_IDS[number];
export const SEVERITIES = ['breaking', 'potentially-breaking', 'info'] as const;
export type Severity = typeof SEVERITIES[number];

/** Every rule an analyzer can emit. Each one has `rule.<id>` copy in the i18n catalog. */
export const RULE_IDS = [
  'openapi.document-unparseable',
  'openapi.document-removed',
  'openapi.path-removed',
  'openapi.operation-removed',
  'openapi.parameter-added-required',
  'openapi.parameter-became-required',
  'openapi.parameter-removed',
  'openapi.request-body-added-required',
  'openapi.request-body-became-required',
  'openapi.media-type-removed',
  'openapi.request-property-added-required',
  'openapi.request-property-removed',
  'openapi.request-enum-value-removed',
  'openapi.response-removed',
  'openapi.response-property-removed',
  'openapi.response-property-became-optional',
  'openapi.response-enum-value-added',
  'openapi.type-changed',
  'openapi.security-added',
  'openapi.composition-not-compared',
  'sql.migration-edited',
  'sql.drop-table',
  'sql.drop-column',
  'sql.drop-schema',
  'sql.truncate',
  'sql.rename-table',
  'sql.rename-column',
  'sql.alter-column-type',
  'sql.set-not-null',
  'sql.add-column-not-null-no-default',
  'sql.add-unique-or-foreign-key',
  'sql.drop-constraint',
  'sql.drop-index',
  'sql.create-index-blocking',
  'sql.write-without-where',
  'compose.document-unparseable',
  'compose.service-removed',
  'compose.dangling-reference',
  'compose.volume-removed',
  'compose.published-port-removed',
  'compose.env-variable-added',
  'compose.image-changed',
  'compose.inline-secret',
  'kubernetes.document-unparseable',
  'kubernetes.resource-removed',
  'kubernetes.dangling-reference',
  'kubernetes.service-selector-orphaned',
  'kubernetes.selector-changed',
  'kubernetes.service-port-removed',
  'kubernetes.secret-in-manifest',
  'terraform.document-unparseable',
  'terraform.resource-removed',
  'terraform.dangling-reference',
  'terraform.variable-added-required',
  'terraform.variable-removed',
  'terraform.output-removed',
  'terraform.backend-changed',
  'terraform.sensitive-literal',
  'terraform.plan-delete',
  'terraform.plan-replace',
] as const;
export type RuleId = typeof RULE_IDS[number];

export interface Evidence {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  /** Stable content hash of analyzer, rule, file, subject and location; identical findings share an id. */
  readonly id: string;
  readonly analyzer: AnalyzerId;
  readonly rule: RuleId;
  readonly severity: Severity;
  readonly confidence: 'high' | 'medium';
  /** Workspace-relative path of the file the evidence comes from. */
  readonly file: string;
  /** What changed, e.g. `DELETE /pets/{id}` or `users.email`. */
  readonly subject: string;
  /** Where inside the document, e.g. a JSON pointer or a 1-based statement number. */
  readonly location: string;
}

/** A changed file together with its content at the baseline and now (either side absent when it does not exist there). */
export interface DocumentChange {
  readonly path: string;
  readonly status: ChangeStatus;
  readonly before?: string;
  readonly after?: string;
}

export type EvidenceDraft = Omit<Evidence, 'schemaVersion' | 'id'>;

export function createEvidence(draft: EvidenceDraft): Evidence {
  const id = createHash('sha256')
    .update([draft.analyzer, draft.rule, draft.file, draft.subject, draft.location].join('\0'))
    .digest('hex')
    .slice(0, 16);
  return { schemaVersion: EVIDENCE_SCHEMA_VERSION, id, ...draft };
}

const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T => typeof value === 'string' && (options as readonly string[]).includes(value);

/**
 * Rebuilds evidence from untrusted data (e.g. a persisted cache). Returns `undefined` unless every
 * field is valid and the id matches the content hash; unknown extra properties are dropped.
 */
export function parseEvidence(value: unknown): Evidence | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const { analyzer, rule, severity, confidence, file, subject, location } = raw;
  if (!isOneOf(ANALYZER_IDS, analyzer) || !isOneOf(RULE_IDS, rule) || !isOneOf(SEVERITIES, severity) || !isOneOf(['high', 'medium'] as const, confidence)) return undefined;
  if (typeof file !== 'string' || typeof subject !== 'string' || typeof location !== 'string') return undefined;
  if (raw.schemaVersion !== EVIDENCE_SCHEMA_VERSION) return undefined;
  const evidence = createEvidence({ analyzer, rule, severity, confidence, file, subject, location });
  return evidence.id === raw.id ? evidence : undefined;
}

/** Records one finding of a fixed analyzer and file; shared by every analyzer that walks a document. */
export type EvidenceSink = (rule: RuleId, severity: Severity, subject: string, location: string, confidence?: Evidence['confidence']) => void;

export function evidenceCollector(analyzer: AnalyzerId, file: string, out: Evidence[]): EvidenceSink {
  return (rule, severity, subject, location, confidence = 'high') => {
    out.push(createEvidence({ analyzer, rule, severity, confidence, file, subject, location }));
  };
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { breaking: 0, 'potentially-breaking': 1, info: 2 };

/** Removes duplicate ids (keeping the first) and orders by severity, file, location and rule deterministically. */
export function dedupeEvidence(items: readonly Evidence[]): Evidence[] {
  const unique = new Map<string, Evidence>();
  for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);
  return [...unique.values()].sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.file.localeCompare(b.file) ||
    a.location.localeCompare(b.location, undefined, { numeric: true }) ||
    a.rule.localeCompare(b.rule) ||
    a.subject.localeCompare(b.subject));
}
