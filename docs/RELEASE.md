# Noditrivo — Manual release readiness

Publishing is never triggered by a merge: `.github/workflows/publish.yml` only runs from an owner-created protected `v*` tag (or a manually confirmed dispatch) and each registry sits behind a protected environment that needs approval. A person runs every manual step below.

## Automated gates (run locally)
1. `npm ci`
2. `npm run package` — runs build, all tests (unit, fixtures, simulated-host functional tests, security checks, performance budgets), `vsce package` and the VSIX smoke test (`scripts/smoke-vsix.cjs`: contents policy, unpack in a clean temp directory, activation and analysis of the unpacked build).
3. `npm run bench` — optional, prints timings on the synthetic medium/large repositories.
4. `npm audit --omit=dev` — review before release.

## Manual gates (not automated)
- [ ] Install the VSIX in a real VS Code (`code --install-extension noditrivo-<version>.vsix`) and run **Noditrivo: Analyze Changes** on a real repository.
- [ ] Open a repository in Restricted Mode and confirm the analysis is refused with the localized message.
- [x] Keyboard-only and screen-reader pass; light, dark and high-contrast themes (Phase 1 QA; signed off by the maintainer).
- [x] README screenshots captured from the running UI (`npm run screenshots`); re-run them when the UI changes.
- [ ] Multi-root workspace: folder picker and boundaries.
- [ ] Add a 128×128 PNG `icon` to `package.json` (the Marketplace rejects SVG icons).
- [ ] Confirm the `armotusitio` publisher exists on the Marketplace and Open VSX; confirm trademark clearance for the name.
- [ ] Decide whether to bundle the extension (esbuild) — `vsce` warns that 257 files ship because `yaml` is not bundled.
- [ ] Update `CHANGELOG.md`, bump `version`, tag.

## Publishing (only with explicit approval)
`.github/workflows/publish.yml` publishes only when all of these hold: `package.json` is not private, the version has a finalized `## [x.y.z] — ` heading in `CHANGELOG.md`, a protected `vX.Y.Z` tag points at the exact commit being built, and the owner approves the `marketplace`, `open-vsx` and `github-release` environments. It rebuilds nothing after verification: the same VSIX (checked by SHA-256) goes to both registries, with provenance attestation and an SBOM.

One-time owner setup (not automated): create those three environments with required reviewers, enable trusted publishing (OIDC) for the Marketplace and Open VSX publisher, and import `.github/rulesets/*.json` (**Settings → Rules → Rulesets**). No personal access token should ever be stored in the repository or CI.
