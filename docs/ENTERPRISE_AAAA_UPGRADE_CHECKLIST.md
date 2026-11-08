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
- [x] Manual keyboard/screen-reader and light/dark visual QA inside VS Code (owned and signed off by the maintainer)

## Phase 3 completion
- [x] Docker Compose, Kubernetes and Terraform (HCL and `terraform show -json` plans) static analyzers with evidence, English/Spanish copy and a scope limitation in the UI
- [x] Fixture corpus `test/fixtures/infra/` (33 cases, 0 false positives) plus unit tests; `npm run check`: build OK, 43/43 tests passing
- [x] Pure analyzers (no process, network or filesystem access; enforced by a test); secret values never enter evidence

## Phase 4 completion
- [x] Incremental cache, deterministic replay and comparison with the previous analysis
- [x] Threat model and security tests; simulated-host functional tests; benchmarks (medium: ~115 ms cold, large: ~280 ms cold on the development machine)
- [x] `npm run package`: check 70 tests (69 pass, VSIX smoke skipped inside `check` and executed after `vsce package`), VSIX 257 files, smoke test passed
- [x] Marketplace metadata and `docs/RELEASE.md`

## Not validated yet
- [ ] Manual end-to-end testing inside a real VS Code (the host used by automated tests is simulated)
- [ ] Install the VSIX in a real VS Code
- [ ] Inspect real screens and capture screenshots
- [ ] Multi-root and Restricted Mode QA in the real editor
- [ ] Extension icon (PNG), publisher and trademark confirmation
- [ ] CI jobs (deliberately not enabled)
- [ ] Release or marketplace publication (not authorized)

## Known limitations
The baseline compares the working tree (tracked changes, untracked files and unsaved editors) against a Git ref; this is not full Git branch/PR impact analysis. Import tracing covers only direct relative JS/TS imports (no transitive edges, aliases or runtime behavior). OpenAPI, SQL migrations, Docker Compose, Kubernetes and Terraform are compared statically and only among the changed files, as described in the master plan scope notes. Unsaved editors replace on-disk content only for files found by the scan. A reported import is evidence of a dependency, **not** evidence of a defect.

## Working rule
Retest only impacted areas when they change; run full verification at release gates. Avoid duplicated validations without justification.
