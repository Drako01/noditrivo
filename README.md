# Noditrivo

**Change Impact Intelligence** · *Know what changes before it breaks.*

Local-first VS Code extension for evidence-based impact analysis across code, APIs, databases and infrastructure.

> **Pre-release prototype (0.1.0).** The initial implementation inspects only local JavaScript/TypeScript relative imports affected by tracked Git changes. Database, API and infrastructure analysis are roadmap items, not released functionality. Name subject to formal trademark clearance.

## Getting started (development)

```bash
npm install
npm run check
```

Open this repository in VS Code, press **F5** to launch an Extension Development Host, open a project with Git changes and run **Noditrivo: Analyze Changes** in the Command Palette. The Control Center opens in the main editor area.

Use `HEAD` as baseline for tracked working-tree changes. You can provide another Git ref for comparisons. Untracked files, unsaved changes, aliases and transitive relations are not covered yet.

## Privacy & safety

- Read-only by design. The extension does not write repository files, modify databases, deploy infrastructure or send code to hosted models.
- No shell invocation for Git; inputs are validated.
- Every displayed dependency reports its source evidence and clear limitations.
- No claim of runtime failure is inferred from an import alone.

## Roadmap

See [Master Plan](docs/ENTERPRISE_AAAA_MASTER_PLAN.md) and [Upgrade Checklist](docs/ENTERPRISE_AAAA_UPGRADE_CHECKLIST.md). Do not publish or merge until the verification gates are satisfied.

## License

MIT. Developed by Alejandro Di Stefano — [ArmoTuSitio](https://armotusitio.com.ar).
