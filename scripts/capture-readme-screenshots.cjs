/**
 * Captures the README screenshots from the extension running in a real VS Code.
 *
 * It downloads a pinned VS Code build (cached in .vscode-test/), launches it with an isolated, temporary profile and
 * a throwaway Git workspace built from demo/, drives the real UI through Playwright's Electron support and writes
 * PNG files to docs/images/. Everything temporary is deleted on exit. Nothing is installed globally.
 *
 * Usage: npm run screenshots        (builds first)
 * Env:   NODITRIVO_VSCODE_VERSION   VS Code version to download (default: the pinned one below)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');
const { _electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const DEMO = path.join(ROOT, 'demo');
const OUT_DIR = path.join(ROOT, 'docs', 'images');
const VSCODE_VERSION = process.env.NODITRIVO_VSCODE_VERSION || '1.105.1';
const WINDOW = { width: 1440, height: 900 };
const MAX_PNG_BYTES = 300 * 1024;

const SETTINGS = {
  'workbench.colorTheme': 'Default Dark Modern',
  'window.zoomLevel': 0,
  'window.restoreWindows': 'none',
  'window.commandCenter': false,
  'window.title': '${activeEditorShort}${separator}${rootName}',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.welcomePage.walkthroughs.openOnInstall': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.layoutControl.enabled': false,
  'chat.disableAIFeatures': true,
  'security.workspace.trust.enabled': false,
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false,
  'editor.minimap.enabled': false,
  'git.autorefresh': false,
  'git.openRepositoryInParentFolders': 'never',
};

const copyTree = (from, to) => fs.cpSync(from, to, { recursive: true });

/** Builds a Git repository from demo/sample-workspace (the baseline commit). Edits are applied later with `applyEdits`. */
function createWorkspace(dir) {
  copyTree(path.join(DEMO, 'sample-workspace'), dir);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'Baseline');
}
const applyEdits = (step, dir) => copyTree(path.join(DEMO, 'sample-workspace-edits', step), dir);

/** The Control Center lives in a webview: an iframe (`.webview`) wrapping the extension's own iframe. */
const controlCenter = page => page.frameLocator('iframe.webview').frameLocator('#active-frame');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'noditrivo-shots-'));
  const workspace = path.join(scratch, 'sample-workspace');
  const userDataDir = path.join(scratch, 'user-data');
  const extensionsDir = path.join(scratch, 'extensions');
  let app;
  try {
    createWorkspace(workspace);
    fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify(SETTINGS, null, 2));

    const executablePath = await downloadAndUnzipVSCode({ version: VSCODE_VERSION, cachePath: path.join(ROOT, '.vscode-test') });
    console.log(`VS Code ${VSCODE_VERSION}: ${path.basename(executablePath)}`);

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath,
      env,
      args: [
        workspace,
        `--extensionDevelopmentPath=${ROOT}`,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--locale=en',
        '--force-device-scale-factor=1',
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []), // CI containers cannot use the Chromium sandbox
      ],
    });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.unmaximize();
      win.setContentSize(size.width, size.height);
      win.center();
    }, WINDOW);
    await page.locator('.monaco-workbench').waitFor();
    await page.locator('.explorer-folders-view').waitFor();
    const settle = (ms = 700) => page.waitForTimeout(ms);
    await settle(2500);

    const shoot = async name => {
      const file = path.join(OUT_DIR, name);
      await page.screenshot({ path: file });
      const { size } = fs.statSync(file);
      console.log(`  ${name}  ${(size / 1024).toFixed(0)} KB`);
      if (size > MAX_PNG_BYTES) throw new Error(`${name} is ${size} bytes, above the ${MAX_PNG_BYTES} byte budget`);
    };
    const typeInPalette = async text => {
      await page.keyboard.press('F1');
      await page.locator('.quick-input-widget').waitFor();
      await page.keyboard.type(text, { delay: 15 });
      await settle();
    };
    const runCommand = async title => {
      await typeInPalette(title);
      await page.keyboard.press('Enter');
    };
    const analyze = async () => {
      const frame = controlCenter(page);
      await frame.locator('button[type=submit]').click();
      await frame.locator('#h-findings').waitFor({ timeout: 30000 });
      await page.locator('.notifications-toasts.visible').waitFor({ state: 'detached', timeout: 15000 }).catch(() => undefined);
      await settle(1500);
    };

    console.log('Screenshots:');
    await typeInPalette('Noditrivo');
    await shoot('command-palette.png');
    await page.keyboard.press('Escape');

    await runCommand('Noditrivo: Open Control Center');
    await controlCenter(page).locator('button[type=submit]').waitFor();
    await settle(1000);
    await shoot('control-center-idle.png');

    applyEdits('step-1', workspace);
    await analyze();
    await shoot('analysis-overview.png');

    await controlCenter(page).locator('#h-evidence').scrollIntoViewIfNeeded();
    await settle();
    await shoot('analysis-evidence.png');

    applyEdits('step-2', workspace);
    await controlCenter(page).locator('#baseline').scrollIntoViewIfNeeded();
    await analyze();
    await controlCenter(page).locator('#h-compare').scrollIntoViewIfNeeded();
    await settle();
    await shoot('comparison.png');

    await runCommand('Noditrivo: Analyze Changes');
    await page.locator('.quick-input-widget input').waitFor();
    await settle();
    await shoot('analyze-baseline-prompt.png');
    await page.keyboard.press('Escape');
  } finally {
    if (app) await app.close().catch(() => undefined);
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
