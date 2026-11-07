# Noditrivo — Implementation Checklist

Updated: 2026-11-07.

## Implemented in bootstrap branch
- [x] Public repository initialized; feature branch used instead of direct main development
- [x] Package manifest, strict TypeScript configuration and license
- [x] Control Center in the central editor, no sidebar dependency
- [x] Read-only Git baseline comparison and direct JS/TS import evidence
- [x] Deterministic core tests authored
- [x] Limitation statements displayed in the UI

## Not validated yet
- [ ] Install dependencies; run build and automated tests
- [ ] Manual end-to-end testing inside VS Code
- [ ] Verify VSIX packaging
- [ ] Inspect real screens and capture screenshots
- [ ] Security, accessibility, multi-root and internationalization QA
- [ ] CI jobs (deliberately not enabled)
- [ ] Release or marketplace publication (not authorized)

## Known limitations
The baseline `HEAD` compares tracked working tree changes; this is not full Git branch/PR impact analysis. No untracked-file or unsaved-buffer coverage yet. Analysis covers only direct relative JS/TS imports; it does not detect transitive edges, aliases, runtime behavior, database migrations, APIs, or infrastructure changes. A reported import is evidence of a dependency, **not** evidence of a defect.

## Working rule
Retest only impacted areas when they change; run full verification at release gates. Avoid duplicated validations without justification.
