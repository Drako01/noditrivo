import { evidenceCollector, type DocumentChange, type Evidence } from './evidence';
import { isLiteralValue, isSecretName } from './secrets';
import { asArray, asObj, isObj, parseYaml, type Obj } from './values';

/** `docker-compose.yml`, `compose.yaml`, `docker-compose.override.yml`, `compose.prod.yaml`… */
const COMPOSE_FILE = /(?:^|\/)(?:docker-)?compose(?:[.-][\w.-]*)?\.ya?ml$/i;
export const isComposePath = (path: string): boolean => COMPOSE_FILE.test(path);

interface ComposeModel {
  readonly doc: Obj;
  readonly services: ReadonlyMap<string, Obj>;
  readonly volumes: ReadonlySet<string>;
}
interface Reference {
  readonly from: string;
  readonly to: string;
  readonly pointer: string;
}

const EMPTY_MODEL: ComposeModel = { doc: {}, services: new Map(), volumes: new Set() };

function parseCompose(text: string): ComposeModel | undefined {
  const doc = parseYaml(text);
  if (!isObj(doc) || !isObj(doc.services)) return undefined;
  return {
    doc,
    services: new Map(Object.entries(doc.services).map(([name, service]) => [name, asObj(service)])),
    volumes: new Set(Object.keys(asObj(doc.volumes))),
  };
}

const strings = (value: unknown): string[] => asArray(value).filter((item): item is string => typeof item === 'string');

/** Every way one service can require another: depends_on, links, volumes_from, network_mode and a same-file extends. */
function references(model: ComposeModel): Reference[] {
  const found: Reference[] = [];
  for (const [name, service] of model.services) {
    const add = (to: string, key: string): void => { found.push({ from: name, to, pointer: `#/services/${name}/${key}` }); };
    const dependsOn = service.depends_on;
    for (const to of Array.isArray(dependsOn) ? strings(dependsOn) : Object.keys(asObj(dependsOn))) add(to, 'depends_on');
    for (const link of strings(service.links)) add(link.split(':')[0], 'links');
    for (const source of strings(service.volumes_from)) {
      if (!source.startsWith('container:')) add(source.replace(/^service:/, '').split(':')[0], 'volumes_from');
    }
    if (typeof service.network_mode === 'string' && service.network_mode.startsWith('service:')) add(service.network_mode.slice('service:'.length), 'network_mode');
    const extended = asObj(service.extends);
    if (typeof extended.service === 'string' && extended.file === undefined) add(extended.service, 'extends');
  }
  return found;
}

const referenceKey = (reference: Reference): string => `${reference.from}\0${reference.to}`;

/** `KEY=value`, `KEY` (passed through from the shell) and `KEY: value` forms; `null` means no literal value. */
function environment(service: Obj): Map<string, string | null> {
  const env = new Map<string, string | null>();
  const raw = service.environment;
  if (Array.isArray(raw)) {
    for (const entry of strings(raw)) {
      const at = entry.indexOf('=');
      env.set(at < 0 ? entry : entry.slice(0, at), at < 0 ? null : entry.slice(at + 1));
    }
  } else {
    for (const [key, value] of Object.entries(asObj(raw))) env.set(key, value === null || value === undefined ? null : String(value));
  }
  return env;
}

const INTERPOLATION = /\$\{([A-Za-z_]\w*)(:?[-+?][^}]*)?\}|\$([A-Za-z_]\w*)/g;

function collectInterpolated(value: unknown, pointer: string, into: Map<string, string>): void {
  if (typeof value === 'string') {
    for (const match of value.replace(/\$\$/g, '').matchAll(INTERPOLATION)) {
      const name = match[1] ?? match[3];
      const hasDefault = match[2] !== undefined && !/^:?\?/.test(match[2]);
      if (!hasDefault && !into.has(name)) into.set(name, pointer);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectInterpolated(item, `${pointer}/${index}`, into));
  } else if (isObj(value)) {
    for (const [key, item] of Object.entries(value)) collectInterpolated(item, `${pointer}/${key}`, into);
  }
}

