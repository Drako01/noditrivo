import { parse, parseAllDocuments } from 'yaml';

export type Obj = Record<string, unknown>;

export const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
export const asObj = (value: unknown): Obj => (isObj(value) ? value : {});
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** JSON with object keys sorted, so structurally equal values serialize identically. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    isObj(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v);
}

const MAX_ALIAS_COUNT = 100;

/** Parses YAML/JSON text; `undefined` when it is malformed or abusive (alias bombs). */
export function parseYaml(text: string): unknown {
  try {
    return parse(text, { maxAliasCount: MAX_ALIAS_COUNT });
  } catch {
    return undefined;
  }
}

/** Parses a multi-document YAML stream; `undefined` when any document is malformed. */
export function parseYamlDocuments(text: string): unknown[] | undefined {
  try {
    const documents = parseAllDocuments(text);
    if (documents.some(document => document.errors.length > 0)) return undefined;
    return documents.map(document => document.toJS({ maxAliasCount: MAX_ALIAS_COUNT }));
  } catch {
    return undefined;
  }
}
