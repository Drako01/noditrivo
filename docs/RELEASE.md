# Noditrivo — Manual release readiness

Nothing here is automated on purpose: **no workflow publishes**, and `package.json` has no publish script. A person runs every step.

## Automated gates (run locally)
1. `npm ci`
2. `npm run package` — runs build, all tests (unit, fixtures, simulated-host functional tests, security checks, performance budgets), `vsce package` and the VSIX smoke test (`scripts/smoke-vsix.cjs`: contents policy, unpack in a clean temp directory, activation and analysis of the unpacked build).
3. `npm run bench` — optional, prints timings on the synthetic medium/large repositories.
4. `npm audit --omit=dev` — review before release.

## Manual gates (not automated)
- [ ] Install the VSIX in a real VS Code (`code --install-extension noditrivo-<version>.vsix`) and run **Noditrivo: Analyze Changes** on a real repository.
- [ ] Open a repository in Restricted Mode and confirm the analysis is refused with the localized message.
- [ ] Keyboard-only and screen-reader pass; light, dark and high-contrast themes (Phase 1 QA).
- [ ] Capture the README screenshots from that running UI (none are committed yet).
- [ ] Multi-root workspace: folder picker and boundaries.
- [ ] Add a 128×128 PNG `icon` to `package.json` (the Marketplace rejects SVG icons).
- [ ] Confirm the `armotusitio` publisher exists on the Marketplace and Open VSX; confirm trademark clearance for the name.
- [ ] Decide whether to bundle the extension (esbuild) — `vsce` warns that 257 files ship because `yaml` is not bundled.
- [ ] Update `CHANGELOG.md`, bump `version`, tag.

## Publishing (only with explicit approval)
`vsce publish` / `ovsx publish` need a personal access token that must never be stored in the repository or CI without a deliberate decision.
