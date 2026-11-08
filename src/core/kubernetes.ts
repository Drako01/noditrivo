import { isComposePath } from './compose';
import { evidenceCollector, type DocumentChange, type Evidence, type Severity } from './evidence';
import { asArray, asObj, isObj, parseYamlDocuments, stableJson, type Obj } from './values';

const YAML_FILE = /\.ya?ml$/i;
/** Cheap pre-check so unrelated YAML (CI, Compose, OpenAPI) is never parsed as a manifest. */
export const looksLikeKubernetes = (text: string): boolean => /^apiVersion\s*:/m.test(text) && /^kind\s*:/m.test(text);

const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob', 'Pod', 'ReplicationController']);
/** Kinds whose `spec.selector` is immutable once created. */
const IMMUTABLE_SELECTOR_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet']);
/** Removing these through an applied/pruned manifest deletes stored data or everything inside them. */
const DATA_BEARING_KINDS = new Set(['Namespace', 'PersistentVolumeClaim', 'PersistentVolume', 'StatefulSet', 'CustomResourceDefinition']);
const DEFAULT_NAMESPACE = 'default';

interface Resource {
  readonly kind: string;
  readonly name: string;
  readonly namespace: string;
  readonly key: string;
  readonly label: string;
  readonly doc: Obj;
  /** 1-based position of the document in the YAML stream. */
  readonly index: number;
}
interface Reference {
  readonly kind: string;
  readonly name: string;
  readonly pointer: string;
}

const keyOf = (kind: string, namespace: string, name: string): string => `${kind}/${namespace}/${name}`;
const labelOf = (kind: string, namespace: string, name: string): string =>
  namespace === DEFAULT_NAMESPACE ? `${kind}/${name}` : `${kind}/${namespace}/${name}`;

function toResource(doc: unknown, index: number): Resource | undefined {
  if (!isObj(doc) || typeof doc.apiVersion !== 'string' || typeof doc.kind !== 'string') return undefined;
  const metadata = asObj(doc.metadata);
  if (typeof metadata.name !== 'string') return undefined;
  const namespace = typeof metadata.namespace === 'string' ? metadata.namespace : DEFAULT_NAMESPACE;
  return { kind: doc.kind, name: metadata.name, namespace, key: keyOf(doc.kind, namespace, metadata.name), label: labelOf(doc.kind, namespace, metadata.name), doc, index };
}

function parseManifest(text: string): Resource[] | undefined {
  const documents = parseYamlDocuments(text);
  if (!documents) return undefined;
  const resources: Resource[] = [];
  documents.forEach((doc, position) => {
    const items = isObj(doc) && doc.kind === 'List' ? asArray(doc.items) : [doc];
    for (const item of items) {
      const resource = toResource(item, position + 1);
      if (resource) resources.push(resource);
    }
  });
  return resources;
}

interface PodTemplate {
  readonly labels: Obj;
  readonly spec: Obj;
  readonly pointer: string;
}

function podTemplate(resource: Resource): PodTemplate | undefined {
  if (!WORKLOAD_KINDS.has(resource.kind)) return undefined;
  const { doc } = resource;
  if (resource.kind === 'Pod') return { labels: asObj(asObj(doc.metadata).labels), spec: asObj(doc.spec), pointer: '/spec' };
  const spec = asObj(doc.spec);
  if (resource.kind === 'CronJob') {
    const template = asObj(asObj(asObj(spec.jobTemplate).spec).template);
    return { labels: asObj(asObj(template.metadata).labels), spec: asObj(template.spec), pointer: '/spec/jobTemplate/spec/template/spec' };
  }
  const template = asObj(spec.template);
  return { labels: asObj(asObj(template.metadata).labels), spec: asObj(template.spec), pointer: '/spec/template/spec' };
}

const requiredName = (source: unknown): string | undefined => {
  const node = asObj(source);
  return typeof node.name === 'string' && node.optional !== true ? node.name : undefined;
};

