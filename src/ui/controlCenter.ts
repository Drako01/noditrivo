import type { ChangedFile, ImpactReport } from '../core/impact';
import { translate, type Locale, type MessageKey, type MessageParams } from '../i18n';

export type ViewPhase = 'idle' | 'running' | 'done' | 'cancelled' | 'error';
export interface ViewState {
  readonly baseline: string;
  readonly phase: ViewPhase;
  readonly report?: ImpactReport;
  readonly error?: string;
}

/** Lists longer than this are truncated in the UI to keep the DOM small. */
export const MAX_LISTED_ITEMS = 200;

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const STYLE = `
:root{color-scheme:light dark}
body{font-family:var(--vscode-font-family,sans-serif);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:28px;max-width:1050px;margin:auto;line-height:1.5}
header{display:flex;align-items:center;gap:15px;margin-bottom:20px}
.mark{font-size:34px;color:var(--vscode-textLink-foreground)}
h1{margin:0;font-size:25px}h2{font-size:17px;margin-top:0}
.muted{color:var(--vscode-descriptionForeground);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:14px;margin:24px 0}
.tile,.panel{border:1px solid var(--vscode-panel-border,var(--vscode-contrastBorder,#808080));border-radius:10px;padding:17px}
.panel{margin-bottom:15px}.number{font-size:32px;font-weight:700}
ul{padding-left:20px}li{margin:10px 0;overflow-wrap:anywhere}
code{color:var(--vscode-textPreformat-foreground,inherit)}
form{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:6px}
label{display:block;font-weight:600;margin-bottom:4px}
input{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-contrastBorder,#808080));padding:5px 8px;min-width:260px}
button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:1px solid var(--vscode-contrastBorder,transparent);padding:6px 16px;cursor:pointer}
button:hover:not(:disabled){background:var(--vscode-button-hoverBackground)}
button:disabled{opacity:.6;cursor:not-allowed}
input:focus-visible,button:focus-visible,#status:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
#status{margin:12px 0}
.error{color:var(--vscode-errorForeground)}
.badge{font-size:12px;border:1px solid var(--vscode-panel-border,#808080);border-radius:4px;padding:0 6px;margin-left:6px}
`;

const SCRIPT = `
const api = acquireVsCodeApi();
const form = document.getElementById('analyze-form');
form.addEventListener('submit', (event) => {
  event.preventDefault();
  api.postMessage({ type: 'analyze', baseline: document.getElementById('baseline').value });
});
const status = document.getElementById('status');
if (status.dataset.focus === 'true') status.focus();
`;

