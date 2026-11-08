# Noditrivo — Brand Identity & Design System

> Brand direction approved; vector assets included here are editable reconstructions, not pixel-identical exports of the original generated concept. The original moodboard is preserved in the conversation and available separately. Formal trademark clearance is still pending.

## Brand
- **Name:** Noditrivo (note correct spelling; not *Norditrivo*)
- **Descriptor:** Change Impact Intelligence
- **Tagline EN:** Know what changes before it breaks.
- **Tagline ES:** Conocé el impacto de tus cambios antes de que algo falle.
- **Publisher:** armotusitio
- **Attribution:** Alejandro Di Stefano — ArmoTuSitio
- **Concept:** The central node represents a source change; outward edges represent dependencies and possible downstream impact. Rooted in the Italian *nodi* ("nodes").
- **Values:** verifiable, predictive without overclaiming, accessible, local-first, calm and professional.

## Direction: Dark Premium / Technical Intelligence
Preserve the previously approved Impactivo/Trazivo moodboard aesthetic, replacing only the brand name. Do not change the overall colors, visual language, or icon concept without review.

### Color tokens
| Role | Token | Hex |
|---|---|---|
| Primary background | midnight | `#0B1020` |
| Secondary surface | graphite | `#141D2E` |
| Primary signal / central node | signal-cyan | `#54D8F5` |
| Relationship / linked nodes | dependency-violet | `#A78BFA` |
| Attention indicator | attention-amber | `#F5B544` |
| Primary text (dark mode) | cloud-white | `#EAF0F7` |

Cyan identifies the origin of a change; violet shows relationships; amber can indicate items requiring attention. **Do not infer severity solely from brand colors.** Real diagnostics must use accessible semantic colors, icons, labels and documented criteria.

### Typography
- **Inter:** identity and general UI copy, with system/VS Code font fallback.
- **JetBrains Mono:** technical metadata, paths, Git references and code.
- No remote font loading from extension webviews. Prefer VS Code theme font variables to preserve user preferences.

## Logo system
- `media/brand/noditrivo-logo-dark.svg`: horizontal lockup, dark background.
- `media/brand/noditrivo-logo-light.svg`: horizontal lockup, light background.
- `media/brand/noditrivo-symbol.svg`: standalone color symbol for Marketplace and docs.
- `media/brand/noditrivo-activity-bar.svg`: single-color, stroke-based VS Code Activity Bar symbol. Must inherit the current theme when embedded.
- `media/brand/tokens.css`: design tokens for documentation/prototypes. Runtime Webviews must prefer VS Code theme colors.

**Brand usage:** use the standalone icon on square surfaces. Ensure small-size legibility at 16, 24, 32, 64 and 128 px; avoid gradients and tiny details in Activity Bar. Respect minimum clear space equal to one node diameter. Do not stretch, rotate or recolor the logo arbitrarily.

## UX/UI specification
The **Control Center must open inside the central editor area** using a VS Code WebviewPanel, not a sidebar-only view.

### Information architecture
1. **Overview:** workspace, compared Git baseline, coverage and analysis timestamp; risk summary segregated by *verified evidence* vs *hypothesis*.
2. **Change Impact:** changed files, direct and transitive dependency graph (only when analyzers support it), impact paths and confidence.
3. **Evidence:** file/line references, API schema diffs, migration evidence, infrastructure references with explicit limitations.
4. **Verification:** recommended targeted checks with reason and execution status; never report tests as passed unless executed.
5. **History:** baseline comparison, newly introduced findings, preexisting findings, resolved findings (future milestone).
6. **Settings:** workspaces, analyzers, privacy and language choices.

### Interaction model
- Side navigation within the central Webview is allowed; primary content must remain in a wide editor tab.
- Every risk card must expose **what changed**, **what depends on it**, **source evidence**, **confidence**, **what to verify**.
- Clicking a file reference navigates to its source, never runs a mutation.
- Graph mode must have a **keyboard-friendly list/table equivalent**.
- Allow filtering by source, scope and severity; preserve all evidence.
- Use progressive disclosure rather than overcrowded dashboards.
- Language: ES and EN, accessible contrast and keyboard navigation. Light/dark variants follow VS Code theme tokens.
- Runtime security: restrictive CSP, sanitized content, script nonce when scripts become needed, no silent external requests.

### User-facing states
- Empty: explain how to select a workspace and baseline.
- Analyzing: progress + cancellation; never imply a result until complete.
- Partial: show what was inspected and why other analyzers were skipped.
- Results: evidence-driven findings and clear impact boundaries.
- Error: actionable failure message, safe retry.
- No findings: "No evidence found within inspected scope," never "Your project is safe."

## Assets and acceptance criteria
- [x] Written visual identity and palette
- [x] Initial editable SVG brand family
- [x] Design tokens
- [x] UX structure and state specifications
- [ ] Attach original generated moodboard as a binary file to the repository
- [ ] Confirm these SVG reconstructions visually against the approved moodboard
- [ ] Export verified PNG icons at 16/32/64/128/256 px
- [ ] Capture screenshots from the **running extension** for README
- [ ] Test light/dark and accessibility
- [ ] Verify name/mark registry availability before publication

## Release guard
No merge, tag, publishing automation or Marketplace/Open VSX release is authorized by this brand kit. Any finished screenshot must represent a real running UI, not a conceptual mockup.
