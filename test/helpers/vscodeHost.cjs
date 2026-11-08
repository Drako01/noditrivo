/**
 * A minimal in-process stand-in for the `vscode` module, backed by the real filesystem.
 * It lets the compiled extension (`dist/extension.js`) be activated and driven end to end
 * (commands, Webview messages, workspace trust, cancellation) without launching VS Code.
 * It is NOT the real host: behavior that depends on VS Code itself is covered by manual QA.
 */
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

class CancellationError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'CancellationError';
  }
}

class Uri {
  constructor(fsPath) {
    this.fsPath = fsPath;
    this.scheme = 'file';
  }
  static file(fsPath) { return new Uri(path.resolve(fsPath)); }
  static joinPath(base, ...parts) { return new Uri(path.join(base.fsPath, ...parts)); }
  toString() { return `file://${this.fsPath.replace(/\\/g, '/')}`; }
}

class RelativePattern {
  constructor(base, pattern) {
    this.base = base;
    this.baseUri = base.uri;
    this.pattern = pattern;
  }
}

const SOURCE = /\.(?:js|jsx|ts|tsx|mjs|cjs)$/;
const EXCLUDED = new Set(['node_modules', 'dist', 'build', '.next', 'coverage', '.git']);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE.test(entry.name)) out.push(Uri.file(full));
  }
  return out;
}

/** Mutable scenario the stable `vscode` object reads from; replaced by `createHost`. */
let current;

const vscode = {
  CancellationError,
  Uri,
  RelativePattern,
  ViewColumn: { One: 1 },
  ProgressLocation: { Notification: 15 },
  env: { get language() { return current.language; } },
  commands: {
    registerCommand(id, handler) {
      current.commands.set(id, handler);
      return { dispose() { current.commands.delete(id); } };
    },
  },
  window: {
    createWebviewPanel(viewType, title, column, options) {
      const listeners = { receive: [], dispose: [] };
      const panel = {
        viewType, title, column, options, disposed: false, revealed: 0,
        webview: {
          _html: '',
          get html() { return this._html; },
          set html(value) { this._html = value; panel.renders.push(value); },
          onDidReceiveMessage(listener) { listeners.receive.push(listener); return { dispose() {} }; },
        },
        renders: [],
        reveal() { panel.revealed++; },
        onDidDispose(listener) { listeners.dispose.push(listener); return { dispose() {} }; },
        /** Simulates the Webview posting a message to the extension. */
        post(message) { for (const listener of listeners.receive) listener(message); },
        close() { panel.disposed = true; for (const listener of listeners.dispose) listener(); },
      };
      current.panels.push(panel);
      return panel;
    },
    async showQuickPick(items) { return current.quickPick ? current.quickPick(items) : items[0]; },
    async showInputBox() { return current.inputBox; },
    async showErrorMessage(message) { current.errors.push(message); },
    async withProgress(_options, task) {
      const token = {
        isCancellationRequested: current.cancelled,
        onCancellationRequested(listener) {
          if (current.cancelled) listener();
          return { dispose() {} };
        },
      };
      return task({ report() {} }, token);
    },
  },
  workspace: {
    get isTrusted() { return current.trusted; },
    get workspaceFolders() { return current.folders; },
    get textDocuments() { return current.documents; },
    async findFiles(pattern, _exclude, maxResults) {
      return walk(pattern.baseUri.fsPath, []).slice(0, maxResults);
    },
    fs: {
      async stat(uri) { return { size: fs.statSync(uri.fsPath).size }; },
      async readFile(uri) { return fs.readFileSync(uri.fsPath); },
    },
  },
};

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  const original = Module._load;
  Module._load = function patched(request, ...rest) {
    return request === 'vscode' ? vscode : original.call(this, request, ...rest);
  };
}

/**
 * Starts a fresh scenario. `rootPath` becomes the single workspace folder (or pass `folders`).
 * Returns the scenario so tests can inspect panels, errors and registered commands.
 */
function createHost({ rootPath, folders, trusted = true, language = 'en', documents = [], cancelled = false, initialState = new Map() } = {}) {
  install();
  const resolved = folders ?? (rootPath ? [{ name: path.basename(rootPath), uri: Uri.file(rootPath), index: 0 }] : undefined);
  current = {
    language, trusted, folders: resolved, documents, cancelled,
    commands: new Map(), panels: [], errors: [], inputBox: undefined, quickPick: undefined,
  };
  const state = new Map(initialState);
  const context = {
    subscriptions: [],
    workspaceState: {
      get: key => state.get(key),
      async update(key, value) { state.set(key, JSON.parse(JSON.stringify(value))); },
    },
  };
  return Object.assign(current, { context, storage: state });
}

/** Loads a fresh copy of an extension entry point (so `activate` state does not leak between tests). */
function loadExtension(entry) {
  install();
  delete require.cache[require.resolve(entry)];
  return require(entry);
}

module.exports = { createHost, loadExtension, Uri };
