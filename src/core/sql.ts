import { createEvidence, type DocumentChange, type Evidence, type RuleId, type Severity } from './evidence';

export type SqlDialect = 'postgresql' | 'mysql' | 'generic';

export interface SqlStatement {
  /** Whitespace-collapsed text with comments removed and string literals replaced by `'?'`. */
  readonly text: string;
  /** 1-based position within the file. */
  readonly index: number;
}

const MIGRATION_PATH = /(?:^|\/)(?:migrations?|migrate)\//i;

export const isMigrationPath = (path: string): boolean => MIGRATION_PATH.test(path);

const MYSQL_MARKERS = /`|\bAUTO_INCREMENT\b|\bENGINE\s*=|\bUNSIGNED\b|\bDELIMITER\b/i;
const POSTGRES_MARKERS = /\$\$|\$[A-Za-z_]\w*\$|::\w|\bBIGSERIAL\b|\bSERIAL\b|\bCONCURRENTLY\b|\bTIMESTAMPTZ\b|\bJSONB\b|\bCREATE\s+EXTENSION\b|\bUUID\b/i;

/** Heuristic by dialect-specific syntax; ambiguous or marker-free files are `generic`. */
export function detectDialect(sql: string): SqlDialect {
  const mysql = MYSQL_MARKERS.test(sql);
  const postgres = POSTGRES_MARKERS.test(sql);
  if (mysql === postgres) return 'generic';
  return mysql ? 'mysql' : 'postgresql';
}

const isIdentifierChar = (char: string | undefined): boolean => char !== undefined && /[\w$]/.test(char);

/** Index just past the closing quote (doubled quotes escape; backslash escapes when enabled). Unterminated runs to the end. */
function skipQuoted(sql: string, start: number, quote: string, backslash: boolean): number {
  let i = start + 1;
  while (i < sql.length) {
    if (backslash && sql[i] === '\\') i += 2;
    else if (sql[i] === quote) {
      if (sql[i + 1] !== quote) return i + 1;
      i += 2;
    } else i++;
  }
  return sql.length;
}

function skipBlockComment(sql: string, start: number, nested: boolean): number {
  let depth = 1;
  let i = start + 2;
  while (i < sql.length && depth > 0) {
    if (sql.startsWith('*/', i)) { depth--; i += 2; }
    else if (nested && sql.startsWith('/*', i)) { depth++; i += 2; }
    else i++;
  }
  return i;
}

const lineEnd = (sql: string, from: number): number => {
  const eol = sql.indexOf('\n', from);
  return eol < 0 ? sql.length : eol;
};

/**
 * Splits a script into statements without being fooled by comments, quoted
 * identifiers, string literals, dollar-quoted bodies or MySQL `DELIMITER` blocks.
 */
export function splitStatements(sql: string, dialect: SqlDialect): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let buffer = '';
  let hasContent = false;
  let delimiter = ';';
  let i = 0;

  const append = (chunk: string): void => {
    buffer += chunk;
    if (!hasContent && chunk.trim() !== '') hasContent = true;
  };
  const flush = (): void => {
    const text = buffer.replace(/\s+/g, ' ').trim();
    if (text) statements.push({ text, index: statements.length + 1 });
    buffer = '';
    hasContent = false;
  };

  while (i < sql.length) {
    const char = sql[i];
    if (!hasContent && (char === 'd' || char === 'D')) {
      const end = lineEnd(sql, i);
      const command = /^delimiter[ \t]+(\S+)/i.exec(sql.slice(i, end));
      if (command) {
        delimiter = command[1];
        i = end + 1;
        continue;
      }
    }
    if (sql.startsWith(delimiter, i)) {
      flush();
      i += delimiter.length;
    } else if (sql.startsWith('--', i) || (dialect === 'mysql' && char === '#')) {
      i = lineEnd(sql, i);
      append(' ');
    } else if (sql.startsWith('/*', i)) {
      i = skipBlockComment(sql, i, dialect !== 'mysql');
      append(' ');
    } else if (char === "'") {
      // PostgreSQL only honors backslash escapes in E'...' strings.
      const escapes = dialect === 'mysql' || /(?:^|[^\w$])[eE]$/.test(buffer.slice(-2));
      i = skipQuoted(sql, i, "'", escapes);
      append("'?'");
    } else if (char === '"' && dialect === 'mysql') {
      i = skipQuoted(sql, i, '"', true);
      append("'?'");
    } else if (char === '"' || char === '`') {
      const end = skipQuoted(sql, i, char, false);
      append(sql.slice(i, end));
      i = end;
    } else if (char === '$' && dialect !== 'mysql' && !isIdentifierChar(buffer.at(-1))) {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 64));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        i = close < 0 ? sql.length : close + tag[0].length;
        append("'?'");
      } else {
        append(char);
        i++;
      }
    } else {
      append(char);
      i++;
    }
  }
  flush();
  return statements;
}

