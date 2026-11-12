// Webview entry point: CodeMirror editor + sync with the VS Code text document.
import { EditorState, EditorSelection, Annotation, ChangeSet, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, search } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { tags } from '@lezer/highlight';
import {
  externalField, modeField, parseField, decoField, mathTip, setExternal, setMode, assetsChanged,
  focusField, setFocus, neutralPos,
} from './decorate.js';
import { LIST_ENVS } from './latex.js';
import { figureStats, invalidateAssets } from './figures.js';
import { texComplete } from './complete.js';

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
const post = (m) => { if (vscode) vscode.postMessage(m); };
const saved = (vscode && vscode.getState()) || {};

let view = null;
const errors = [];
window.addEventListener('error', (e) => { errors.push(String(e.message)); post({ type: 'log', level: 'error', text: String(e.message) }); });
window.addEventListener('unhandledrejection', (e) => { errors.push(String(e.reason)); });

// ------------------------------------------------------------------ sync
//
// Invariant: editor doc == confirmedDoc ∘ inflight ∘ unsent.
// confirmedDoc mirrors the VS Code document at confirmedVersion. Local edits are batched,
// sent one at a time, and applied by the host only if the document is still at the
// version they were based on; otherwise they are rebased over the remote change.

const remote = Annotation.define();
let confirmedDoc = null;
let confirmedVersion = 0;
let inflight = null, inflightSeq = 0, seq = 0;
let unsent = null, unsentSince = 0, timer = null;
const IDLE_MS = 250, MAX_WAIT_MS = 1500;

function schedule() {
  if (timer) clearTimeout(timer);
  const wait = Math.max(0, Math.min(IDLE_MS, unsentSince + MAX_WAIT_MS - Date.now()));
  timer = setTimeout(flush, wait);
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (inflight || !unsent) return;
  if (unsent.empty) { unsent = null; return; }
  inflight = unsent; unsent = null; inflightSeq = ++seq;
  const changes = [];
  inflight.iterChanges((fromA, toA, _fromB, _toB, ins) => changes.push({ from: fromA, to: toA, insert: ins.toString() }));
  post({ type: 'edit', seq: inflightSeq, baseVersion: confirmedVersion, changes });
}

function onLocalChange(changes) {
  if (!unsent) unsentSince = Date.now();
  unsent = unsent ? unsent.compose(changes) : changes;
  schedule();
}

function onAck(msg) {
  if (!inflight || msg.seq !== inflightSeq) return;
  confirmedDoc = inflight.apply(confirmedDoc);
  confirmedVersion = msg.version;
  inflight = null;
  // The host attaches the full text when something else changed the document alongside our edit.
  if (typeof msg.text === 'string') applyRemote(msg.version, msg.text);
  else if (unsent) flush();
}

function diffChange(oldDoc, text) {
  const old = oldDoc.toString();
  if (old === text) return ChangeSet.empty(old.length);
  const max = Math.min(old.length, text.length);
  let p = 0;
  while (p < max && old.charCodeAt(p) === text.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && old.charCodeAt(old.length - 1 - s) === text.charCodeAt(text.length - 1 - s)) s++;
  return ChangeSet.of({ from: p, to: old.length - s, insert: text.slice(p, text.length - s) }, old.length);
}

function onSync(msg) {
  if (msg.version <= confirmedVersion) return; // nothing we have not already seen
  applyRemote(msg.version, msg.text);
}

function applyRemote(version, text) {
  if (inflight) { // based on a version that no longer exists: the host rejects it; treat it as not yet sent
    unsent = unsent ? inflight.compose(unsent) : inflight;
    inflight = null;
  }
  const R = diffChange(confirmedDoc, text);
  confirmedDoc = R.apply(confirmedDoc);
  confirmedVersion = version;
  if (!unsent) {
    if (!R.empty) view.dispatch({ changes: R, annotations: remote.of(true) });
    return;
  }
  const Rp = R.map(unsent);
  const Lp = unsent.map(R, true);
  if (!Rp.empty) view.dispatch({ changes: Rp, annotations: remote.of(true) });
  unsent = Lp.empty ? null : Lp;
  if (unsent) flush();
}

