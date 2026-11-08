## Problem and scope

<!-- What problem does this fix? Link an issue where appropriate. Keep the PR focused. -->

Closes #

## What changed

<!-- List the meaningful behavioral changes and affected modules (analyzers, Control Center, manifest, docs). -->

## Measurable acceptance criteria

- [ ] Expected success behavior is demonstrated
- [ ] Failure, edge and cancellation behavior is covered
- [ ] Analyzer changes add positive and negative fixtures; the false-positive gate stays at 0
- [ ] Existing commands, workspace trust behavior and read-only guarantees remain compatible

## Verification and evidence

| Check | Result (PASS/FAIL/WARN/NOT RUN) | Command / CI URL / explanation |
|---|---|---|
| Build, unit and fixture tests | NOT RUN | `npm run check` |
| Simulated-host functional tests | NOT RUN | included in `npm run check` |
| VSIX packaging and smoke test | NOT RUN | `npm run package` |
| Performance budgets | NOT RUN | `npm run bench` (only if analyzers or cache changed) |
| README screenshots refreshed | NOT RUN | `npm run screenshots` (only if the UI changed) |
| Security and privacy impact | NOT RUN | |

## Security, performance and compatibility

<!-- Describe permissions, child processes, files read, data that could reach evidence, schema or cache-format changes and fallback behavior. Do not paste tokens, private repository paths or logs. -->

## Documentation and release

- [ ] README and ES/EN strings reflect any user-visible change
- [ ] Master plan and checklist updated with actual evidence
- [ ] CHANGELOG updated if needed
- [ ] `ANALYZER_VERSION` bumped when analyzer output changes (the fingerprint test enforces it)
- [ ] No secrets, proprietary assets, unrelated rewrites or unapproved brand changes
- [ ] No unapproved publishing workflow or ruleset weakening

**Merge/release are explicit maintainer decisions.** Read the [threat model](../docs/THREAT_MODEL.md) and the [release readiness guide](../docs/RELEASE.md).