export function renderControlCenter(state: ViewState, locale: Locale, nonce: string): string {
  const t = (key: MessageKey, params?: MessageParams): string => escapeHtml(translate(locale, key, params));
  const { report } = state;
  const running = state.phase === 'running';

  const more = (total: number): string =>
    total > MAX_LISTED_ITEMS ? `<li class="muted">${t('list.more', { count: total - MAX_LISTED_ITEMS })}</li>` : '';

  const changedItem = (file: ChangedFile): string =>
    `<li><code>${escapeHtml(file.path)}</code><span class="badge">${t(`status.${file.status}`)}</span>` +
    (file.oldPath ? ` <span class="muted">(${t('changed.renamedFrom', { oldPath: file.oldPath })})</span>` : '') + '</li>';

  const changedList = report
    ? report.changedFiles.length
      ? `<ul>${report.changedFiles.slice(0, MAX_LISTED_ITEMS).map(changedItem).join('')}${more(report.changedFiles.length)}</ul>`
      : `<p class="muted">${t('changed.none')}</p>`
    : '';

  const findingItems = report?.findings.slice(0, MAX_LISTED_ITEMS).map(f =>
    `<li><strong>${t('findings.item', { affected: f.affectedFile, changed: f.changedFile })}</strong>` +
    `<span class="badge">${t(`status.${f.changeStatus}`)}</span>` +
    `<div class="muted">${t('findings.evidence', { specifier: f.specifier, affected: f.affectedFile })}</div></li>`).join('') ?? '';

  const findings = report
    ? report.findings.length
      ? `<ul>${findingItems}${more(report.findings.length)}</ul>`
      : `<p class="muted">${t('findings.none')}</p>`
    : '';

  const evidenceItems = report?.evidence.slice(0, MAX_LISTED_ITEMS).map(item =>
    `<li><strong>${escapeHtml(item.subject)}</strong><span class="badge">${t(`severity.${item.severity}`)}</span>` +
    `<div>${t(`rule.${item.rule}`)}</div>` +
    `<div class="muted">${t('evidence.location', { file: item.file, location: item.location })}</div></li>`).join('') ?? '';

  const evidence = report
    ? report.evidence.length
      ? `<ul>${evidenceItems}${more(report.evidence.length)}</ul>`
      : `<p class="muted">${t('evidence.none')}</p>`
    : '';

  const coverage = report
    ? `<section class="panel" aria-labelledby="h-coverage"><h2 id="h-coverage">${t('section.coverage')}</h2><p class="muted">${t('coverage.line', {
      scanned: report.coverage.scannedFiles, large: report.coverage.skippedLarge, unreadable: report.coverage.skippedUnreadable,
    })}</p></section>`
    : '';

  const limitations = report
    ? `<ul>${report.limitations.map(code => `<li>${t(`limitation.${code}`)}</li>`).join('')}</ul>`
    : '';

  const statusText = state.phase === 'error' && state.error ? escapeHtml(state.error) : t(`phase.${state.phase}`);
  const statusClass = state.phase === 'error' ? ' class="error"' : '';
  const focusStatus = state.phase === 'done' || state.phase === 'error' || state.phase === 'cancelled';

  return `<!doctype html><html lang="${locale}"><head><meta charset="UTF-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Noditrivo</title><style nonce="${nonce}">${STYLE}</style></head><body>` +
    `<header><div class="mark" aria-hidden="true">◉</div><div><h1>Noditrivo</h1><div class="muted">${t('app.subtitle')}</div></div></header>` +
    `<main>` +
    `<form id="analyze-form"><div><label for="baseline">${t('form.baselineLabel')}</label>` +
    `<input id="baseline" name="baseline" type="text" value="${escapeHtml(state.baseline)}" required spellcheck="false" autocomplete="off" aria-describedby="baseline-help"></div>` +
    `<button type="submit"${running ? ' disabled aria-disabled="true"' : ''}>${t('form.analyze')}</button></form>` +
    `<p id="baseline-help" class="muted">${t('form.baselineHelp')} · ${t('app.readOnly')}</p>` +
    `<div id="status" role="status" aria-live="polite" tabindex="-1" data-focus="${focusStatus}"${statusClass}>${statusText}</div>` +
    `<div class="grid" aria-label="${t('section.scope')}"><div class="tile"><div class="number">${report?.changedFiles.length ?? '–'}</div><div class="muted">${t('tile.changed')}</div></div>` +
    `<div class="tile"><div class="number">${report?.findings.length ?? '–'}</div><div class="muted">${t('tile.findings')}</div></div>` +
    `<div class="tile"><div class="number">${report?.evidence.length ?? '–'}</div><div class="muted">${t('tile.evidence')}</div></div></div>` +
    (report ? `<section class="panel" aria-labelledby="h-changed"><h2 id="h-changed">${t('section.changed')}</h2>${changedList}</section>` : '') +
    (report ? `<section class="panel" aria-labelledby="h-findings"><h2 id="h-findings">${t('section.findings')}</h2>${findings}</section>` : '') +
    (report ? `<section class="panel" aria-labelledby="h-evidence"><h2 id="h-evidence">${t('section.evidence')}</h2>${evidence}</section>` : '') +
    coverage +
    (report ? `<section class="panel" aria-labelledby="h-scope"><h2 id="h-scope">${t('section.scope')}</h2>${limitations}</section>` : '') +
    `</main><script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}
