# Noditrivo — Enterprise AAAA Master Plan

Status: **proposed roadmap**, not a certification. Version target: **0.1.0**.

## Product boundary
Evidence-first, local-first, read-only analysis of changes and their possible impact on code, APIs, databases and infrastructure. Analysis does **not** guarantee absence of defects.

## Phase 1 — Git and local dependency evidence
- [x] Extension skeleton in strict TypeScript
- [x] Central editor Webview control center (read-only; CSP)
- [x] Git baseline diff via argument-safe process execution
- [x] Direct relative JS/TS import matching with source evidence
- [x] Core unit tests committed (execution not yet verified)
- [ ] User-facing analysis action from the Control Center
- [ ] Correct handling of untracked files, rename detection and unsaved buffers
- [ ] Workspace trust and cancellation; multi-root boundaries and size limits
- [ ] English/Spanish localization
- [ ] Accessible keyboard navigation and light/dark visual QA

## Phase 2 — Contract and database impact
- [ ] OpenAPI breaking-change compatibility analyzer
- [ ] SQL migration parsing for PostgreSQL and MySQL/MariaDB
- [ ] Versioned evidence schema and deduplication
- [ ] Positive/negative fixtures with measurable false-positive rates

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