function onReject(msg) {
  // A rejection for an edit that was already folded back (after a sync) carries nothing new.
  if (!inflight || msg.seq !== inflightSeq) return;
  applyRemote(msg.version, msg.text);
}

// ------------------------------------------------------------------ editing helpers

const wrapWith = (cmd) => (v) => {
  const open = `\\${cmd}{`;
  const tr = v.state.changeByRange((r) => {
    const before = v.state.sliceDoc(Math.max(0, r.from - open.length), r.from);
    if (before === open && v.state.sliceDoc(r.to, r.to + 1) === '}') {
      return {
        changes: [{ from: r.from - open.length, to: r.from }, { from: r.to, to: r.to + 1 }],
        range: EditorSelection.range(r.from - open.length, r.to - open.length),
      };
    }
    return {
      changes: [{ from: r.from, insert: open }, { from: r.to, insert: '}' }],
      range: EditorSelection.range(r.from + open.length, r.to + open.length),
    };
  });
  v.dispatch(tr, { userEvent: 'input', scrollIntoView: true });
  return true;
};

function smartEnter(v) {
  const { state } = v;
  const r = state.selection.main;
  if (!r.empty || state.field(modeField).source) return false;
  const line = state.doc.lineAt(r.head);
  const before = line.text.slice(0, r.head - line.from);
  if (line.text.slice(r.head - line.from).trim() !== '') return false;
  const indent = /^\s*/.exec(line.text)[0];
  const m = /\\begin\{([^{}]+)\}(?:\[[^\]]*\])?(?:\{[^{}]*\})?\s*$/.exec(before);
  if (m && m[1] !== 'document') {
    const env = m[1];
    const text = state.doc.toString();
    const opens = text.split('\\begin{' + env + '}').length - 1;
    const closes = text.split('\\end{' + env + '}').length - 1;
    if (opens <= closes) return false;
    const inner = indent + '  ' + (LIST_ENVS.has(env) ? '\\item ' : '');
    v.dispatch({
      changes: { from: r.head, insert: '\n' + inner + '\n' + indent + '\\end{' + env + '}' },
      selection: { anchor: r.head + 1 + inner.length }, userEvent: 'input', scrollIntoView: true,
    });
    return true;
  }
  const it = /^\s*\\item\b(.*)$/.exec(before);
  if (it && it[1].replace(/^\s*\[[^\]]*\]/, '').trim() !== '') {
    const ins = '\n' + indent + '\\item ';
    v.dispatch({ changes: { from: r.head, insert: ins }, selection: { anchor: r.head + ins.length }, userEvent: 'input', scrollIntoView: true });
    return true;
  }
  return false;
}

function onMouseDown(e, v) {
  if (!(e.metaKey || e.ctrlKey)) return false;
  const el = e.target instanceof Element ? e.target.closest('[data-key],[data-cite],[data-input]') : null;
  if (!el) return false;
  const { sc, num } = v.state.field(parseField);
  let pos = null;
  if (el.dataset.key) {
    const l = num.labels.get(el.dataset.key);
    if (l) pos = l.pos;
  } else if (el.dataset.cite) {
    const t = sc.tokens.find((x) => x.type === 'bibitem' && x.key === el.dataset.cite);
    if (t) pos = t.to;
  } else if (el.dataset.input) {
    post({ type: 'open', path: el.dataset.input });
    e.preventDefault();
    return true;
  }
  if (pos == null) return false;
  e.preventDefault();
  v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  v.focus();
  return true;
}

// ------------------------------------------------------------------ highlighting (only visible where source shows)

