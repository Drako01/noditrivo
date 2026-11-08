# Noditrivo — Implementation Checklist

Updated: 2026-11-07.

## Implemented in bootstrap branch
- [x] Public repository initialized; feature branch used instead of direct main development
- [x] Package manifest, strict TypeScript configuration and license
- [x] Control Center in the central editor, no sidebar dependency
- [x] Read-only Git baseline comparison and direct JS/TS import evidence
- [x] Deterministic core tests authored and executed
- [x] Limitation statements displayed in the UI

## Phase 1 completion
- [x] Analyze action inside the Control Center (baseline form) and via command palette
- [x] Untracked files, rename detection (both paths), deletions, unsaved editor buffers
- [x] Workspace trust, cancellable analysis, folder boundary checks, size/count limits surfaced as coverage
- [x] English/Spanish localization
- [x] `npm install` + `npm run check` executed: build OK, 22/22 tests passing
- [ ] Manual keyboard/screen-reader and light/dark visual QA inside VS Code

## Not validated yet
- [ ] Manual end-to-end testing inside VS Code (the `vscode`-dependent layer `src/analysis.ts` and `src/extension.ts` is type-checked but not exercised by automated tests)
- [ ] Verify VSIX packaging
- [ ] Inspect real screens and capture screenshots
- [ ] Security and multi-root QA
- [ ] CI jobs (deliberately not enabled)
- [ ] Release or marketplace publication (not authorized)

## Known limitations
The baseline compares the working tree (tracked changes, untracked files and unsaved editors) against a Git ref; this is not full Git branch/PR impact analysis. Analysis covers only direct relative JS/TS imports; it does not detect transitive edges, aliases, runtime behavior, database migrations, APIs, or infrastructure changes. Unsaved editors replace on-disk content only for files found by the scan. A reported import is evidence of a dependency, **not** evidence of a defect.

## Working rule
Retest only impacted areas when they change; run full verification at release gates. Avoid duplicated validations without justification.