function workloadReferences({ spec, pointer }: PodTemplate): Reference[] {
  const found: Reference[] = [];
  const add = (kind: string, name: string | undefined, at: string): void => { if (name) found.push({ kind, name, pointer: `${pointer}/${at}` }); };
  asArray(spec.volumes).forEach((volume, i) => {
    const node = asObj(volume);
    add('ConfigMap', requiredName(node.configMap), `volumes/${i}`);
    const secret = asObj(node.secret);
    add('Secret', typeof secret.secretName === 'string' && secret.optional !== true ? secret.secretName : undefined, `volumes/${i}`);
    const claim = asObj(node.persistentVolumeClaim).claimName;
    add('PersistentVolumeClaim', typeof claim === 'string' ? claim : undefined, `volumes/${i}`);
  });
  if (typeof spec.serviceAccountName === 'string' && spec.serviceAccountName !== 'default') add('ServiceAccount', spec.serviceAccountName, 'serviceAccountName');
  for (const group of ['containers', 'initContainers']) {
    asArray(spec[group]).forEach((container, i) => {
      const node = asObj(container);
      const at = `${group}/${i}`;
      for (const from of asArray(node.envFrom).map(asObj)) {
        add('ConfigMap', requiredName(from.configMapRef), at);
        add('Secret', requiredName(from.secretRef), at);
      }
      for (const variable of asArray(node.env).map(asObj)) {
        const source = asObj(variable.valueFrom);
        add('ConfigMap', requiredName(source.configMapKeyRef), at);
        add('Secret', requiredName(source.secretKeyRef), at);
      }
    });
  }
  return found;
}

function ingressReferences(resource: Resource): Reference[] {
  const found: Reference[] = [];
  const spec = asObj(resource.doc.spec);
  const backends: Array<[unknown, string]> = [[spec.defaultBackend, '/spec/defaultBackend']];
  asArray(spec.rules).forEach((rule, r) => {
    asArray(asObj(asObj(rule).http).paths).forEach((entry, p) => backends.push([asObj(entry).backend, `/spec/rules/${r}/http/paths/${p}/backend`]));
  });
  for (const [backend, pointer] of backends) {
    const node = asObj(backend);
    const name = asObj(node.service).name ?? node.serviceName;
    if (typeof name === 'string') found.push({ kind: 'Service', name, pointer });
  }
  return found;
}

function referencesOf(resource: Resource): Reference[] {
  const template = podTemplate(resource);
  if (template) return workloadReferences(template);
  if (resource.kind === 'Ingress') return ingressReferences(resource);
  if (resource.kind === 'HorizontalPodAutoscaler') {
    const target = asObj(asObj(resource.doc.spec).scaleTargetRef);
    return typeof target.kind === 'string' && typeof target.name === 'string' ? [{ kind: target.kind, name: target.name, pointer: '/spec/scaleTargetRef' }] : [];
  }
  return [];
}

const selectorOf = (service: Resource): Obj => {
  const spec = asObj(service.doc.spec);
  return spec.type === 'ExternalName' ? {} : asObj(spec.selector);
};

const selects = (selector: Obj, workload: Resource): boolean => {
  const entries = Object.entries(selector);
  const labels = podTemplate(workload)?.labels ?? {};
  return entries.length > 0 && entries.every(([key, value]) => key in labels && String(labels[key]) === String(value));
};

const selectsAny = (service: Resource, workloads: readonly Resource[]): boolean =>
  workloads.some(workload => workload.namespace === service.namespace && selects(selectorOf(service), workload));

const servicePorts = (service: Resource): Set<string> => {
  const ports = new Set<string>();
  for (const entry of asArray(asObj(service.doc.spec).ports)) {
    const port = asObj(entry);
    if (port.port !== undefined) ports.add(`${String(port.port)}/${typeof port.protocol === 'string' ? port.protocol : 'TCP'}`);
  }
  return ports;
};