const highlight = HighlightStyle.define([
  { tag: tags.tagName, class: 'tok-cmd' },
  { tag: tags.keyword, class: 'tok-cmd' },
  { tag: tags.atom, class: 'tok-atom' },
  { tag: tags.bracket, class: 'tok-bracket' },
  { tag: tags.comment, class: 'tok-comment' },
  { tag: tags.string, class: 'tok-string' },
  { tag: tags.number, class: 'tok-number' },
  { tag: tags.special(tags.variableName), class: 'tok-var' },
  { tag: tags.variableName, class: 'tok-var' },
  { tag: tags.invalid, class: 'tok-invalid' },
]);

// ------------------------------------------------------------------ setup

const darkCompartment = new Compartment();
const isDark = () => /vscode-dark|vscode-high-contrast(?!-light)/.test(document.body.className) || document.body.dataset.theme === 'dark';

let cursorTimer = null;

function create(msg) {
  const text = msg.text;
  const state = EditorState.create({
    doc: text,
    extensions: [
      focusField,
      EditorView.focusChangeEffect.of((_s, focusing) => setFocus.of(focusing)),
      externalField.init(() => ({
        aux: msg.aux || {}, bib: msg.bib || {}, rootPreamble: msg.rootPreamble || '', inputs: msg.inputs || {},
        baseUri: msg.baseUri || '', gen: 0, assetGen: 0,
      })),
      modeField.init(() => ({ source: !!saved.source, preambleOpen: false })),
      parseField, decoField, mathTip,
      EditorView.lineWrapping,
      EditorState.allowMultipleSelections.of(true),
      drawSelection(), dropCursor(), highlightSpecialChars(),
      StreamLanguage.define(stex),
      syntaxHighlighting(highlight),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{', '$'], before: ')]}:;>$,.' } }]),
      closeBrackets(),
      autocompletion({ override: [texComplete], icons: false }),
      search({ top: true }),
      keymap.of([
        { key: 'Mod-b', run: wrapWith('textbf'), stopPropagation: true, preventDefault: true },
        { key: 'Mod-i', run: wrapWith('emph'), stopPropagation: true, preventDefault: true },
        { key: 'Enter', run: smartEnter },
        ...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...searchKeymap, indentWithTab,
      ]),
      EditorView.editorAttributes.compute([modeField], (s) => ({ class: s.field(modeField).source ? 'tv-source-mode' : 'tv-visual-mode' })),
      darkCompartment.of(EditorView.darkTheme.of(isDark())),
      EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          for (const tr of u.transactions) if (tr.docChanged && !tr.annotation(remote)) onLocalChange(tr.changes);
        }
        if (u.selectionSet || u.docChanged) {
          if (cursorTimer) clearTimeout(cursorTimer);
          cursorTimer = setTimeout(() => post({ type: 'cursor', offset: view.state.selection.main.head }), 150);
        }
      }),
      EditorView.domEventHandlers({
        mousedown: onMouseDown,
        keydown(e) { if (e.key === 'Meta' || e.key === 'Control') flush(); return false; },
        blur() { flush(); return false; },
      }),
    ],
  });
  confirmedDoc = state.doc;
  confirmedVersion = msg.version;
  view = new EditorView({ state, parent: document.getElementById('editor') });
  const cursor = msg.cursor == null ? neutralPos(view.state) : Math.max(0, Math.min(text.length, msg.cursor));
  // Opened from a text editor: land where its cursor was. Otherwise start at the top.
  view.dispatch(msg.cursor == null
    ? { selection: { anchor: cursor } }
    : { selection: { anchor: cursor }, effects: EditorView.scrollIntoView(cursor, { y: 'center' }) });
  if (document.hasFocus()) view.focus();
  window.addEventListener('focus', () => { if (view && !view.hasFocus) view.focus(); });
  new MutationObserver(() => view.dispatch({ effects: darkCompartment.reconfigure(EditorView.darkTheme.of(isDark())) }))
    .observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
}

