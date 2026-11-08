# Noditrivo — Enterprise AAAA Master Plan

Status: **proposed roadmap**, not a certification. Version target: **0.1.0**.

## Product boundary
Evidence-first, local-first, read-only analysis of changes and their possible impact on code, APIs, databases and infrastructure. Analysis does **not** guarantee absence of defects.

## Phase 1 — Git and local dependency evidence
- [x] Extension skeleton in strict TypeScript
- [x] Central editor Webview control center (read-only; CSP)
- [x] Git baseline diff via argument-safe process execution
- [x] Direct relative JS/TS import matching with source evidence
- [x] Core unit tests committed and passing (`npm run check`: 22/22)
- [x] User-facing analysis action from the Control Center (baseline form, nonce-based CSP, validated messages)
- [x] Correct handling of untracked files, rename detection, deletions and unsaved buffers
- [x] Workspace trust (`limited` capability + runtime check) and cancellation; multi-root boundaries and size limits (reported as coverage/limitations)
- [x] English/Spanish localization (UI, messages and manifest via `package.nls*.json`)
- [ ] Accessible keyboard navigation and light/dark visual QA (semantic markup, labels, focus styles and theme tokens implemented; **visual/keyboard QA in a running VS Code still pending**)

## Phase 2 — Contract and database impact
- [x] OpenAPI breaking-change compatibility analyzer (`src/core/openapi.ts`; YAML/JSON, 3.x/2.0 `paths`, local `$ref`, breaking changes only)
- [x] SQL migration parsing for PostgreSQL and MySQL/MariaDB (`src/core/sql.ts`; statement-level static parsing, dialect heuristics, never executed)
- [x] Versioned evidence schema and deduplication (`src/core/evidence.ts`, `schemaVersion: 1`, stable content-hash ids)
- [x] Positive/negative fixtures with measurable false-positive rates (`test/fixtures/`, gated in `test/contracts.test.cjs`: OpenAPI 21 cases, SQL 15 cases; false-positive rate 0, recall 1 on the corpus)

Phase 2 scope notes (also surfaced to users as limitations in the Control Center):
- OpenAPI: `allOf`/`oneOf`/`anyOf` changes are reported as info ("not compared"); external `$ref` is not resolved; only breaking changes are reported, additive ones stay silent.
- SQL: modified files only analyze statements not present at the baseline; editing or deleting a file under `migrations/` is flagged. Tables created earlier in the same file are exempt. `CREATE INDEX` without `CONCURRENTLY` is flagged only when PostgreSQL syntax is detected.
- Fixture metrics measure the corpus, not real-world precision: a zero rate here is a regression gate, not a guarantee.

## Phase 3 — Infrastructure adapters
- [x] Docker Compose references and environment dependencies (`src/core/compose.ts`; removed services/volumes/published ports, dangling `depends_on`/`links`/`volumes_from`/`network_mode`/`extends`, new env variables without default, image changes)
- [x] Kubernetes manifest relationships (`src/core/kubernetes.ts`; removed resources, workload→ConfigMap/Secret/PVC/ServiceAccount, Ingress→Service and HPA→target references, Service selector vs pod labels, immutable selector changes, removed Service ports)
- [x] Terraform plan/static references (`src/core/terraform.ts`; HCL block reader, resources/modules removed unless `moved`/`removed`, dangling references, variable/output contract, backend changes, and `terraform show -json` plans: delete/replace)
- [x] No implicit connections to production or secret disclosure (analyzers are pure functions over text, enforced by a source-level test; credential-looking literals are reported by key name only, values never reach evidence — gated in `test/infra.test.cjs`)
- [x] Positive/negative fixtures gated like Phase 2 (`test/fixtures/infra/`: 33 cases, 18 positive / 15 negative, false positives 0; every infrastructure rule is covered)

Phase 3 scope notes (also surfaced to users as a limitation in the Control Center):
- Only changed files are read: references to unchanged files are not resolved, so a dangling reference is reported only when its target existed at the baseline among the changed files. A resource moved between changed files (same Terraform directory) is not a removal.
- Terraform: `.tf` (HCL) and plan JSON only; `.tf.json` configuration, workspaces, provider schemas and state are not read. New input variables are reported only in directories that already had a changed file at the baseline.
- Kubernetes: Helm/Kustomize templates are not rendered (reported as "not compared"); CRD-specific relationships are not interpreted.
- Compose: `include`, profiles and `.env` file contents are not evaluated.

## Phase 4 — Enterprise-grade validation
- [x] Incremental cache with invalidation and deterministic replay (`src/core/cache.ts`; content-addressed keys salted with cache/evidence/analyzer versions, LRU bound, validated snapshot persisted in extension storage; a fingerprint test forces `ANALYZER_VERSION` bumps; `test/cache.test.cjs`)
- [x] Baseline comparison (new / existing / resolved findings) against the previous analysis of the same folder and Git baseline in the session (`src/core/compare.ts`, shown in the Control Center)
- [x] Security threat modeling and workspace trust tests (`docs/THREAT_MODEL.md`, `test/security.test.cjs`)
- [x] Functional integration tests of the compiled extension in a **simulated** VS Code host with real Git repositories (`test/extension.test.cjs`, `test/helpers/vscodeHost.cjs`)
- [ ] Functional tests inside the real VS Code (`@vscode/test-electron`; needs downloading VS Code, not done)
- [x] Performance benchmarks for medium (500 sources) and large (3000 sources, 1000 changed) synthetic repositories with budget gates (`scripts/benchmark.cjs`, `npm run bench`)
- [x] Packaging and smoke tests of the VSIX: contents policy, clean unpack and activation of the unpacked build in the simulated host (`scripts/smoke-vsix.cjs`; `npm run package`). Installation into a real VS Code is a manual gate
- [ ] README screenshots from actual running UI (requires a running VS Code; not captured)
- [x] Marketplace/Open VSX metadata (repository, keywords, banner, author) and manual release readiness (`docs/RELEASE.md`, `CHANGELOG.md`); icon, publisher/trademark confirmation and publication remain manual and unauthorized

Phase 4 scope notes:
- The comparison and the cache only live for the extension session/workspace storage; findings are matched by content-hash id, so a statement that moves inside a file appears as one resolved and one new item.
- The simulated host reproduces the `vscode` API surface the extension uses; it does not replace testing in the real editor.
- Benchmark budgets are loose regression ceilings on synthetic workloads, not performance guarantees.

## Definition of Done
Every shipped finding has traceable evidence and explicit analyzer scope. Changed-file and baseline semantics are documented. No implicit mutation of project, database or infrastructure. No claims of fully supported ecosystems without corresponding fixtures, tests and validations. Tests and package smoke must pass before publication. No automatic publishing enabled.