const secretPayload = (secret: Resource): string => stableJson([secret.doc.data ?? {}, secret.doc.stringData ?? {}]);
const hasSecretPayload = (secret: Resource): boolean =>
  Object.keys(asObj(secret.doc.data)).length + Object.keys(asObj(secret.doc.stringData)).length > 0;

interface ParsedChange {
  readonly path: string;
  readonly before: readonly Resource[];
  readonly after: readonly Resource[];
}

/**
 * Compares manifests statically. Existence of a resource is judged across *all* changed manifests
 * (so moving a resource between files is not a removal); unchanged files are never read.
 */
export function analyzeKubernetes(changes: readonly DocumentChange[]): Evidence[] {
  const evidence: Evidence[] = [];
  const parsed: ParsedChange[] = [];
  for (const { path, before, after } of changes) {
    if (!YAML_FILE.test(path) || isComposePath(path)) continue;
    if (![before, after].some(text => text !== undefined && looksLikeKubernetes(text))) continue;
    const previous = before === undefined ? [] : parseManifest(before);
    const current = after === undefined ? [] : parseManifest(after);
    if (!previous || !current) {
      evidenceCollector('kubernetes', path, evidence)('kubernetes.document-unparseable', 'info', path, 'document[1]');
      continue;
    }
    parsed.push({ path, before: previous, after: current });
  }

  const beforeAll = new Map(parsed.flatMap(change => change.before).map(resource => [resource.key, resource]));
  const afterAll = new Map(parsed.flatMap(change => change.after).map(resource => [resource.key, resource]));
  const beforeWorkloads = [...beforeAll.values()].filter(resource => WORKLOAD_KINDS.has(resource.kind));
  const afterWorkloads = [...afterAll.values()].filter(resource => WORKLOAD_KINDS.has(resource.kind));

  for (const change of parsed) {
    const emit = evidenceCollector('kubernetes', change.path, evidence);

    for (const resource of change.before) {
      if (afterAll.has(resource.key)) continue;
      const severity: Severity = DATA_BEARING_KINDS.has(resource.kind) ? 'breaking' : 'potentially-breaking';
      emit('kubernetes.resource-removed', severity, resource.label, `document[${resource.index}]`);
    }

    for (const resource of change.after) {
      const location = `document[${resource.index}]`;
      const previous = beforeAll.get(resource.key);

      for (const reference of referencesOf(resource)) {
        const target = keyOf(reference.kind, resource.namespace, reference.name);
        if (!afterAll.has(target) && beforeAll.has(target)) {
          emit('kubernetes.dangling-reference', 'breaking', `${resource.label} → ${labelOf(reference.kind, resource.namespace, reference.name)}`, `${location}#${reference.pointer}`);
        }
      }

      if (resource.kind === 'Secret' && hasSecretPayload(resource) && (!previous || secretPayload(previous) !== secretPayload(resource))) {
        emit('kubernetes.secret-in-manifest', 'potentially-breaking', resource.label, location, 'medium');
      }
      if (!previous) continue;

      if (IMMUTABLE_SELECTOR_KINDS.has(resource.kind) && stableJson(asObj(previous.doc.spec).selector) !== stableJson(asObj(resource.doc.spec).selector)) {
        emit('kubernetes.selector-changed', 'breaking', resource.label, `${location}#/spec/selector`);
      }
      if (resource.kind === 'Service') {
        if (selectsAny(previous, beforeWorkloads) && !selectsAny(resource, afterWorkloads)) {
          emit('kubernetes.service-selector-orphaned', 'breaking', resource.label, `${location}#/spec/selector`);
        }
        const remaining = servicePorts(resource);
        for (const port of servicePorts(previous)) {
          if (!remaining.has(port)) emit('kubernetes.service-port-removed', 'potentially-breaking', `${resource.label}:${port}`, `${location}#/spec/ports`);
        }
      }
    }
  }
  return evidence;
}