/** Variables the file needs from its environment without a default: `${VAR}` and shell pass-through entries. */
function environmentDependencies(model: ComposeModel): Map<string, string> {
  const dependencies = new Map<string, string>();
  collectInterpolated(model.doc, '#', dependencies);
  for (const [name, service] of model.services) {
    for (const [key, value] of environment(service)) {
      if (value === null && !dependencies.has(key)) dependencies.set(key, `#/services/${name}/environment`);
    }
  }
  return dependencies;
}

/** Published (host-side) ports as `port/protocol`; container-only ports are not reachable from outside. */
function publishedPorts(service: Obj): Set<string> {
  const published = new Set<string>();
  for (const entry of asArray(service.ports)) {
    if (isObj(entry)) {
      if (entry.published !== undefined) published.add(`${String(entry.published)}/${typeof entry.protocol === 'string' ? entry.protocol : 'tcp'}`);
    } else if (typeof entry === 'string') {
      const [spec, protocol = 'tcp'] = entry.split('/');
      const parts = spec.replace(/^\[[^\]]*\]:/, '').split(':');
      if (parts.length >= 2) published.add(`${parts[parts.length === 3 ? 1 : 0]}/${protocol}`);
    }
  }
  return published;
}

/** Secret-named variables with a literal value, keyed by `service.VAR`; the value stays in memory only. */
function inlineSecrets(model: ComposeModel): Map<string, string> {
  const secrets = new Map<string, string>();
  for (const [name, service] of model.services) {
    for (const [key, value] of environment(service)) {
      if (value !== null && isSecretName(key) && isLiteralValue(value)) secrets.set(`${name}.${key}`, value);
    }
  }
  return secrets;
}

function analyzeFile({ path, before, after }: DocumentChange): Evidence[] {
  const evidence: Evidence[] = [];
  const emit = evidenceCollector('compose', path, evidence);
  const old = before === undefined ? undefined : parseCompose(before);
  const current = after === undefined ? undefined : parseCompose(after);
  if ((before !== undefined && !old) || (after !== undefined && !current)) {
    emit('compose.document-unparseable', 'info', path, '#/');
    return evidence;
  }
  const now = current ?? EMPTY_MODEL;

  const knownDangling = new Set(old ? references(old).filter(ref => !old.services.has(ref.to)).map(referenceKey) : []);
  for (const reference of references(now)) {
    if (!now.services.has(reference.to) && !knownDangling.has(referenceKey(reference))) {
      emit('compose.dangling-reference', 'breaking', `${reference.from} → ${reference.to}`, reference.pointer);
    }
  }

  const knownSecrets = old ? inlineSecrets(old) : new Map<string, string>();
  for (const [key, value] of inlineSecrets(now)) {
    if (knownSecrets.get(key) !== value) emit('compose.inline-secret', 'potentially-breaking', key, `#/services/${key.slice(0, key.lastIndexOf('.'))}/environment`, 'medium');
  }

  if (!old) return evidence;

  for (const [name, service] of old.services) {
    const next = now.services.get(name);
    if (!next) {
      emit('compose.service-removed', 'potentially-breaking', name, `#/services/${name}`);
      continue;
    }
    const remaining = publishedPorts(next);
    for (const port of publishedPorts(service)) {
      if (!remaining.has(port)) emit('compose.published-port-removed', 'potentially-breaking', `${name}:${port}`, `#/services/${name}/ports`);
    }
    if (typeof service.image === 'string' && typeof next.image === 'string' && service.image !== next.image) {
      emit('compose.image-changed', 'info', name, `#/services/${name}/image`);
    }
  }
  for (const volume of old.volumes) {
    if (!now.volumes.has(volume)) emit('compose.volume-removed', 'potentially-breaking', volume, `#/volumes/${volume}`);
  }
  if (current) {
    const previous = environmentDependencies(old);
    for (const [variable, pointer] of environmentDependencies(current)) {
      if (!previous.has(variable)) emit('compose.env-variable-added', 'potentially-breaking', variable, pointer, 'medium');
    }
  }
  return evidence;
}

export function analyzeCompose(changes: readonly DocumentChange[]): Evidence[] {
  return changes.filter(change => isComposePath(change.path)).flatMap(analyzeFile);
}
