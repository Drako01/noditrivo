# Noditrivo — Manual release readiness

Publishing starts when a PR is merged to `main` **and** that merge carries a releasable version (see below); every other merge is a no-op. Each registry sits behind a protected environment that needs approval. A person runs every manual step below.

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
- [x] 256×256 PNG `icon` in `package.json` (`media/brand/noditrivo-icon-256.png`; the Marketplace rejects SVG icons). Visually confirm it against the approved moodboard.
- [ ] Confirm the `armotusitio` publisher exists on the Marketplace and Open VSX; confirm trademark clearance for the name.
- [ ] Decide whether to bundle the extension (esbuild) — `vsce` warns that 257 files ship because `yaml` is not bundled.
- [ ] Update `CHANGELOG.md`, bump `version`, tag.

## Publishing (only with explicit approval)
`.github/workflows/publish.yml` runs on every push to `main` (and on `v*` tags or a confirmed manual dispatch) but publishes only when all of these hold: `package.json` is not private, the version has a finalized `## [x.y.z] — ` heading in `CHANGELOG.md`, no GitHub Release `vX.Y.Z` exists yet, and the owner approves the `marketplace`, `open-vsx` and `github-release` environments. The release job creates the `vX.Y.Z` tag at the built commit. To release: bump `version`, finalize the changelog entry and merge that PR. It rebuilds nothing after verification: the same VSIX (checked by SHA-256) goes to both registries, with provenance attestation and an SBOM.

One-time owner setup (not automated): create those three environments **with required reviewers — without them a qualifying merge publishes immediately** — enable trusted publishing (OIDC) for the Marketplace and Open VSX publisher, and import `.github/rulesets/*.json` (**Settings → Rules → Rulesets**). No personal access token should ever be stored in the repository or CI.
