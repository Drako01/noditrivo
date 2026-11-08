import * as path from 'node:path';
import { evidenceCollector, type DocumentChange, type Evidence, type EvidenceSink } from './evidence';
import { isLiteralValue, isSecretName } from './secrets';
import { asArray, asObj, isObj } from './values';

export const isTerraformPath = (file: string): boolean => /\.tf$/i.test(file);
/** `terraform show -json` output; recognised by content so unrelated JSON is never parsed. */
export const looksLikeTerraformPlan = (text: string): boolean => /"resource_changes"\s*:/.test(text);

// ---------------------------------------------------------------------------
// HCL scanning: a small, dependency-free reader of the block structure.
// Three equal-length views of the source: `code` (comments and heredoc bodies blanked),
// `mask` (additionally string contents hidden, safe for bracket matching) and
// `expr` (only expression text kept: string literals hidden, `${…}` interpolations visible).
// ---------------------------------------------------------------------------

interface Views {
  readonly code: string;
  readonly mask: string;
  readonly expr: string;
}

const MAX_STRING_NESTING = 32;
const HEREDOC_HEADER = /<<-?([A-Za-z_]\w*)[ \t]*\r?\n/y;

function sanitize(text: string): Views | undefined {
  const n = text.length;
  const code = text.split('');
  const mask = text.split('');
  const expr = text.split('');
  const fill = (view: string[], from: number, to: number, char: string): void => {
    for (let k = from; k < to && k < n; k++) if (text[k] !== '\n' && text[k] !== '\r') view[k] = char;
  };
  const hide = (from: number, to: number): void => { fill(mask, from, to, '_'); fill(expr, from, to, ' '); };
  const blank = (from: number, to: number): void => { fill(code, from, to, ' '); fill(mask, from, to, ' '); fill(expr, from, to, ' '); };

  /** Returns the index just past the closing quote; throws when nesting is absurd. */
  const scanString = (start: number, depth: number): number => {
    if (depth > MAX_STRING_NESTING) throw new RangeError('string nesting too deep');
    let j = start + 1;
    while (j < n) {
      const char = text[j];
      if (char === '\n') return j;
      if (char === '"') return j + 1;
      if (char === '\\') { hide(j, j + 2); j += 2; continue; }
      if ((char === '$' || char === '%') && text[j + 1] === char && text[j + 2] === '{') { hide(j, j + 3); j += 3; continue; }
      if ((char === '$' || char === '%') && text[j + 1] === '{') {
        fill(mask, j, j + 2, '_');
        j += 2;
        let braces = 1;
        while (j < n && braces > 0 && text[j] !== '\n') {
          if (text[j] === '"') {
            const end = scanString(j, depth + 1);
            fill(mask, j, end, '_');
            j = end;
            continue;
          }
          if (text[j] === '{') braces++;
          else if (text[j] === '}') braces--;
          fill(mask, j, j + 1, '_');
          j++;
        }
        continue;
      }
      hide(j, j + 1);
      j++;
    }
    return j;
  };

  try {
    let i = 0;
    while (i < n) {
      const char = text[i];
      if (char === '#' || (char === '/' && text[i + 1] === '/')) {
        const eol = text.indexOf('\n', i);
        const end = eol < 0 ? n : eol;
        blank(i, end);
        i = end;
      } else if (char === '/' && text[i + 1] === '*') {
        const close = text.indexOf('*/', i + 2);
        const end = close < 0 ? n : close + 2;
        blank(i, end);
        i = end;
      } else if (char === '"') {
        i = scanString(i, 0);
      } else if (char === '<' && text[i + 1] === '<') {
        HEREDOC_HEADER.lastIndex = i;
        const header = HEREDOC_HEADER.exec(text);
        if (!header) { i++; continue; }
        const bodyStart = i + header[0].length;
        const terminator = new RegExp(`^[ \\t]*${header[1]}[ \\t]*\\r?$`, 'm').exec(text.slice(bodyStart));
        const end = terminator ? bodyStart + terminator.index + terminator[0].length : n;
        blank(bodyStart, end);
        i = end;
      } else {
        i++;
      }
    }
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
  return { code: code.join(''), mask: mask.join(''), expr: expr.join('') };
}

interface Block extends Views {
  readonly type: string;
  readonly labels: readonly string[];
}

const BLOCK_HEADER = /([A-Za-z_][\w-]*)((?:[ \t]+(?:"[^"\n]*"|[A-Za-z_][\w-]*))*)[ \t]*\{/y;
const BRACKET_DELTA: Readonly<Record<string, number>> = { '{': 1, '[': 1, '(': 1, '}': -1, ']': -1, ')': -1 };

/** End of a non-block statement (`name = value`, possibly spanning lines); undefined when brackets do not balance. */
function skipStatement(mask: string, from: number): number | undefined {
  let depth = 0;
  for (let i = from; i < mask.length; i++) {
    depth += BRACKET_DELTA[mask[i]] ?? 0;
    if (depth < 0) return undefined;
    if (mask[i] === '\n' && depth === 0) return i + 1;
  }
  return depth === 0 ? mask.length : undefined;
}

/** Blocks directly inside `views`; attributes are skipped. Undefined when braces are unbalanced. */
function parseBlocks(views: Views): Block[] | undefined {
  const { code, mask, expr } = views;
  const blocks: Block[] = [];
  let i = 0;
  while (i < mask.length) {
    if (/\s/.test(mask[i])) { i++; continue; }
    BLOCK_HEADER.lastIndex = i;
    const header = BLOCK_HEADER.exec(mask);
    if (!header) {
      const next = skipStatement(mask, i);
      if (next === undefined) return undefined;
      i = next;
      continue;
    }
    const open = i + header[0].length - 1;
    let depth = 0;
    let close = open;
    for (; close < mask.length; close++) {
      if (mask[close] === '{') depth++;
      else if (mask[close] === '}' && --depth === 0) break;
    }
    if (depth !== 0) return undefined;
    const labels = [...code.slice(i + header[1].length, open).matchAll(/"([^"]*)"|([A-Za-z_][\w-]*)/g)].map(match => match[1] ?? match[2]);
    blocks.push({ type: header[1], labels, code: code.slice(open + 1, close), mask: mask.slice(open + 1, close), expr: expr.slice(open + 1, close) });
    i = close + 1;
  }
  return blocks;
}

interface Attribute {
  readonly name: string;
  readonly value: string;
  readonly expr: string;
}

const countMatches = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

/** `name = value` statements at the top level of a block body (the first line of the value). */
function attributes(block: Views): Attribute[] {
  const found: Attribute[] = [];
  let depth = 0;
  let offset = 0;
  for (const line of block.mask.split('\n')) {
    const start = offset;
    offset += line.length + 1;
    if (depth === 0) {
      const head = /^\s*([A-Za-z_][\w-]*)\s*=(?![=>])\s*/.exec(line);
      if (head) {
        found.push({ name: head[1], value: block.code.slice(start + head[0].length, start + line.length).trim(), expr: block.expr.slice(start + head[0].length, start + line.length).trim() });
      }
    }
    depth += countMatches(line, /[{[(]/g) - countMatches(line, /[}\])]/g);
  }
  return found;
}

const stringLiteral = (value: string): string | undefined => /^"([^"\n]*)"$/.exec(value)?.[1];

// ---------------------------------------------------------------------------
// Static model of a module directory.
// ---------------------------------------------------------------------------

/** Address a block defines (`aws_s3_bucket.logs`, `data.aws_ami.base`, `module.net`, `var.x`, `output.y`). */
function definedAddress(block: Block): string | undefined {
  const [first, second] = block.labels;
  switch (block.type) {
    case 'resource': return second === undefined ? undefined : `${first}.${second}`;
    case 'data': return second === undefined ? undefined : `data.${first}.${second}`;
    case 'module': return first === undefined ? undefined : `module.${first}`;
    case 'variable': return first === undefined ? undefined : `var.${first}`;
    case 'output': return first === undefined ? undefined : `output.${first}`;
    default: return undefined;
  }
}

/** Name used to point at a block in evidence. */
const blockName = (block: Block): string => definedAddress(block) ?? (block.type === 'provider' ? `provider.${block.labels[0] ?? ''}` : block.type);

interface Side {
  /** address → file that defines it */
  readonly definitions: Map<string, string>;
  readonly variableHasDefault: Map<string, boolean>;
  /** Addresses covered by `moved`/`removed` blocks: leaving them is intentional. */
  readonly moved: Set<string>;
  readonly backends: Map<string, { signature: string; file: string }>;
}
const newSide = (): Side => ({ definitions: new Map(), variableHasDefault: new Map(), moved: new Set(), backends: new Map() });

function register(side: Side, file: string, blocks: readonly Block[]): void {
  for (const block of blocks) {
    const address = definedAddress(block);
    if (address) {
      side.definitions.set(address, file);
      if (block.type === 'variable') side.variableHasDefault.set(address, attributes(block).some(attribute => attribute.name === 'default'));
    }
    if (block.type === 'locals') for (const attribute of attributes(block)) side.definitions.set(`local.${attribute.name}`, file);
    if (block.type === 'moved' || block.type === 'removed') {
      const from = attributes(block).find(attribute => attribute.name === 'from');
      if (from) side.moved.add(from.expr.replace(/\s+/g, ''));
    }
    if (block.type === 'terraform') {
      for (const backend of parseBlocks(block)?.filter(nested => nested.type === 'backend') ?? []) {
        side.backends.set(backend.labels[0] ?? '', { signature: backend.code.replace(/\s+/g, ' ').trim(), file });
      }
    }
  }
}

/** Addresses an expression refers to. Loop variables and `each.*`/`path.*` never look like `<provider>_<type>.<name>`. */
function referencedAddresses(expr: string): Set<string> {
  const found = new Set<string>();
  for (const match of expr.matchAll(/(?<![\w.-])(var|local|module)\.([A-Za-z_][\w-]*)/g)) found.add(`${match[1]}.${match[2]}`);
  for (const match of expr.matchAll(/(?<![\w.-])data\.([a-z]\w*)\.([A-Za-z_][\w-]*)/g)) found.add(`data.${match[1]}.${match[2]}`);
  for (const match of expr.matchAll(/(?<![\w.-])([a-z][a-z0-9]*_[a-z0-9_]*)\.([A-Za-z_][\w-]*)/g)) found.add(`${match[1]}.${match[2]}`);
  return found;
}

/** Credential-named attributes holding a string literal, keyed by `owner.attribute`; values stay in memory only. */
function literalSecrets(blocks: readonly Block[]): Map<string, string> {
  const secrets = new Map<string, string>();
  for (const block of blocks) {
    const owner = blockName(block);
    if (block.type === 'variable') {
      const name = block.labels[0] ?? '';
      const fallback = attributes(block).find(attribute => attribute.name === 'default');
      const literal = fallback && isSecretName(name) ? stringLiteral(fallback.value) : undefined;
      if (literal !== undefined && isLiteralValue(literal)) secrets.set(`${owner}.default`, literal);
    } else if (['resource', 'data', 'provider', 'module', 'locals'].includes(block.type)) {
      for (const attribute of attributes(block)) {
        const literal = isSecretName(attribute.name) ? stringLiteral(attribute.value) : undefined;
        if (literal !== undefined && isLiteralValue(literal)) secrets.set(`${owner}.${attribute.name}`, literal);
      }
    }
  }
  return secrets;
}

interface ModuleDirectory {
  readonly before: Side;
  readonly after: Side;
  hasBaseline: boolean;
  broken: boolean;
  readonly referrers: Array<{ file: string; block: Block }>;
}

function parseHcl(text: string): Block[] | undefined {
  const views = sanitize(text);
  return views && parseBlocks(views);
}

const SCOPED_PREFIXES = ['var.', 'output.', 'local.', 'data.'];

function analyzeConfiguration(changes: readonly DocumentChange[], evidence: Evidence[]): void {
  const directories = new Map<string, ModuleDirectory>();

  for (const { path: file, before, after } of changes) {
    if (!isTerraformPath(file)) continue;
    const dir = path.posix.dirname(file);
    const directory = directories.get(dir) ?? { before: newSide(), after: newSide(), hasBaseline: false, broken: false, referrers: [] };
    directories.set(dir, directory);
    const emit = evidenceCollector('terraform', file, evidence);

    const previous = before === undefined ? [] : parseHcl(before);
    const current = after === undefined ? [] : parseHcl(after);
    if (!previous || !current) {
      directory.broken = true;
      emit('terraform.document-unparseable', 'info', file, 'file');
      continue;
    }
    if (before !== undefined) directory.hasBaseline = true;
    register(directory.before, file, previous);
    register(directory.after, file, current);
    for (const block of current) if (!['moved', 'removed', 'import'].includes(block.type)) directory.referrers.push({ file, block });

    const known = literalSecrets(previous);
    for (const [key, value] of literalSecrets(current)) {
      if (known.get(key) !== value) emit('terraform.sensitive-literal', 'potentially-breaking', key, `block[${key.slice(0, key.lastIndexOf('.'))}]`, 'medium');
    }
  }

  for (const directory of directories.values()) {
    if (directory.broken || !directory.hasBaseline) continue;
    const { before, after } = directory;
    const intact = (address: string): boolean => after.definitions.has(address) || after.moved.has(address);

    for (const [address, file] of before.definitions) {
      if (intact(address)) continue;
      const emit = evidenceCollector('terraform', file, evidence);
      if (address.startsWith('var.')) emit('terraform.variable-removed', 'potentially-breaking', address, `block[${address}]`);
      else if (address.startsWith('output.')) emit('terraform.output-removed', 'potentially-breaking', address, `block[${address}]`);
      else if (!SCOPED_PREFIXES.some(prefix => address.startsWith(prefix))) emit('terraform.resource-removed', 'breaking', address, `block[${address}]`);
    }

    for (const [address, file] of after.definitions) {
      if (address.startsWith('var.') && !before.definitions.has(address) && after.variableHasDefault.get(address) === false) {
        evidenceCollector('terraform', file, evidence)('terraform.variable-added-required', 'potentially-breaking', address, `block[${address}]`);
      }
    }

    for (const { file, block } of directory.referrers) {
      const referrer = blockName(block);
      for (const target of referencedAddresses(block.expr)) {
        if (before.definitions.has(target) && !intact(target)) {
          evidenceCollector('terraform', file, evidence)('terraform.dangling-reference', 'breaking', `${referrer} → ${target}`, `block[${referrer}]`);
        }
      }
    }

    const signature = (side: Side): string => [...side.backends].map(([label, backend]) => `${label}:${backend.signature}`).sort().join('\n');
    if (signature(before) !== signature(after)) {
      const [label, backend] = [...after.backends, ...before.backends][0] ?? ['', { file: '' }];
      if (backend.file) evidenceCollector('terraform', backend.file, evidence)('terraform.backend-changed', 'potentially-breaking', label || 'backend', 'block[terraform]');
    }
  }
}

// ---------------------------------------------------------------------------
// `terraform show -json` plans. Only addresses and actions are read; resource values are never copied.
// ---------------------------------------------------------------------------

interface PlannedChange {
  readonly address: string;
  readonly actions: readonly string[];
  readonly index: number;
}

function plannedChanges(text: string): PlannedChange[] | undefined {
  let plan: unknown;
  try {
    plan = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObj(plan)) return undefined;
  const planned: PlannedChange[] = [];
  asArray(plan.resource_changes).forEach((entry, index) => {
    const node = asObj(entry);
    const actions = asArray(asObj(node.change).actions).filter((action): action is string => typeof action === 'string');
    if (typeof node.address === 'string' && node.mode !== 'data') planned.push({ address: node.address, actions, index });
  });
  return planned;
}

const changeKey = (change: PlannedChange): string => `${change.address}\0${change.actions.join(',')}`;

function analyzePlan({ path: file, before, after }: DocumentChange, evidence: Evidence[]): void {
  if (after === undefined || !looksLikeTerraformPlan(after)) return;
  const emit: EvidenceSink = evidenceCollector('terraform', file, evidence);
  const current = plannedChanges(after);
  const previous = before === undefined || !looksLikeTerraformPlan(before) ? [] : plannedChanges(before) ?? [];
  if (!current) {
    emit('terraform.document-unparseable', 'info', file, '#/');
    return;
  }
  const known = new Set(previous.map(changeKey));
  for (const change of current) {
    if (!change.actions.includes('delete') || known.has(changeKey(change))) continue;
    emit(change.actions.includes('create') ? 'terraform.plan-replace' : 'terraform.plan-delete', 'breaking', change.address, `#/resource_changes/${change.index}`);
  }
}

export function analyzeTerraform(changes: readonly DocumentChange[]): Evidence[] {
  const evidence: Evidence[] = [];
  analyzeConfiguration(changes, evidence);
  for (const change of changes) if (change.path.toLowerCase().endsWith('.json')) analyzePlan(change, evidence);
  return evidence;
}
