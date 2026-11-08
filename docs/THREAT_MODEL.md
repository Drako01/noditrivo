# Noditrivo — Threat Model

Scope: the VS Code extension (0.1.0). Noditrivo reads a Git repository chosen by the user and shows evidence of change impact. Every control below that says "test" is executable in `test/security.test.cjs` unless noted.

## Assets
- The user's source code, migrations and infrastructure files (confidential; never leave the machine).
- Credentials that may appear inside those files (Compose/Terraform/Kubernetes literals).
- The integrity of the project, databases and infrastructure (must never be modified).
- The user's trust in reported evidence (a false claim is a defect).

## Trust boundaries
| Boundary | Untrusted side | Control |
|---|---|---|
| Workspace → extension | Repository contents, file names, `.git/config` | Workspace Trust, read-only analysis, argument-vector Git, `core.fsmonitor=false` |
| Webview → extension | Any message the page posts | Messages are type-checked; the baseline is validated against `^[A-Za-z0-9._/~-]+$` and must not start with `-` |
| Extension → Webview | Paths, subjects, specifiers taken from the repository | HTML escaping on every interpolation; CSP `default-src 'none'` with a per-render nonce; no resource roots |
| Extension storage → extension | The persisted analysis cache | Salted version key, every entry re-validated (shape, known rule, id re-derived from content); anything else is dropped |

## Threats and mitigations
| # | Threat | Mitigation | Verified by |
|---|---|---|---|
| T1 | Opening a hostile repository executes code through the extension | Untrusted workspaces are refused before any validation or process; `capabilities.untrustedWorkspaces = limited` | tests: manifest, call order, simulated host with `isTrusted = false` |
| T2 | Git option / command injection through the baseline | No shell, argument vector, strict allowlist, leading `-` rejected | test: 18 hostile refs rejected before any process |
| T3 | Repository config runs commands (`core.fsmonitor`, hooks) | `-c core.fsmonitor=false`, `GIT_OPTIONAL_LOCKS=0`, only `diff`, `ls-files`, `show` | test: source allowlist; behavioral test (precondition is Git-build dependent and reported as a diagnostic when it cannot be established) |
| T4 | XSS through file names or content shown in the Control Center | Escaping + CSP + nonce; no remote content | test: hostile strings in every rendered field, including comparison lists |
| T5 | Secret disclosure through evidence, UI or cache | Credential-looking literals are reported by key name only; values never enter evidence, so neither the UI nor the cache holds them | tests: infra secrets suite, cache snapshot scan |
| T6 | Exfiltration of code | No network modules, `fetch`, WebSocket or hosted models anywhere in `src/` | test: source scan |
| T7 | Mutation of the project, DB or infrastructure | No write/delete/edit API used; the only persisted data is the derived cache in extension storage | test: source scan |
| T8 | Cache poisoning / stale replay | Content-addressed keys salted with cache, evidence-schema and analyzer versions; fingerprint test forces a version bump when an analyzer changes; restored entries are re-validated | tests: cache suite |
| T9 | Denial of service with huge repositories | Limits on files, bytes and changed files, surfaced as coverage; batched reads; cancellation | benchmark budgets (500 and 3000 sources), extension limits |
| T10 | Path traversal outside the workspace | Paths are made relative to the folder and rejected when they leave it | code review (`toRootRelative`); not unit tested |

## Residual risks and non-goals
- The simulated host does not reproduce VS Code itself: Workspace Trust prompts, real Webview sandboxing and the CSP enforcement of the real renderer need manual QA (see `RELEASE.md`).
- A malicious Git binary or compromised VS Code is out of scope.
- Reported evidence is static and scoped; it never proves absence of defects.
- The cache lives in VS Code's workspace storage in clear text (derived paths and rule ids only).
