import { createEvidence, type DocumentChange, type Evidence, type RuleId, type Severity } from './evidence';
import { asArray, asObj, isObj, parseYaml, type Obj } from './values';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const MAX_SCHEMA_DEPTH = 16;

const encodePointer = (part: string): string => part.replace(/~/g, '~0').replace(/\//g, '~1');
const pointer = (...parts: string[]): string => '#/' + parts.map(encodePointer).join('/');
const templateShape = (route: string): string => route.replace(/\{[^}]*\}/g, '{}');

/** Cheap pre-check so unrelated JSON/YAML files are never parsed as contracts. */
export const looksLikeOpenApi = (text: string): boolean => /(?:^|[{,\s])["']?(?:openapi|swagger)["']?\s*:\s*["']?\d/m.test(text);

function parseDocument(text: string): Obj | undefined {
  const value = parseYaml(text);
  return isObj(value) && isObj(value.paths) ? value : undefined;
}

/** Follows local `$ref`s only; external or unresolvable references yield `undefined`. */
function resolveRef(doc: Obj, node: unknown): Obj | undefined {
  let current: unknown = node;
  for (let hops = 0; hops < MAX_SCHEMA_DEPTH; hops++) {
    if (!isObj(current)) return undefined;
    const ref = current.$ref;
    if (typeof ref !== 'string') return current;
    if (!ref.startsWith('#/')) return undefined;
    let target: unknown = doc;
    for (const raw of ref.slice(2).split('/')) {
      const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
      if (!isObj(target) || !(key in target)) return undefined;
      target = target[key];
    }
    current = target;
  }
  return undefined;
}

type Direction = 'request' | 'response';

const typeSet = (schema: Obj): Set<string> => {
  const raw = schema.type;
  const types = new Set<string>(typeof raw === 'string' ? [raw] : asArray(raw).filter((t): t is string => typeof t === 'string'));
  if (types.size > 0 && schema.nullable === true) types.add('null');
  return types;
};

/** `integer` is a subset of `number`; every member of `inner` must be accepted by `outer`. */
const covers = (outer: ReadonlySet<string>, inner: ReadonlySet<string>): boolean =>
  [...inner].every(type => outer.has(type) || (type === 'integer' && outer.has('number')));

const compositionKey = (schema: Obj): string => JSON.stringify([schema.allOf, schema.oneOf, schema.anyOf]);

class ContractDiff {
  readonly evidence: Evidence[] = [];

  constructor(private readonly file: string, private readonly before: Obj, private readonly after: Obj) {}

  private emit(rule: RuleId, severity: Severity, subject: string, location: string): void {
    this.evidence.push(createEvidence({ analyzer: 'openapi', rule, severity, confidence: 'high', file: this.file, subject, location }));
  }

  run(): Evidence[] {
    const oldPaths = asObj(this.before.paths);
    const newPaths = asObj(this.after.paths);
    const newByShape = new Map(Object.keys(newPaths).filter(key => !key.startsWith('x-')).map(key => [templateShape(key), key]));

    for (const route of Object.keys(oldPaths)) {
      if (route.startsWith('x-')) continue;
      const newRoute = newByShape.get(templateShape(route));
      if (newRoute === undefined) {
        this.emit('openapi.path-removed', 'breaking', route, pointer('paths', route));
        continue;
      }
      this.diffPath(route, newRoute, asObj(oldPaths[route]), asObj(newPaths[newRoute]));
    }
    return this.evidence;
  }

  private diffPath(route: string, newRoute: string, oldItem: Obj, newItem: Obj): void {
    for (const method of HTTP_METHODS) {
      if (!isObj(oldItem[method])) continue;
      const label = `${method.toUpperCase()} ${route}`;
      if (!isObj(newItem[method])) {
        this.emit('openapi.operation-removed', 'breaking', label, pointer('paths', route, method));
        continue;
      }
      const base = ['paths', newRoute, method];
      this.diffParameters(label, base, this.parametersOf(this.before, oldItem, oldItem[method] as Obj), this.parametersOf(this.after, newItem, newItem[method] as Obj));
      this.diffRequestBody(label, base, oldItem[method] as Obj, newItem[method] as Obj);
      this.diffResponses(label, base, oldItem[method] as Obj, newItem[method] as Obj);
      this.diffSecurity(label, base, oldItem[method] as Obj, newItem[method] as Obj);
    }
  }

  /** Path-level parameters overridden by operation-level ones, keyed by location and name. */
  private parametersOf(doc: Obj, pathItem: Obj, operation: Obj): Map<string, Obj> {
    const map = new Map<string, Obj>();
    for (const raw of [...asArray(pathItem.parameters), ...asArray(operation.parameters)]) {
      const param = resolveRef(doc, raw);
      if (param && typeof param.name === 'string' && typeof param.in === 'string') map.set(`${param.in}:${param.name}`, param);
    }
    return map;
  }

  private diffParameters(label: string, base: string[], oldParams: Map<string, Obj>, newParams: Map<string, Obj>): void {
    for (const [key, oldParam] of oldParams) {
      const location = pointer(...base, 'parameters');
      const subject = `${label} · ${key.replace(':', ' ')}`;
      const newParam = newParams.get(key);
      if (!newParam) {
        // Path parameters are positional: a rename is not a removal.
        if (oldParam.in !== 'path') this.emit('openapi.parameter-removed', 'potentially-breaking', subject, location);
        continue;
      }
      if (oldParam.required !== true && newParam.required === true) this.emit('openapi.parameter-became-required', 'breaking', subject, location);
      this.diffSchema(oldParam.schema, newParam.schema, 'request', subject, location, new Set(), 0);
    }
    for (const [key, newParam] of newParams) {
      if (!oldParams.has(key) && newParam.in !== 'path' && newParam.required === true) {
        this.emit('openapi.parameter-added-required', 'breaking', `${label} · ${key.replace(':', ' ')}`, pointer(...base, 'parameters'));
      }
    }
  }

  private diffRequestBody(label: string, base: string[], oldOp: Obj, newOp: Obj): void {
    const oldBody = resolveRef(this.before, oldOp.requestBody);
    const newBody = resolveRef(this.after, newOp.requestBody);
    const location = pointer(...base, 'requestBody');
    if (!newBody) return;
    if (!oldBody) {
      if (newBody.required === true) this.emit('openapi.request-body-added-required', 'breaking', label, location);
      return;
    }
    if (oldBody.required !== true && newBody.required === true) this.emit('openapi.request-body-became-required', 'breaking', label, location);
    this.diffContent(label + ' · request body', location, asObj(oldBody.content), asObj(newBody.content), 'request');
  }

  private diffResponses(label: string, base: string[], oldOp: Obj, newOp: Obj): void {
    const oldResponses = asObj(oldOp.responses);
    const newResponses = asObj(newOp.responses);
    for (const status of Object.keys(oldResponses)) {
      const location = pointer(...base, 'responses', status);
      const subject = `${label} · ${status}`;
      if (!(status in newResponses)) {
        // Only dropping a success response breaks clients; removing a documented error is not evidence of breakage.
        if (/^2/.test(status)) this.emit('openapi.response-removed', 'breaking', subject, location);
        continue;
      }
      const oldResponse = resolveRef(this.before, oldResponses[status]);
      const newResponse = resolveRef(this.after, newResponses[status]);
      if (oldResponse && newResponse) {
        this.diffContent(`${subject} · response`, location, asObj(oldResponse.content), asObj(newResponse.content), 'response');
      }
    }
  }

  private diffContent(subject: string, location: string, oldContent: Obj, newContent: Obj, direction: Direction): void {
    const newByType = new Map(Object.keys(newContent).map(type => [type.toLowerCase(), type]));
    for (const mediaType of Object.keys(oldContent)) {
      const newKey = newByType.get(mediaType.toLowerCase());
      const where = `${subject} · ${mediaType}`;
      if (newKey === undefined) {
        this.emit('openapi.media-type-removed', 'breaking', where, location);
        continue;
      }
      this.diffSchema(asObj(oldContent[mediaType]).schema, asObj(newContent[newKey]).schema, direction, where, `${location}/content/${encodePointer(newKey)}/schema`, new Set(), 0);
    }
  }

  private diffSecurity(label: string, base: string[], oldOp: Obj, newOp: Obj): void {
    const effective = (doc: Obj, op: Obj): unknown[] => asArray('security' in op ? op.security : doc.security).filter(req => isObj(req) && Object.keys(req).length > 0);
    if (effective(this.before, oldOp).length === 0 && effective(this.after, newOp).length > 0) {
      this.emit('openapi.security-added', 'breaking', label, pointer(...base, 'security'));
    }
  }

  private diffSchema(oldRaw: unknown, newRaw: unknown, direction: Direction, subject: string, location: string, stack: Set<Obj>, depth: number): void {
    const oldSchema = resolveRef(this.before, oldRaw);
    const newSchema = resolveRef(this.after, newRaw);
    if (!oldSchema || !newSchema || depth > MAX_SCHEMA_DEPTH || stack.has(oldSchema)) return;
    stack.add(oldSchema);
    try {
      if (compositionKey(oldSchema) !== compositionKey(newSchema)) {
        this.emit('openapi.composition-not-compared', 'info', subject, location);
      }

      const oldTypes = typeSet(oldSchema);
      const newTypes = typeSet(newSchema);
      if (oldTypes.size > 0 && newTypes.size > 0) {
        const compatible = direction === 'request' ? covers(newTypes, oldTypes) : covers(oldTypes, newTypes);
        if (!compatible) {
          this.emit('openapi.type-changed', 'breaking', `${subject} (${[...oldTypes].join('|')} → ${[...newTypes].join('|')})`, location);
          return;
        }
      }

      this.diffEnum(oldSchema, newSchema, direction, subject, location);
      this.diffProperties(oldSchema, newSchema, direction, subject, location, stack, depth);
      if (oldSchema.items !== undefined && newSchema.items !== undefined) {
        this.diffSchema(oldSchema.items, newSchema.items, direction, `${subject}[]`, `${location}/items`, stack, depth + 1);
      }
    } finally {
      stack.delete(oldSchema);
    }
  }

  private diffEnum(oldSchema: Obj, newSchema: Obj, direction: Direction, subject: string, location: string): void {
    if (!Array.isArray(oldSchema.enum) || !Array.isArray(newSchema.enum)) return;
    const key = (value: unknown): string => JSON.stringify(value);
    const oldValues = new Set(oldSchema.enum.map(key));
    const newValues = new Set(newSchema.enum.map(key));
    if (direction === 'request' && [...oldValues].some(value => !newValues.has(value))) {
      this.emit('openapi.request-enum-value-removed', 'breaking', subject, location);
    }
    if (direction === 'response' && [...newValues].some(value => !oldValues.has(value))) {
      this.emit('openapi.response-enum-value-added', 'potentially-breaking', subject, location);
    }
  }

  private diffProperties(oldSchema: Obj, newSchema: Obj, direction: Direction, subject: string, location: string, stack: Set<Obj>, depth: number): void {
    const oldProps = asObj(oldSchema.properties);
    const newProps = asObj(newSchema.properties);
    const oldRequired = new Set(asArray(oldSchema.required));
    const newRequired = new Set(asArray(newSchema.required));
    // Server-populated (readOnly) request fields and client-only (writeOnly) response fields are not part of the contract direction.
    const ignored = (prop: unknown): boolean => {
      const resolved = isObj(prop) ? prop : {};
      return direction === 'request' ? resolved.readOnly === true : resolved.writeOnly === true;
    };

    for (const name of Object.keys(oldProps)) {
      const where = `${subject} · ${name}`;
      const propLocation = `${location}/properties/${encodePointer(name)}`;
      if (!(name in newProps)) {
        if (direction === 'request') this.emit('openapi.request-property-removed', 'info', where, propLocation);
        else if (!ignored(oldProps[name])) this.emit('openapi.response-property-removed', oldRequired.has(name) ? 'breaking' : 'potentially-breaking', where, propLocation);
        continue;
      }
      if (!ignored(newProps[name])) {
        if (direction === 'request' && !oldRequired.has(name) && newRequired.has(name)) this.emit('openapi.request-property-added-required', 'breaking', where, propLocation);
        if (direction === 'response' && oldRequired.has(name) && !newRequired.has(name)) this.emit('openapi.response-property-became-optional', 'breaking', where, propLocation);
      }
      this.diffSchema(oldProps[name], newProps[name], direction, where, propLocation, stack, depth + 1);
    }
    if (direction === 'request') {
      for (const name of Object.keys(newProps)) {
        if (!(name in oldProps) && newRequired.has(name) && !ignored(newProps[name])) {
          this.emit('openapi.request-property-added-required', 'breaking', `${subject} · ${name}`, `${location}/properties/${encodePointer(name)}`);
        }
      }
    }
  }
}

/** Compares the contract before and after a change. Only breaking-change evidence is reported; additive changes stay silent. */
export function analyzeOpenApi(change: DocumentChange): Evidence[] {
  const { path: file, before, after } = change;
  const relevant = (before !== undefined && looksLikeOpenApi(before)) || (after !== undefined && looksLikeOpenApi(after));
  if (!relevant || before === undefined) return [];

  const draft = { analyzer: 'openapi', confidence: 'high', file, subject: file, location: '#/' } as const;
  if (after === undefined) return [createEvidence({ ...draft, rule: 'openapi.document-removed', severity: 'breaking' })];

  const oldDoc = parseDocument(before);
  const newDoc = parseDocument(after);
  if (!oldDoc || !newDoc) return [createEvidence({ ...draft, rule: 'openapi.document-unparseable', severity: 'info' })];
  return new ContractDiff(file, oldDoc, newDoc).run();
}
