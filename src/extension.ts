import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { AnalysisError, isCancelled, runAnalysis } from './analysis';
import { isValidGitBaseline } from './core/git';
import { resolveLocale, translate, type MessageKey, type MessageParams } from './i18n';
import { renderControlCenter, type ViewState } from './ui/controlCenter';

const DEFAULT_BASELINE = 'HEAD';

const isAnalyzeMessage = (message: unknown): message is { type: 'analyze'; baseline: string } =>
  typeof message === 'object' && message !== null &&
  (message as { type?: unknown }).type === 'analyze' &&
  typeof (message as { baseline?: unknown }).baseline === 'string';

export function activate(context: vscode.ExtensionContext): void {
  const locale = resolveLocale(vscode.env.language);
  const tr = (key: MessageKey, params?: MessageParams): string => translate(locale, key, params);

  let panel: vscode.WebviewPanel | undefined;
  let state: ViewState = { baseline: DEFAULT_BASELINE, phase: 'idle' };
  let busy = false;

  const setState = (next: ViewState): void => {
    state = next;
    if (panel) panel.webview.html = renderControlCenter(state, locale, randomBytes(16).toString('base64'));
  };

  const open = (): void => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.One);
      return;
    }
    panel = vscode.window.createWebviewPanel('noditrivo.controlCenter', 'Noditrivo Control Center', vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [],
      retainContextWhenHidden: true,
    });
    panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage((message: unknown) => {
      if (isAnalyzeMessage(message)) void analyze(message.baseline);
    }, null, context.subscriptions);
    setState(state);
  };

  const pickRoot = async (folders: readonly vscode.WorkspaceFolder[]): Promise<vscode.WorkspaceFolder | undefined> =>
    folders.length === 1
      ? folders[0]
      : (await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, folder })), { placeHolder: tr('cmd.pickFolder') }))?.folder;

  const fail = (baseline: string, message: string): void => {
    setState({ baseline, phase: 'error', error: message });
    void vscode.window.showErrorMessage(message);
  };

  const analyze = async (baseline: string): Promise<void> => {
    if (busy) return;
    open();
    if (!vscode.workspace.isTrusted) return fail(baseline, tr('error.untrusted'));
    if (!isValidGitBaseline(baseline)) return fail(baseline, tr('error.invalidBaseline'));
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return fail(baseline, tr('error.noWorkspace'));

    busy = true;
    try {
      const root = await pickRoot(folders);
      if (!root) return;
      setState({ baseline, phase: 'running' });
      const report = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: tr('cmd.progress'), cancellable: true },
        (_progress, token) => runAnalysis(root, baseline, token),
      );
      setState({ baseline, phase: 'done', report });
    } catch (error) {
      if (isCancelled(error)) setState({ baseline, phase: 'cancelled' });
      else if (error instanceof AnalysisError) fail(baseline, tr(error.key, error.params));
      else fail(baseline, tr('error.failed', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      busy = false;
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('noditrivo.openControlCenter', open),
    vscode.commands.registerCommand('noditrivo.analyzeChanges', async () => {
      const baseline = await vscode.window.showInputBox({
        prompt: tr('cmd.baselinePrompt'),
        value: state.baseline,
        validateInput: value => (isValidGitBaseline(value) ? null : tr('error.invalidBaseline')),
      });
      if (baseline) await analyze(baseline);
    }),
  );
}

export function deactivate(): void {}
