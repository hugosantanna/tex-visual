// TeX Visual: an Overleaf-style visual editor for .tex files.
// The webview (media/main.js) renders the document with CodeMirror + KaTeX; this file keeps
// it in sync with the VS Code text document, which stays the single source of truth.
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const project = require('./lib/project');

const VIEW_TYPE = 'texVisual.editor';

function activate(context) {
  const provider = new TexVisualProvider(context);
  const openWith = (uri, side) => {
    const target = uri instanceof vscode.Uri ? uri
      : vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri
        : activeTabUri();
    if (!target) { vscode.window.showInformationMessage('TeX Visual: open a .tex file first.'); return undefined; }
    return vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE, side ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active);
  };
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('texVisual.open', (uri) => openWith(uri, false)),
    vscode.commands.registerCommand('texVisual.openToSide', (uri) => openWith(uri, true)),
    vscode.commands.registerCommand('texVisual.toggleSource', () => provider.command('toggleSource')),
    vscode.commands.registerCommand('texVisual.togglePreamble', () => provider.command('togglePreamble')),
    vscode.commands.registerCommand('texVisual.showSource', () => provider.showSource()),
    vscode.commands.registerCommand('texVisual.editAsText', () => vscode.commands.executeCommand('workbench.action.reopenTextEditor')),
    vscode.commands.registerCommand('texVisual._debug', (payload) => provider.debug(payload)),
    vscode.workspace.onDidChangeTextDocument((e) => provider.onDocChange(e)),
    vscode.workspace.onDidSaveTextDocument((d) => provider.onDocSaved(d)),
    vscode.window.onDidChangeTextEditorSelection((e) => provider.onTextSelection(e)),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('texVisual')) provider.pushConfig(); }),
  );
}

function deactivate() {}

function activeTabUri() {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab && tab.input;
  return input && input.uri instanceof vscode.Uri ? input.uri : undefined;
}

// ---------------------------------------------------------------- text helpers
// The webview works in LF-normalized offsets; these map them onto the document.

function normText(document) {
  const t = document.getText();
  return document.eol === vscode.EndOfLine.CRLF ? t.replace(/\r\n/g, '\n') : t;
}

function positioner(document, norm) {
  if (document.eol !== vscode.EndOfLine.CRLF) return (off) => document.positionAt(off);
  const starts = [0];
  for (let i = norm.indexOf('\n'); i >= 0; i = norm.indexOf('\n', i + 1)) starts.push(i + 1);
  return (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return new vscode.Position(lo, off - starts[lo]);
  };
}

function normOffset(document, pos) {
  const off = document.offsetAt(pos);
  return document.eol === vscode.EndOfLine.CRLF ? off - pos.line : off;
}

// ---------------------------------------------------------------- project files (aux, bib, inputs, root preamble)

function gatherExternal(document) {
  let outDir = vscode.workspace.getConfiguration('latex-workshop', document.uri).get('latex.outDir');
  if (typeof outDir === 'string' && outDir && outDir !== '%DIR%') {
    const ws = vscode.workspace.getWorkspaceFolder(document.uri);
    outDir = outDir.replace(/%DIR%/g, '.').replace(/%WORKSPACE_FOLDER%/g, ws ? ws.uri.fsPath : '.');
  } else outDir = null;
  return project.gatherExternal(document.uri.fsPath, document.getText(), { outDir });
}

// ---------------------------------------------------------------- provider

class TexVisualProvider {
  constructor(context) {
    this.context = context;
    this.panels = new Set();
    this.lastActive = null;
    this.debugWaiters = new Map();
    this.debugId = 0;
    this.log = vscode.window.createOutputChannel('TeX Visual');
    context.subscriptions.push(this.log);
  }

  config() {
    const c = vscode.workspace.getConfiguration('texVisual');
    return {
      fontSize: c.get('fontSize', 16),
      fontFamily: c.get('fontFamily', ''),
      maxWidth: c.get('maxWidth', 46),
      followCursor: c.get('followCursor', true),
    };
  }

  pushConfig() {
    const cfg = this.config();
    for (const st of this.panels) st.panel.webview.postMessage({ type: 'config', data: cfg });
  }

