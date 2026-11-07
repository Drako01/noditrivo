import * as vscode from 'vscode';
import * as path from 'node:path';
import { getChangedFiles } from './core/git';
import { analyzeImpact, type ImpactReport } from './core/impact';

const supported = '**/*.{js,jsx,ts,tsx,mjs,cjs}';

async function runAnalysis(root: vscode.WorkspaceFolder, baseline: string): Promise<ImpactReport> {
  const changedFiles = await getChangedFiles(root.uri.fsPath, baseline);
  const found = await vscode.workspace.findFiles(new vscode.RelativePattern(root, supported), '**/{node_modules,dist,build,.next,coverage}/**', 3000);
  const sources = new Map<string,string>();
  for (const uri of found) {
    const rel = path.relative(root.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > 1024 * 1024) continue;
      sources.set(rel, Buffer.from(bytes).toString('utf8'));
    } catch {
      // Unreadable files cannot constitute verified evidence.
    }
  }
  return analyzeImpact(baseline, changedFiles, sources);
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function render(report: ImpactReport | undefined, error?: string): string {
  const findings = report?.findings.map(f => `<li><strong>${escapeHtml(f.affectedFile)}</strong> imports <code>${escapeHtml(f.changedFile)}</code><div class="muted">${escapeHtml(f.evidence)}</div></li>`).join('') ?? '';
  const notes = report?.limitations.map(s=>`<li>${escapeHtml(s)}</li>`).join('') ?? '';
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Noditrivo</title><style>
  :root{color-scheme:light dark}body{font-family:var(--vscode-font-family,Arial),sans-serif;color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:28px;max-width:1050px;margin:auto}
  header{display:flex;align-items:center;gap:15px;margin-bottom:20px} .mark{font-size:34px;color:#54d8f5}h1{margin:0;font-size:25px}.muted{color:var(--vscode-descriptionForeground);font-size:13px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:14px;margin:24px 0}.tile,.panel{border:1px solid var(--vscode-panel-border,#405168);border-radius:10px;padding:17px}.number{font-size:32px;font-weight:700}.panel{margin-bottom:15px}li{margin:12px 0;overflow-wrap:anywhere}code{color:#54d8f5}h2{font-size:17px}.error{color:var(--vscode-errorForeground)} </style></head><body>
  <header><div class="mark">◉</div><div><h1>Noditrivo</h1><div class="muted">Change Impact Intelligence · Local-first · Evidence-based</div></div></header>
  ${error?`<p class="error">${escapeHtml(error)}</p>`:''}
  <p class="muted">Baseline: ${escapeHtml(report?.baseline ?? 'not analyzed')} · Read-only preview</p>
  <div class="grid"><div class="tile"><div class="number">${report?.changedFiles.length ?? '–'}</div><div class="muted">Changed files</div></div><div class="tile"><div class="number">${report?.findings.length ?? '–'}</div><div class="muted">Verified direct imports</div></div></div>
  <section class="panel"><h2>Direct dependency evidence</h2>${findings?`<ul>${findings}</ul>`:'<p class="muted">No direct import relationships found in the inspected files.</p>'}</section>
  <section class="panel"><h2>Scope and limitations</h2><ul>${notes||'<li>Run Noditrivo: Analyze Changes to begin.</li>'}</ul></section>
  </body></html>`;
}

export function activate(context: vscode.ExtensionContext): void {
  let panel: vscode.WebviewPanel | undefined;
  const open = (): vscode.WebviewPanel => {
    if (panel) {panel.reveal(vscode.ViewColumn.One); return panel;}
    panel = vscode.window.createWebviewPanel('noditrivo.controlCenter','Noditrivo Control Center',vscode.ViewColumn.One,{enableScripts:false,retainContextWhenHidden:true});
    panel.webview.html=render(undefined);
    panel.onDidDispose(()=>{panel=undefined;},null,context.subscriptions);
    return panel;
  };
  context.subscriptions.push(vscode.commands.registerCommand('noditrivo.openControlCenter',open));
  context.subscriptions.push(vscode.commands.registerCommand('noditrivo.analyzeChanges',async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {vscode.window.showWarningMessage('Noditrivo requires an open workspace.'); return;}
    const root = folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(folders.map(f=>({label:f.name,folder:f})),{placeHolder:'Select Git workspace'}).then(s=>s?.folder);
    if (!root) return;
    const baseline=await vscode.window.showInputBox({prompt:'Compare against Git baseline (branch, tag or commit)',value:'HEAD',validateInput:v=> /^[A-Za-z0-9._/~-]+$/.test(v)&&!v.startsWith('-')?null:'Invalid Git ref'});
    if (!baseline) return;
    const view=open();
    try {
      const report=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Noditrivo: analyzing changes…'},()=>runAnalysis(root,baseline));
      view.webview.html=render(report);
    } catch(e) {
      const message=e instanceof Error?e.message:String(e);
      view.webview.html=render(undefined,message);
      vscode.window.showErrorMessage('Noditrivo: '+message);
    }
  }));
}
export function deactivate(): void {}
