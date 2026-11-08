/**
 * Shared heuristics for credentials committed in infrastructure files.
 * Analyzers report only the *name* of the key; a secret value is never copied into evidence.
 */
const SECRET_NAME = /(?:^|[_-])(?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)(?:$|[_-])/i;
/** Names that point at a secret (ARN, file, id…) or configure it rather than hold it. */
const NOT_A_SECRET_VALUE = /[_-](?:arn|id|name|file|path|url|uri|endpoint|version|length|ttl|expiry|enabled|type)$/i;

export const isSecretName = (name: string): boolean => SECRET_NAME.test(name) && !NOT_A_SECRET_VALUE.test(name);

/** A non-empty value that is not an interpolation or template placeholder. */
export const isLiteralValue = (value: string): boolean => value.trim() !== '' && !/\$|\{\{/.test(value);