  async resolveCustomTextEditor(document, panel) {
    const docDir = vscode.Uri.joinPath(document.uri, '..');
    const roots = [vscode.Uri.joinPath(this.context.extensionUri, 'media'), docDir];
    for (const f of vscode.workspace.workspaceFolders || []) roots.push(f.uri);
    panel.webview.options = { enableScripts: true, localResourceRoots: roots };

    const st = {
      document, panel, applying: 0, queue: Promise.resolve(), cursor: null, ready: false,
      disposables: [], refreshTimer: null, assetTimer: null, changedAssets: new Set(), followTimer: null,
    };
    this.panels.add(st);
    if (panel.active) this.lastActive = st;

    st.disposables.push(
      panel.webview.onDidReceiveMessage((m) => this.onMessage(st, m)),
      panel.onDidChangeViewState(() => { if (panel.active) this.lastActive = st; }),
    );

    if (document.uri.scheme === 'file') {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(docDir, '**/*.{aux,bib,tex,pdf,png,jpg,jpeg,svg}'));
      const onFile = (uri) => {
        const rel = path.relative(docDir.fsPath, uri.fsPath).split(path.sep).join('/');
        if (/\.(aux|bib|tex)$/i.test(rel)) this.scheduleRefresh(st, 400);
        else {
          st.changedAssets.add(rel);
          if (st.assetTimer) clearTimeout(st.assetTimer);
          st.assetTimer = setTimeout(() => {
            const paths = [...st.changedAssets];
            st.changedAssets.clear();
            if (st.ready) panel.webview.postMessage({ type: 'assets', paths });
          }, 500);
        }
      };
      watcher.onDidChange(onFile); watcher.onDidCreate(onFile); watcher.onDidDelete(onFile);
      st.disposables.push(watcher);
    }

    panel.onDidDispose(() => {
      this.panels.delete(st);
      if (this.lastActive === st) this.lastActive = null;
      for (const t of [st.refreshTimer, st.assetTimer, st.followTimer]) if (t) clearTimeout(t);
      for (const d of st.disposables) d.dispose();
    });