const ID = '(?:"[^"]+"|`[^`]+`|[A-Za-z_][\\w$]*)';
const QID = `${ID}(?:\\s*\\.\\s*${ID})*`;
const displayName = (raw: string): string => raw.replace(/["`\s]/g, '');
const keyOf = (raw: string): string => displayName(raw).toLowerCase();

const CREATE_TABLE = new RegExp(`^CREATE\\s+(?:(?:GLOBAL\\s+|LOCAL\\s+)?(?:TEMPORARY\\s+|TEMP\\s+)|UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QID})`, 'i');
const DROP_TABLE = new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${QID}(?:\\s*,\\s*${QID})*)`, 'i');
const DROP_SCHEMA = new RegExp(`^DROP\\s+(?:SCHEMA|DATABASE)\\s+(?:IF\\s+EXISTS\\s+)?(${QID})`, 'i');
const TRUNCATE = new RegExp(`^TRUNCATE\\s+(?:TABLE\\s+)?(?:ONLY\\s+)?(${QID})`, 'i');
const RENAME_TABLE_STMT = new RegExp(`^RENAME\\s+TABLE\\s+(${QID})\\s+TO\\s+(${QID})`, 'i');
const ALTER_TABLE = new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${QID})\\s+(.+)$`, 'i');
const DROP_INDEX = new RegExp(`^DROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?(${QID})(?:\\s+ON\\s+(${QID}))?`, 'i');
const CREATE_INDEX = new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?!CONCURRENTLY\\b)(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:${ID}\\s+)?ON\\s+(?:ONLY\\s+)?(${QID})`, 'i');
const DELETE_FROM = new RegExp(`^DELETE\\s+FROM\\s+(?:ONLY\\s+)?(${QID})`, 'i');
const UPDATE = new RegExp(`^UPDATE\\s+(?:ONLY\\s+)?(${QID})\\s+SET\\b`, 'i');

const ACTION_RENAME_TO = new RegExp(`^RENAME\\s+(?:TO|AS)\\s+(${QID})`, 'i');
const ACTION_RENAME_COLUMN = new RegExp(`^RENAME\\s+(?:COLUMN\\s+)?(${ID})\\s+TO\\s+(${ID})`, 'i');
const ACTION_DROP_CONSTRAINT = /^DROP\s+(?:CONSTRAINT|FOREIGN\s+KEY|PRIMARY\s+KEY|CHECK)\b/i;
const ACTION_DROP_INDEX = /^DROP\s+(?:INDEX|KEY)\b/i;
const ACTION_DROP_OTHER = /^DROP\s+(?:UNIQUE|PARTITION|DEFAULT|IDENTITY|EXPRESSION)\b/i;
const ACTION_DROP_COLUMN = new RegExp(`^DROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?(${ID})`, 'i');
// Quoted identifiers end in a non-word character, so `\b` cannot terminate them.
const ACTION_MODIFY = new RegExp(`^MODIFY\\s+(?:COLUMN\\s+)?(${ID})(?=\\s|$)`, 'i');
const ACTION_CHANGE = new RegExp(`^CHANGE\\s+(?:COLUMN\\s+)?(${ID})\\s+(${ID})(?=\\s|$)`, 'i');
const ACTION_ALTER_TYPE = new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?(${ID})\\s+(?:SET\\s+DATA\\s+)?TYPE\\b`, 'i');
const ACTION_SET_NOT_NULL = new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?(${ID})\\s+SET\\s+NOT\\s+NULL\\b`, 'i');
const ACTION_ADD_CONSTRAINT = new RegExp(`^ADD\\s+(?:CONSTRAINT\\s+${ID}\\s+)?(?:UNIQUE|FOREIGN\\s+KEY|PRIMARY\\s+KEY|CHECK)\\b`, 'i');
const ACTION_ADD_NON_COLUMN = /^ADD\s+(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|INDEX|KEY|FULLTEXT|SPATIAL|PARTITION|EXCLUDE)\b/i;
const ACTION_ADD_COLUMN = new RegExp(`^ADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${ID})\\s+(.+)$`, 'i');
const NOT_NULL = /\bNOT\s+NULL\b/i;
const HAS_IMPLICIT_VALUE = /\bDEFAULT\b|\bAUTO_INCREMENT\b|\b(?:BIG|SMALL)?SERIAL\b|\bGENERATED\b|\bIDENTITY\b|\bPRIMARY\s+KEY\b/i;
const HAS_WHERE = /\bWHERE\b/i;

/** Splits `ALTER TABLE` actions on top-level commas (commas inside parentheses belong to one action). */
function splitActions(actions: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < actions.length; i++) {
    const char = actions[i];
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      parts.push(actions.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(actions.slice(start).trim());
  return parts.filter(Boolean);
}

interface Finding {
  readonly rule: RuleId;
  readonly severity: Severity;
  readonly subject: string;
  readonly confidence?: 'high' | 'medium';
  /** Table the finding targets; findings on tables created in the same file are discarded. */
  readonly table?: string;
}

function classifyAction(table: string, action: string, dialect: SqlDialect): Finding[] {
  const on = (rule: RuleId, severity: Severity, subject: string, confidence?: 'high' | 'medium'): Finding[] => [{ rule, severity, subject, table, confidence }];
  const column = (name: string): string => `${table}.${displayName(name)}`;
  let m: RegExpExecArray | null;

  if ((m = ACTION_RENAME_TO.exec(action))) return on('sql.rename-table', 'breaking', `${table} → ${displayName(m[1])}`);
  if ((m = ACTION_RENAME_COLUMN.exec(action))) return on('sql.rename-column', 'breaking', `${column(m[1])} → ${displayName(m[2])}`);
  if (ACTION_DROP_CONSTRAINT.test(action)) return on('sql.drop-constraint', 'potentially-breaking', table);
  if (ACTION_DROP_INDEX.test(action)) return on('sql.drop-index', 'potentially-breaking', table);
  if (ACTION_DROP_OTHER.test(action)) return [];
  if ((m = ACTION_DROP_COLUMN.exec(action))) return on('sql.drop-column', 'breaking', column(m[1]));
  if ((m = ACTION_CHANGE.exec(action))) {
    return keyOf(m[1]) === keyOf(m[2])
      ? on('sql.alter-column-type', 'potentially-breaking', column(m[1]), 'medium')
      : on('sql.rename-column', 'breaking', `${column(m[1])} → ${displayName(m[2])}`);
  }
  if ((m = ACTION_MODIFY.exec(action))) return on('sql.alter-column-type', 'potentially-breaking', column(m[1]), 'medium');
  if ((m = ACTION_ALTER_TYPE.exec(action))) return on('sql.alter-column-type', 'potentially-breaking', column(m[1]));
  if ((m = ACTION_SET_NOT_NULL.exec(action))) return on('sql.set-not-null', 'potentially-breaking', column(m[1]));
  if (ACTION_ADD_CONSTRAINT.test(action)) return on('sql.add-unique-or-foreign-key', 'potentially-breaking', table);
  if (ACTION_ADD_NON_COLUMN.test(action)) return [];
  if ((m = ACTION_ADD_COLUMN.exec(action)) && NOT_NULL.test(m[2]) && !HAS_IMPLICIT_VALUE.test(m[2])) {
    // MySQL fills existing rows with an implicit default but still rejects inserts that omit the column.
    return on('sql.add-column-not-null-no-default', 'potentially-breaking', column(m[1]), dialect === 'generic' ? 'medium' : 'high');
  }
  return [];
}

function classifyStatement(text: string, dialect: SqlDialect): Finding[] {
  let m: RegExpExecArray | null;
  if ((m = DROP_TABLE.exec(text))) {
    return m[1].split(/\s*,\s*/).map(name => ({ rule: 'sql.drop-table' as const, severity: 'breaking' as const, subject: displayName(name), table: keyOf(name) }));
  }
  if ((m = DROP_SCHEMA.exec(text))) return [{ rule: 'sql.drop-schema', severity: 'breaking', subject: displayName(m[1]) }];
  if ((m = TRUNCATE.exec(text))) return [{ rule: 'sql.truncate', severity: 'breaking', subject: displayName(m[1]), table: keyOf(m[1]) }];
  if ((m = RENAME_TABLE_STMT.exec(text))) return [{ rule: 'sql.rename-table', severity: 'breaking', subject: `${displayName(m[1])} → ${displayName(m[2])}`, table: keyOf(m[1]) }];
  if ((m = ALTER_TABLE.exec(text))) {
    const table = displayName(m[1]);
    return splitActions(m[2]).flatMap(action => classifyAction(table, action, dialect)).map(finding => ({ ...finding, table: keyOf(table) }));
  }
  if ((m = DROP_INDEX.exec(text))) {
    return [{ rule: 'sql.drop-index', severity: 'potentially-breaking', subject: displayName(m[2] ?? m[1]), table: m[2] ? keyOf(m[2]) : undefined }];
  }
  if (dialect === 'postgresql' && (m = CREATE_INDEX.exec(text))) {
    return [{ rule: 'sql.create-index-blocking', severity: 'potentially-breaking', subject: displayName(m[1]), table: keyOf(m[1]) }];
  }
  if ((m = DELETE_FROM.exec(text) ?? UPDATE.exec(text)) && !HAS_WHERE.test(text)) {
    return [{ rule: 'sql.write-without-where', severity: 'potentially-breaking', subject: displayName(m[1]), confidence: 'medium', table: keyOf(m[1]) }];
  }
  return [];
}

/** Statements of `after` that are not already present in `before` (multiset difference). */
function addedStatements(after: readonly SqlStatement[], before: readonly SqlStatement[]): SqlStatement[] {
  const remaining = new Map<string, number>();
  for (const statement of before) remaining.set(statement.text, (remaining.get(statement.text) ?? 0) + 1);
  return after.filter(statement => {
    const count = remaining.get(statement.text) ?? 0;
    if (count > 0) remaining.set(statement.text, count - 1);
    return count === 0;
  });
}

/**
 * Static, statement-level analysis of a SQL file. New files are analyzed whole;
 * modified files only for statements that were not already in the baseline.
 * Nothing is ever executed against a database.
 */
export function analyzeSql(change: DocumentChange): Evidence[] {
  const { path: file, status, before, after } = change;
  const evidence: Evidence[] = [];
  const base = { analyzer: 'sql', file } as const;

  if (isMigrationPath(file) && (status === 'deleted' || before !== undefined)) {
    evidence.push(createEvidence({ ...base, rule: 'sql.migration-edited', severity: 'potentially-breaking', confidence: 'medium', subject: file, location: 'file' }));
  }
  if (after === undefined) return evidence;

  const dialect = detectDialect(after);
  const parsed = splitStatements(after, dialect);
  const statements = before === undefined ? parsed : addedStatements(parsed, splitStatements(before, detectDialect(before)));

  // Tables created earlier in the same file are empty and unreferenced: schema risks on them are not real.
  const analyzed = new Set(statements.map(statement => statement.index));
  const created = new Set<string>();
  for (const statement of parsed) {
    const createdTable = CREATE_TABLE.exec(statement.text);
    if (createdTable) created.add(keyOf(createdTable[1]));
    if (!analyzed.has(statement.index)) continue;
    for (const finding of classifyStatement(statement.text, dialect)) {
      if (finding.table && created.has(finding.table)) continue;
      evidence.push(createEvidence({
        ...base,
        rule: finding.rule,
        severity: finding.severity,
        confidence: finding.confidence ?? 'high',
        subject: finding.subject,
        location: `statement[${statement.index}]`,
      }));
    }
  }
  return evidence;
}