function toggleSource() {
  const source = !view.state.field(modeField).source;
  view.dispatch({ effects: [setMode.of({ source }), EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' })] });
  if (vscode) vscode.setState(Object.assign({}, vscode.getState(), { source }));
}

function debugState() {
  const root = view.dom;
  return {
    text: view.state.doc.toString(),
    version: confirmedVersion,
    pending: !!(inflight || unsent),
    source: view.state.field(modeField).source,
    math: root.querySelectorAll('.tv-math, .tv-display').length,
    katex: root.querySelectorAll('.katex').length,
    mathErrors: root.querySelectorAll('.tv-math-err').length,
    refs: [...root.querySelectorAll('.tv-ref')].map((n) => n.textContent),
    cites: [...root.querySelectorAll('.tv-cite')].map((n) => n.textContent),
    figures: root.querySelectorAll('.tv-figure img').length,
    inputTables: root.querySelectorAll('.tv-tablewrap[data-input] .tv-table').length,
    references: root.querySelectorAll('.tv-refs-entry').length,
    inputRows: root.querySelectorAll('.tv-tablewrap[data-input] .tv-table tr').length,
    captions: [...root.querySelectorAll('.tv-caption-label')].map((n) => n.textContent.trim()),
    figureErrors: [...root.querySelectorAll('.tv-figure .tv-missing')].map((n) => n.textContent),
    figureStats: figureStats(),
    fontsLoaded: document.fonts ? [...document.fonts].filter((f) => f.status === 'loaded' && /KaTeX/.test(f.family)).length : -1,
    errors,
  };
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'init': if (!view) create(msg); else onSync(msg); break;
    case 'sync': if (view) onSync(msg); break;
    case 'ack': onAck(msg); break;
    case 'reject': if (view) onReject(msg); break;
    case 'external': if (view) view.dispatch({ effects: setExternal.of(msg.data) }); break;
    case 'assets': if (view && invalidateAssets(msg.paths || [])) view.dispatch({ effects: assetsChanged.of(null) }); break;
    case 'config': applyConfig(msg.data); if (view) view.requestMeasure(); break;
    case 'command':
      if (!view) break;
      if (msg.name === 'toggleSource') toggleSource();
      else if (msg.name === 'togglePreamble') view.dispatch({ effects: setMode.of({ preambleOpen: !view.state.field(modeField).preambleOpen }) });
      else if (msg.name === 'follow') {
        // The cursor moved in a text editor showing the same file: keep that spot in view.
        if (view.hasFocus) break;
        const pos = Math.max(0, Math.min(view.state.doc.length, msg.offset));
        view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'nearest', yMargin: 140 }) });
      } else if (msg.name === 'reveal') {
        const pos = Math.max(0, Math.min(view.state.doc.length, msg.offset));
        view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
        view.focus();
      }
      break;
    case 'debug':
      if (!view) { post({ type: 'debug', id: msg.id, result: null }); break; }
      if (msg.op === 'type') {
        const at = msg.at == null ? view.state.selection.main.head : msg.at;
        view.dispatch({ changes: { from: at, to: msg.to == null ? at : msg.to, insert: msg.text }, selection: { anchor: at + msg.text.length }, userEvent: 'input' });
        if (msg.flush) flush();
      } else if (msg.op === 'select') {
        view.dispatch({ selection: { anchor: msg.at, head: msg.head == null ? msg.at : msg.head }, effects: EditorView.scrollIntoView(msg.at, { y: 'center' }) });
      } else if (msg.op === 'flush') flush();
      requestAnimationFrame(() => setTimeout(() => post({ type: 'debug', id: msg.id, result: debugState() }), msg.wait || 0));
      break;
    default:
  }
});

function applyConfig(cfg) {
  if (!cfg) return;
  const st = document.documentElement.style;
  if (cfg.fontSize) st.setProperty('--tv-size', cfg.fontSize + 'px');
  if (cfg.maxWidth) st.setProperty('--tv-width', cfg.maxWidth + 'rem');
  if (cfg.fontFamily) st.setProperty('--tv-font', cfg.fontFamily);
  else st.removeProperty('--tv-font');
}
applyConfig(window.__TV__ && window.__TV__.config);

window.addEventListener('visibilitychange', flush);
window.addEventListener('pagehide', flush);
window.__tv = { get view() { return view; }, debugState, flush, toggleSource };
post({ type: 'ready' });