    panel.webview.html = this.html(panel.webview);
  }

  html(webview) {
    const media = (f) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', f)).toString();
    const nonce = [...Array(32)].map(() => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
    const csp = webview.cspSource;
    const boot = JSON.stringify({ pdfModule: media('pdf.mjs'), standardFonts: media('standard_fonts') + '/', config: this.config() });
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data: blob:; style-src ${csp} 'unsafe-inline'; font-src ${csp} data:; script-src 'nonce-${nonce}' ${csp}; connect-src ${csp} data: blob:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('katex.min.css')}">
<link rel="stylesheet" href="${media('app.css')}">
</head><body><div id="editor"></div>
<script nonce="${nonce}">window.__TV__ = ${boot};</script>
<script nonce="${nonce}" src="${media('main.js')}"></script>
</body></html>`;
  }

  // ---- messages from the webview

  onMessage(st, m) {
    switch (m && m.type) {
      case 'ready': {
        st.ready = true;
        const { document, panel } = st;
        let cursor = null;
        const ed = vscode.window.visibleTextEditors.find((e) => e.document === document);
        if (ed) {
          const off = normOffset(document, ed.selection.active);
          if (off > 0) cursor = off;
        }
        panel.webview.postMessage({
          type: 'init', text: normText(document), version: document.version, cursor,
          baseUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(document.uri, '..')).toString(),
          aux: {}, bib: {}, rootPreamble: '', inputs: {},
        });
        this.scheduleRefresh(st, 0);
        break;
      }
      case 'edit':
        st.queue = st.queue.then(() => this.applyEdit(st, m)).catch((e) => this.log.appendLine('edit failed: ' + (e && e.stack || e)));
        break;
      case 'cursor':
        st.cursor = m.offset;
        if (st.panel.active && this.config().followCursor) this.revealInTextEditors(st, m.offset);
        break;
      case 'open': this.openRelative(st, m.path); break;
      case 'debug': {
        const w = this.debugWaiters.get(m.id);
        if (w) { this.debugWaiters.delete(m.id); w(m.result); }
        break;
      }
      case 'log': this.log.appendLine(`[webview ${m.level || 'info'}] ${m.text}`); break;
      default:
    }
  }

  async applyEdit(st, m) {
    const { document, panel } = st;
    const reject = () => panel.webview.postMessage({ type: 'reject', seq: m.seq, version: document.version, text: normText(document) });
    if (document.isClosed || m.baseVersion !== document.version) { reject(); return; }
    const before = normText(document);
    const posAt = positioner(document, before);
    const edit = new vscode.WorkspaceEdit();
    let expected = '', at = 0;
    for (const c of m.changes) {
      if (c.from < at || c.to < c.from || c.to > before.length) { reject(); return; }
      edit.replace(document.uri, new vscode.Range(posAt(c.from), posAt(c.to)), c.insert);
      expected += before.slice(at, c.from) + c.insert;
      at = c.to;
    }
    expected += before.slice(at);
    st.applying++;
    let ok = false;
    try { ok = await vscode.workspace.applyEdit(edit); } finally { st.applying--; }
    if (!ok) { reject(); return; }
    const now = normText(document);
    // If something else changed the document while the edit was in flight, send the real text along.
    panel.webview.postMessage(now === expected
      ? { type: 'ack', seq: m.seq, version: document.version }
      : { type: 'ack', seq: m.seq, version: document.version, text: now });
  }

  onDocChange(e) {
    if (e.contentChanges.length === 0) return;
    for (const st of this.panels) {
      if (st.document !== e.document || !st.ready || st.applying) continue;
      st.panel.webview.postMessage({ type: 'sync', version: e.document.version, text: normText(e.document) });
    }
  }

  onDocSaved(document) {
    for (const st of this.panels) {
      if (st.document === document || /\.(tex|bib|sty|cls)$/i.test(document.fileName)) this.scheduleRefresh(st, 300);
    }
  }

  scheduleRefresh(st, delay) {
    if (st.refreshTimer) clearTimeout(st.refreshTimer);
    st.refreshTimer = setTimeout(async () => {
      st.refreshTimer = null;
      try {
        const data = await gatherExternal(st.document);
        const sig = JSON.stringify(data);
        if (sig === st.externalSig) return;
        st.externalSig = sig;
        if (this.panels.has(st)) st.panel.webview.postMessage({ type: 'external', data });
      } catch (e) { this.log.appendLine('refresh failed: ' + (e && e.stack || e)); }
    }, delay);
  }

  // ---- keeping the visual pane and a text editor on the same document aligned

  onTextSelection(e) {
    if (!this.config().followCursor || e.textEditor !== vscode.window.activeTextEditor) return;
    for (const st of this.panels) {
      if (st.document !== e.textEditor.document || !st.ready || st.panel.active || !st.panel.visible) continue;
      const offset = normOffset(st.document, e.selections[0].active);
      if (st.followTimer) clearTimeout(st.followTimer);
      st.followTimer = setTimeout(() => st.panel.webview.postMessage({ type: 'command', name: 'follow', offset }), 80);
    }
  }

  revealInTextEditors(st, offset) {
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document !== st.document) continue;
      const norm = normText(st.document);
      const pos = positioner(st.document, norm)(Math.min(offset, norm.length));
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  async showSource() {
    const st = this.activePanel();
    if (!st) return;
    const norm = normText(st.document);
    const pos = positioner(st.document, norm)(Math.min(st.cursor == null ? 0 : st.cursor, norm.length));
    await vscode.window.showTextDocument(st.document, { viewColumn: vscode.ViewColumn.Beside, selection: new vscode.Range(pos, pos) });
  }

  async openRelative(st, rel) {
    const dir = path.dirname(st.document.uri.fsPath);
    for (const cand of [rel, rel + '.tex']) {
      const p = path.resolve(dir, cand);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const uri = vscode.Uri.file(p);
        if (/\.tex$/i.test(p)) await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
        else await vscode.commands.executeCommand('vscode.open', uri);
        return;
      }
    }
    vscode.window.showWarningMessage(`TeX Visual: cannot find ${rel}`);
  }

  activePanel() {
    for (const st of this.panels) if (st.panel.active) return st;
    return this.lastActive && this.panels.has(this.lastActive) ? this.lastActive : [...this.panels][0];
  }

  command(name) {
    const st = this.activePanel();
    if (st) st.panel.webview.postMessage({ type: 'command', name });
  }

  debug(payload) {
    const st = this.activePanel();
    if (!st || !st.ready) return Promise.resolve(null);
    const id = ++this.debugId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.debugWaiters.delete(id); resolve(null); }, 8000);
      this.debugWaiters.set(id, (r) => { clearTimeout(timer); resolve(r); });
      st.panel.webview.postMessage(Object.assign({ type: 'debug', id }, payload));
    });
  }
}

module.exports = { activate, deactivate };
