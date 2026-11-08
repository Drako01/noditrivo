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
- [ ] Docker Compose references and environment dependencies
- [ ] Kubernetes manifest relationships
- [ ] Terraform plan/static references
- [ ] No implicit connections to production or secret disclosure

## Phase 4 — Enterprise-grade validation
- [ ] Incremental cache with invalidation and deterministic replay
- [ ] Baseline comparison (new / existing / resolved findings)
- [ ] Security threat modeling and workspace trust tests
- [ ] Functional VS Code integration tests
- [ ] Performance benchmarks for medium and large repositories
- [ ] Packaging and smoke tests of installed VSIX
- [ ] README screenshots from actual running UI
- [ ] Marketplace/Open VSX metadata and manual release readiness

## Definition of Done
Every shipped finding has traceable evidence and explicit analyzer scope. Changed-file and baseline semantics are documented. No implicit mutation of project, database or infrastructure. No claims of fully supported ecosystems without corresponding fixtures, tests and validations. Tests and package smoke must pass before publication. No automatic publishing enabled.
