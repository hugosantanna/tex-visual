// Turns the scanned token list into CodeMirror decorations: rendered math, headings,
// reference chips, tables, list bullets. Anything the cursor touches falls back to source.
import { Decoration, WidgetType, EditorView, showTooltip } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { scan, number, softBreaks, LIST_ENVS, HIDE, HIDE_RAW, FLOATS, SUBFLOATS } from './latex.js';
import { renderMath, texToHtml, tabularHtml, titleHtml, inputHtml, referencesHtml, macroHtml, setMacros, esc, withGlue, isMathError, colorAttrs } from './render.js';
import { FigureWidget } from './figures.js';

// ------------------------------------------------------------------ state

export const setExternal = StateEffect.define();   // { aux, bib, rootPreamble, inputs, baseUri }
export const setMode = StateEffect.define();       // { source?, preambleOpen? }
export const assetsChanged = StateEffect.define();
export const setFocus = StateEffect.define();

// Source is revealed around the cursor only while the editor has focus, so an unfocused
// pane (e.g. next to the text editor) always shows the fully rendered document.
export const focusField = StateField.define({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setFocus)) v = e.value;
    return v;
  },
});

export const externalField = StateField.define({
  create: () => ({ aux: {}, bib: {}, rootPreamble: '', inputs: {}, baseUri: '', gen: 0, assetGen: 0 }),
  update(v, tr) {
    for (const e of tr.effects) {
      if (e.is(setExternal)) v = Object.assign({}, v, e.value, { gen: v.gen + 1 });
      if (e.is(assetsChanged)) v = Object.assign({}, v, { assetGen: v.assetGen + 1 });
    }
    return v;
  },
});

export const modeField = StateField.define({
  create: () => ({ source: false, preambleOpen: false }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setMode)) v = Object.assign({}, v, e.value);
    return v;
  },
});

function parse(state) {
  const text = state.doc.toString();
  const ext = state.field(externalField);
  const sc = scan(text, { rootPreamble: ext.rootPreamble });
  const num = number(text, sc, ext.inputs || {});
  setMacros(sc.meta.defs, sc.meta);
  const ctx = makeCtx(sc, num, ext);
  // the line breaks that are a space to TeX; an environment the view does not know keeps its lines
  const flow = softBreaks(text, sc, (e) => envKind(e.name, e.begin) === 'other');
  return { sc, num, ctx, flow };
}

export const parseField = StateField.define({
  create: parse,
  update(v, tr) {
    if (tr.docChanged || tr.startState.field(externalField) !== tr.state.field(externalField)) return parse(tr.state);
    return v;
  },
});

// ------------------------------------------------------------------ references and citations

const CREF_SHORT = { Equation: 'eq.', Figure: 'fig.' };

function makeCtx(sc, num, ext) {
  const bibInfo = (key) => {
    const b = ext.bib[key];
    if (b) return b;
    const label = num.bibitems.get(key);
    if (label) {
      const m = /^\s*\{?(.*?)\((\d{4}[a-z]?|[^)]*)\)/.exec(label);
      if (m) return { a: m[1].trim(), y: m[2] };
      return { a: label, y: '' };
    }
    return null;
  };
  const ctx = {
    meta: sc.meta,
    refInfo(t) {
      let missing = false;
      const parts = t.keys.map((k) => {
        const l = num.labels.get(k);
        const txt = l && l.text != null ? l.text : ext.aux[k];
        if (txt == null) { missing = true; return k; }
        if (t.name === 'eqref') return '(' + txt + ')';
        if (t.name === 'cref' || t.name === 'Cref' || t.name === 'autoref') {
          let nm = l && l.name;
          if (!nm) return txt;
          // \\crefname{table}{Table}{Tables} in the preamble wins over cleveref's defaults
          const type = l.kind === 'eq' ? 'equation' : l.kind === 'sec' ? nm.toLowerCase() : l.kind === 'thm' ? nm.toLowerCase() : l.kind;
          const own = sc.meta.crefNames[type];
          const cap = (s, up) => (s ? (up ? s[0].toUpperCase() : s[0].toLowerCase()) + s.slice(1) : s);
          if (own && t.name !== 'autoref') nm = t.name === 'Cref' ? (own.C || cap(own.c, true)) : (own.c || cap(own.C, false));
          else if (t.name === 'cref') nm = CREF_SHORT[nm] || nm.toLowerCase();
          return nm + ' ' + (l.kind === 'eq' && t.name !== 'autoref' ? '(' + txt + ')' : txt);
        }
        return String(txt);
      });
      return { text: parts.join(', '), missing };
    },
    refText: (t) => ctx.refInfo(t).text,
    citeInfo(t) {
      let missing = false;
      const base = t.name.replace(/^C/, 'c').replace(/^(P|T)/, (c) => c.toLowerCase());
      const paren = base === 'citep' || base === 'parencite' || base === 'autocite' || base === 'citeyearpar';
      const items = t.keys.map((k) => {
        const b = bibInfo(k);
        if (!b) { missing = true; return esc(k); }
        const a = texToHtml(b.a, { meta: sc.meta }), y = esc(b.y);
        switch (base) {
          case 'citet': case 'cite': case 'textcite':
            return `${a} (${y}${t.post && t.keys.length === 1 ? ', ' + texToHtml(t.post) : ''})`;
          case 'citeauthor': return a;
          case 'citeyear': case 'citeyearpar': return y;
          case 'citealt': return `${a} ${y}`;
          default: return `${a}, ${y}`;
        }
      });
      const textual = base === 'citet' || base === 'cite' || base === 'textcite';
      let html = items.join('; ');
      if (!textual && t.post) html += ', ' + texToHtml(t.post);
      if (t.pre) html = texToHtml(t.pre) + ' ' + html;
      if (paren) html = '(' + html + ')';
      return { html, missing };
    },
    citeText: (t) => ctx.citeInfo(t).html.replace(/<[^>]+>/g, ''),
    /** The list \\bibliography / \\printbibliography prints: the cited entries of the .bib files. */
    referencesHtml() {
      const keys = num.cited;                     // also the \\cite's in files the document \\input's
      const all = keys.has('*');
      const entries = [];
      for (const k of all ? Object.keys(ext.bib) : keys) if (ext.bib[k] && ext.bib[k].r) entries.push({ key: k, r: ext.bib[k].r });
      if (!entries.length) return null;
      const sig = ext.gen + '|' + entries.map((e) => e.key).join(',');
      if (refsCache.sig !== sig) { refsCache.sig = sig; refsCache.html = referencesHtml(entries, { meta: sc.meta }); }
      return refsCache.html;
    },
  };
  return ctx;
}
const refsCache = { sig: null, html: null };

// ------------------------------------------------------------------ widgets

class HtmlWidget extends WidgetType {
  constructor(html, cls, tag = 'span', est = -1, attrs = null) {
    super();
    this.html = html; this.cls = cls; this.tag = tag; this.est = est; this.attrs = attrs;
  }
  eq(o) {
    return o.html === this.html && o.cls === this.cls && o.tag === this.tag &&
      JSON.stringify(o.attrs) === JSON.stringify(this.attrs);
  }
  toDOM() {
    const el = document.createElement(this.tag);
    el.className = this.cls;
    el.innerHTML = this.html;
    if (this.attrs) for (const k in this.attrs) el.setAttribute(k, this.attrs[k]);
    return el;
  }
  get estimatedHeight() { return this.est; }
  ignoreEvent() { return false; }
}

class PreambleWidget extends WidgetType {
  constructor(lines, open) { super(); this.lines = lines; this.open = open; }
  eq(o) { return o.lines === this.lines && o.open === this.open; }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'tv-preamble-row';
    const b = document.createElement('span');
    b.className = 'tv-preamble';
    b.textContent = this.open ? '▾ Preamble — click to collapse' : `▸ Preamble · ${this.lines} lines`;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const { sc } = view.state.field(parseField);
      const open = !this.open;
      const spec = { effects: setMode.of({ preambleOpen: open }) };
      // folding takes the cursor out of the preamble, to a place where it opens nothing (the first
      // line of the body is usually \maketitle)
      if (!open && view.state.selection.main.head < sc.bodyFrom) spec.selection = { anchor: neutralPos(view.state) };
      view.dispatch(spec);
      view.focus();
    });
    el.appendChild(b);
    return el;
  }
  get estimatedHeight() { return 30; }
  ignoreEvent() { return true; }
}

// ------------------------------------------------------------------ editable tables
//
// A rendered table is edited cell by cell. Every <td> carries data-c="from:to", the range of
// its content: in the document for a tabular written there, in the other file for a table
// pulled in with \input. Committing a cell is an ordinary edit of that range, so undo, sync
// and source control see nothing special.

/** Where the table drawn in `wrap` comes from: { kind: 'doc', base } or { kind: 'input', path, src }. */
function tableOrigin(view, wrap) {
  const pos = view.posAtDOM(wrap);
  const { sc } = view.state.field(parseField);
  const ext = view.state.field(externalField);
  const lineTo = view.state.doc.lineAt(pos).to;
  let lo = 0, hi = sc.tokens.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sc.tokens[mid].from < pos) lo = mid + 1; else hi = mid; }
  for (let k = lo; k < sc.tokens.length && sc.tokens[k].from <= lineTo; k++) {
    const t = sc.tokens[k];
    if (t.type === 'tabular') return { kind: 'doc', base: t.from, pos };
    if (t.type === 'input' && ext.inputs && ext.inputs[t.path] != null) return { kind: 'input', path: t.path, src: ext.inputs[t.path], pos };
  }
  return null;
}

const cellRange = (td) => td.dataset.c.split(':').map(Number);
const hostPost = (view, message) => view.dom.dispatchEvent(new CustomEvent('tv-post', { bubbles: true, detail: message }));

function cellSource(view, origin, td) {
  const [from, to] = cellRange(td);
  return origin.kind === 'doc' ? view.state.doc.sliceString(origin.base + from, origin.base + to) : origin.src.slice(from, to);
}

/** Replace [from, to) of the table's text (offsets as in data-c / data-end). */
function applyTableEdit(view, origin, from, to, insert) {
  if (origin.kind === 'doc') {
    view.dispatch({ changes: { from: origin.base + from, to: origin.base + to, insert }, userEvent: 'input' });
    return;
  }
  // a table kept in another file: the host writes it there; show the result right away
  const next = origin.src.slice(0, from) + insert + origin.src.slice(to);
  hostPost(view, { type: 'editInput', path: origin.path, from, to, insert, expect: origin.src.slice(from, to) });
  const inputs = Object.assign({}, view.state.field(externalField).inputs, { [origin.path]: next });
  view.dispatch({ effects: setExternal.of({ inputs }) });
}

/** The table widget now drawn where `origin` was (the DOM is rebuilt after an edit). */
function findTableWrap(view, origin) {
  for (const el of view.dom.querySelectorAll('.tv-tablewrap.tv-editable')) {
    try { if (view.posAtDOM(el) === origin.pos) return el; } catch (e) { /* detached */ }
  }
  return null;
}

function cellAt(wrap, ti, r, c) {
  const table = wrap && wrap.querySelectorAll('table.tv-table')[ti];
  const row = table && table.rows[r];
  if (!row) return null;
  const td = row.cells[Math.min(c, row.cells.length - 1)];
  return td && td.dataset.c ? td : null;
}

/** Commit `value` into a cell. `then` (optional) names the cell to open next: { ti, r, c }. */
export function commitCell(view, wrap, td, value, then) {
  const origin = tableOrigin(view, wrap);
  if (!origin) return;
  const [from, to] = cellRange(td);
  const old = cellSource(view, origin, td);
  value = value.replace(/\s*\n\s*/g, ' ').trim();
  if (value !== old) {
    // keep the source readable when text lands in a cell that was empty
    const text = origin.kind === 'doc' ? view.state.doc.sliceString(origin.base + to, origin.base + to + 1) : origin.src.slice(to, to + 1);
    const pad = from === to && value && (text === '&' || text === '\\') ? ' ' : '';
    applyTableEdit(view, origin, from, to, value + pad);
  }
  if (then) requestAnimationFrame(() => {
    const td2 = cellAt(findTableWrap(view, origin), then.ti, then.r, then.c);
    if (td2) editCell(view, td2.closest('.tv-tablewrap'), td2);
  });
}

/** Add an empty row under the row of `td` and start typing in it. */
function addRowBelow(view, wrap, td) {
  const origin = tableOrigin(view, wrap);
  const tr = td.parentElement;
  if (!origin || tr.dataset.end == null) return;
  const at = Number(tr.dataset.end), n = Math.max(1, Number(tr.dataset.n) || tr.cells.length);
  const table = td.closest('table');
  const ti = [...wrap.querySelectorAll('table.tv-table')].indexOf(table), r = tr.rowIndex;
  applyTableEdit(view, origin, at, at, '\n' + new Array(n).fill('').join(' & ') + ' \\\\');
  requestAnimationFrame(() => {
    const td2 = cellAt(findTableWrap(view, origin), ti, r + 1, 0);
    if (td2) editCell(view, td2.closest('.tv-tablewrap'), td2);
  });
}

/** Open the editor on one cell: its LaTeX source in a text field. */
export function editCell(view, wrap, td) {
  if (td.classList.contains('tv-cell-editing')) return;
  const origin = tableOrigin(view, wrap);
  if (!origin) return;
  const table = td.closest('table');
  const ti = [...wrap.querySelectorAll('table.tv-table')].indexOf(table);
  const r = td.parentElement.rowIndex, c = td.cellIndex;
  const source = cellSource(view, origin, td);
  const shown = td.innerHTML;
  const inp = document.createElement('input');
  inp.className = 'tv-cell-input';
  inp.spellcheck = false;
  inp.value = source;
  const fit = () => { inp.size = Math.max(4, inp.value.length + 1); };
  fit();
  td.classList.add('tv-cell-editing');
  td.replaceChildren(inp);
  let done = false;
  const close = (commit, then) => {
    if (done) return;
    done = true;
    const value = inp.value;
    td.classList.remove('tv-cell-editing');
    td.innerHTML = shown;
    if (commit) commitCell(view, wrap, td, value, then);
    else if (then) { const td2 = cellAt(wrap, then.ti, then.r, then.c); if (td2) editCell(view, wrap, td2); }
  };
  const rowCount = table.rows.length;
  const step = (dr, dc) => {
    let rr = r, cc = c + dc;
    if (dr) return rr + dr >= 0 && rr + dr < rowCount ? { ti, r: rr + dr, c } : null;
    if (cc >= table.rows[rr].cells.length) { rr++; cc = 0; }
    else if (cc < 0) { rr--; cc = rr >= 0 ? table.rows[rr].cells.length - 1 : 0; }
    return rr >= 0 && rr < rowCount ? { ti, r: rr, c: cc } : null;
  };
  inp.addEventListener('input', fit);
  inp.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const leave = (commit, then) => { e.preventDefault(); close(commit, then); if (!then) view.focus(); };
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {       // commit, then a new row under this one
      e.preventDefault();
      close(true);
      const now = findTableWrap(view, origin) || wrap;
      addRowBelow(view, now, cellAt(now, ti, r, c) || td);
    } else if (e.key === 'Enter') leave(true, step(e.shiftKey ? -1 : 1, 0));
    else if (e.key === 'Tab') leave(true, step(0, e.shiftKey ? -1 : 1));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const t = step(e.key === 'ArrowDown' ? 1 : -1, 0); if (t) leave(true, t); }
    else if (e.key === 'Escape') leave(false, null);
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => close(true));
  inp.focus();
  inp.select();
}

/** A rendered table whose cells can be edited where they are. */
class TableWidget extends WidgetType {
  constructor(html, cls, tag = 'div', est = -1, attrs = null) {
    super();
    this.html = html; this.cls = cls; this.tag = tag; this.est = est; this.attrs = attrs;
  }
  eq(o) {
    return o.html === this.html && o.cls === this.cls && o.tag === this.tag &&
      JSON.stringify(o.attrs) === JSON.stringify(this.attrs);
  }
  toDOM(view) {
    const el = document.createElement(this.tag);
    el.className = this.cls + ' tv-editable';
    el.innerHTML = this.html;
    if (this.attrs) for (const k in this.attrs) el.setAttribute(k, this.attrs[k]);
    if (this.tag === 'div') {            // a table on its own lines gets a way back to its source
      const tools = document.createElement('span');
      tools.className = 'tv-table-tools';
      tools.innerHTML = '<button type="button" data-act="source" title="Edit the LaTeX source of this table">&lt;/&gt;</button>';
      el.appendChild(tools);
    }
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || (e.target instanceof Element && e.target.closest('.tv-cell-input'))) return;
      const target = e.target instanceof Element ? e.target : null;
      const origin = tableOrigin(view, el);
      if (!origin || !target) return;
      e.preventDefault();
      const source = () => {
        if (origin.kind === 'input') hostPost(view, { type: 'open', path: origin.path });
        else { view.dispatch({ selection: { anchor: origin.base + 1 }, scrollIntoView: true }); view.focus(); }
      };
      if (target.closest('[data-act="source"]') || e.metaKey || e.ctrlKey) { source(); return; }
      const td = target.closest('td[data-c]');
      if (!td || !el.contains(td)) return;
      const where = { ti: [...el.querySelectorAll('table.tv-table')].indexOf(td.closest('table')), r: td.parentElement.rowIndex, c: td.cellIndex };
      const open = view.dom.querySelector('.tv-cell-input');
      if (open) open.blur();                         // commits; if it was in this table, the table is redrawn
      const wrap = el.isConnected ? el : findTableWrap(view, origin);
      const td2 = cellAt(wrap, where.ti, where.r, where.c);
      if (td2) editCell(view, wrap, td2);
    });
    return el;
  }
  get estimatedHeight() { return this.est; }
  ignoreEvent() { return true; }      // the table handles its own mouse and keys; the cursor stays put
}

/** A line break inside a paragraph, drawn as the space TeX makes of it. */
class JoinWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'tv-join';
    el.textContent = ' ';
    return el;
  }
  ignoreEvent() { return false; }
}

/** Subfigures of one float, side by side. */
class SubRowWidget extends WidgetType {
  constructor(items) {
    super();
    this.items = items;
    this.key = items.map((it) => [it.fig.key, it.caption, it.width].join('~')).join('||');
  }
  eq(o) { return o.key === this.key; }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'tv-subrow';
    for (const it of this.items) {
      const cell = document.createElement('div');
      cell.className = 'tv-subcell';
      cell.style.flexBasis = it.width + '%';
      cell.appendChild(it.fig.toDOM(view));
      if (it.caption) {
        const c = document.createElement('div');
        c.className = 'tv-subcaption';
        c.innerHTML = it.caption;
        cell.appendChild(c);
      }
      el.appendChild(cell);
    }
    return el;
  }
  get estimatedHeight() { return 260; }
  ignoreEvent() { return false; }
}

// ------------------------------------------------------------------ builder

const LAYOUT_ENVS = new Set([
  'figure', 'figure*', 'table', 'table*', 'center', 'flushleft', 'flushright', 'quote', 'quotation',
  'minipage', 'subfigure', 'subtable', 'spacing', 'singlespace', 'landscape', 'sidewaystable',
  'sidewaysfigure', 'threeparttable', 'titlepage', 'small', 'footnotesize', 'frame',
  'sidewaystable*', 'sidewaysfigure*', 'wrapfigure', 'wraptable', 'adjustbox', 'adjustwidth',
  'doublespace', 'onehalfspace', 'singlespacing', 'onehalfspacing', 'doublespacing', 'multicols',
  'scriptsize', 'tiny', 'large', 'Large', 'normalsize', 'samepage', 'appendices', 'refsection',
  'threeparttablex', 'measuredfigure', 'subappendices', 'raggedright', 'sloppypar', 'appendix', 'justify',
]);
const CENTERED = new Set([
  'figure', 'figure*', 'table', 'table*', 'center', 'sidewaystable', 'sidewaysfigure',
  'sidewaystable*', 'sidewaysfigure*', 'titlepage',
]);
// \\renewcommand targets that only steer numbering or spacing: hidden like other layout commands.
const LAYOUT_MACRO = /^\\(the[A-Za-z]+|arraystretch|baselinestretch|tabcolsep|headrulewidth|footrulewidth)$/;
const FONT_SIZE = { tiny: 0.5, scriptsize: 0.7, footnotesize: 0.8, small: 0.9, normalsize: 1, large: 1.2, Large: 1.44 };
const LONG_CAPTION = 110; // characters; longer captions are set flush left like TeX's multi-line ones
const STYLE_CLASS = {
  em: 'tv-em', b: 'tv-b', sc: 'tv-sc', tt: 'tv-tt', u: 'tv-u', rm: 'tv-rm', sf: 'tv-sf',
  fn: 'tv-fn', caption: 'tv-caption-text', href: 'tv-link', sup: 'tv-sup', sub: 'tv-sub',
  strike: 'tv-strike',
};
const HIDE_INLINE = Decoration.replace({});
const HIDE_BLOCK = Decoration.replace({ block: true });
const JOIN = Decoration.replace({ widget: new JoinWidget() });
const OWN_LINE = /(^| )tv-(src-line|pre|comment-line|h)[ |]/;   // line classes (in a lineKey) that never run into their neighbours
const markCache = Object.create(null);
const markDeco = (cls) => markCache[cls] || (markCache[cls] = Decoration.mark({ class: cls }));
const colorCache = Object.create(null);
const colorDeco = (a) => colorCache[a.class + a.style] || (colorCache[a.class + a.style] = Decoration.mark({ attributes: a }));
const tableCache = new Map();
let tableSig = null;        // the colors the cached tables were drawn with
const lastGood = new Map(); // display-math position -> last rendering that parsed, shown while a formula is mid-edit

function envKind(name, tok) {
  if (tok && tok.thm) return 'thm';
  if (LIST_ENVS.has(name)) return 'list';
  if (LAYOUT_ENVS.has(name)) return 'layout';
  if (name === 'tablenotes') return 'notes';
  if (name === 'abstract') return 'abstract';
  if (name === 'thebibliography') return 'bib';
  return 'other';
}

function build(state) {
  const mode = state.field(modeField);
  if (mode.source) return Decoration.none;
  const { sc, ctx, flow } = state.field(parseField);
  const ext = state.field(externalField);
  const doc = state.doc;
  const sel = state.selection.ranges;
  const main = state.selection.main;
  const joined = new Set();  // line breaks drawn as a space

  const marks = [];          // mark + line decorations
  const reps = [];           // replace / widget decorations: {from, to, deco}
  const lines = new Map();   // line.from -> { cls: [], indent, style }

  const focused = state.field(focusField);
  const touch = (from, to) => {
    if (!focused) return false;
    for (const r of sel) {
      if (r.empty) { if (r.head >= from && r.head <= to) return true; }
      else if ((r.anchor > from && r.anchor < to) || (r.head > from && r.head < to)) return true;
    }
    return false;
  };
  const mark = (from, to, cls) => { if (to > from) marks.push(markDeco(cls).range(from, to)); };
  // the color and background a token gives the text in [from, to)
  const paint = (from, to, t) => { const a = colorAttrs(t); if (a && to > from) marks.push(colorDeco(a).range(from, to)); };
  const rep = (from, to, deco) => { reps.push({ from, to, deco }); };
  const hidden = [];         // inline-hidden ranges, to collapse lines that show nothing at all
  const hide = (from, to) => { if (to > from) { rep(from, to, HIDE_INLINE); hidden.push({ from, to }); } };
  const widget = (from, to, w, block) => rep(from, to, Decoration.replace({ widget: w, block: !!block }));
  const lineInfo = (from) => {
    let li = lines.get(from);
    if (!li) lines.set(from, li = { cls: [], indent: 0 });
    return li;
  };
  const addLine = (from, cls) => { lineInfo(from).cls.push(cls); };
  const eachLine = (from, to, f) => {
    const a = doc.lineAt(from).number, b = doc.lineAt(Math.min(to, doc.length)).number;
    for (let n = a; n <= b; n++) f(doc.line(n));
  };
  const own = (from, to) => {
    const l1 = doc.lineAt(from), l2 = to <= l1.to ? l1 : doc.lineAt(to);
    if (/\S/.test(doc.sliceString(l1.from, from)) || /\S/.test(doc.sliceString(to, l2.to))) return null;
    return { from: l1.from, to: l2.to };
  };
  const next = (pos) => doc.sliceString(pos, pos + 1);

  // Theorem ranges, so block widgets inside them can continue the margin bar.
  const thmRanges = sc.envs.filter((e) => e.begin.thm).map((e) => [e.from, e.to]);
  const inThm = (pos) => thmRanges.some((r) => pos > r[0] && pos < r[1]);
  const listRanges = sc.envs.filter((e) => LIST_ENVS.has(e.name)).map((e) => [e.from, e.to]);
  const listDepthAt = (pos) => listRanges.reduce((d, r) => d + (pos > r[0] && pos < r[1] ? 1 : 0), 0);
  const ctxClass = (pos) => (inThm(pos) ? ' tv-in-thm' : '');
  const ctxAttrs = (pos) => { const d = listDepthAt(pos); return d ? { style: `--tv-indent:${d}` } : null; };
  const floatRanges = sc.envs.filter((e) => FLOATS[e.name]).map((e) => [e.from, e.to]);
  const hasMaketitle = sc.tokens.some((t) => t.type === 'maketitle');   // only then is \\title{…} shown elsewhere
  const inFloat = (pos) => floatRanges.some((r) => pos > r[0] && pos < r[1]);
  const firstTokenAt = (pos) => {       // index of the first token starting at or after pos
    let lo = 0, hi = sc.tokens.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sc.tokens[mid].from < pos) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const sizeAt = (pos) => {             // \\small, \\scriptsize… in force where a table starts
    const r = floatRanges.find((x) => pos > x[0] && pos < x[1]);
    if (!r) return null;
    let fs = null;
    for (let k = firstTokenAt(r[0]); k < sc.tokens.length && sc.tokens[k].from < pos; k++) {
      const u = sc.tokens[k];
      if (u.type === 'cs' && FONT_SIZE[u.name] != null) fs = FONT_SIZE[u.name];
    }
    return fs && fs !== 1 ? { style: `--tv-fs:${fs}` } : null;
  };
  if (tableSig !== sc.meta.colorSig) { tableSig = sc.meta.colorSig; tableCache.clear(); }
  const cachedTable = (key, make) => {
    let html = tableCache.get(key);
    if (html === undefined) {
      html = make();
      if (tableCache.size > 200) tableCache.clear();
      tableCache.set(key, html);
    }
    return html;
  };

  // ---- preamble
  if (sc.bodyFrom > 0) {
    const pl = doc.lineAt(Math.max(0, Math.min(doc.length, sc.bodyFrom - 1)));
    const inside = focused && main.head <= pl.to;
    const open = mode.preambleOpen || inside;
    // The cursor in \title{…}, \author{…} or \date{…}, where a click on the title block puts it:
    // only that command is shown, and the rest of the preamble stays folded.
    let part = null;
    if (inside && !mode.preambleOpen && sel.length === 1) {
      for (const k in sc.titleSrc) {
        const s = sc.titleSrc[k];
        if (s.to <= pl.from && main.from >= s.from && main.to <= s.to) part = s;
      }
    }
    if (part) {
      const a = doc.lineAt(part.from), b = doc.lineAt(part.to);
      const chip = new PreambleWidget(pl.number, false);
      if (a.from > 0) widget(0, a.from - 1, chip, true);
      else rep(0, 0, Decoration.widget({ widget: chip, block: true, side: -1 }));
      eachLine(a.from, b.to, (l) => addLine(l.from, 'tv-pre'));
      if (b.to < pl.to) rep(b.to + 1, pl.to, HIDE_BLOCK);
    } else if (!open) {
      widget(0, pl.to, new PreambleWidget(pl.number, false), true);
    } else {
      rep(0, 0, Decoration.widget({ widget: new PreambleWidget(pl.number, true), block: true, side: -1 }));
      eachLine(0, pl.to, (l) => addLine(l.from, 'tv-pre'));
    }
  }

  let skip = 0;
  for (const t of sc.tokens) {
    if (t.from < skip) continue;
    switch (t.type) {
      case 'comment': {
        if (t.full) {
          const l = doc.lineAt(t.from);
          if (t.sep && !touch(l.from, l.to)) rep(l.from, l.to, HIDE_BLOCK);
          else addLine(l.from, 'tv-comment-line');
        } else mark(t.from, t.to, 'tv-comment');
        break;
      }

      case 'math': {
        skip = t.to;
        const rev = touch(t.from, t.to);
        if (!t.display) {
          // Glue neighbouring punctuation to the formula so lines never break between them.
          let after = '';
          const tailSrc = doc.sliceString(t.to, t.to + 8);
          const gm = /^[^\s\\${}~%&#<>`]{1,6}(?=\s|$)/.exec(tailSrc) || /^[.,;:!?)\]]{1,3}/.exec(tailSrc);
          if (gm && !/''|--/.test(gm[0])) after = gm[0];
          let before = '';
          const pc = t.from > 0 ? doc.sliceString(t.from - 1, t.from) : '';
          if ((pc === '(' || pc === '[') && (t.from < 2 || /\s/.test(doc.sliceString(t.from - 2, t.from - 1)))) before = pc;
          if (touch(t.from, t.to + Math.max(0, after.length - 1))) mark(t.from, t.to, 'tv-src tv-math-src');
          else widget(t.from - before.length, t.to + after.length, new HtmlWidget(withGlue(renderMath(t.tex, false), before, after), 'tv-math'));
          break;
        }
        const o = own(t.from, t.to);
        const html = renderMath(t.tex, true);
        let preview = html, stale = '';
        if (isMathError(html)) {
          const g = lastGood.get(t.from);
          if (g) { preview = g; stale = ' tv-stale'; }
        } else {
          if (lastGood.size > 400) lastGood.clear();
          lastGood.set(t.from, html);
        }
        const rows = (t.tex.match(/\\\\/g) || []).length + 1;
        const est = 34 + rows * 30;
        if (!rev) {
          if (o) widget(o.from, o.to, new HtmlWidget(html, 'tv-display' + ctxClass(t.from), 'div', est, ctxAttrs(t.from)), true);
          else widget(t.from, t.to, new HtmlWidget(html, 'tv-display tv-display-inline'));
        } else {
          const l2 = doc.lineAt(t.to);
          if (o) eachLine(t.from, t.to, (l) => addLine(l.from, 'tv-src-line'));
          else mark(t.from, t.to, 'tv-src tv-math-src');
          rep(l2.to, l2.to, Decoration.widget({
            widget: new HtmlWidget(preview, 'tv-display tv-preview' + stale + ctxClass(t.from), 'div', est, ctxAttrs(t.from)), block: true, side: 1,
          }));
        }
        break;
      }

      case 'tabular': {
        skip = t.to;
        const src = doc.sliceString(t.from, t.to);
        const html = cachedTable(src, () => tabularHtml(src, ctx));
        const o = own(t.from, t.to);
        if (!html) { eachLine(t.from, t.to, (l) => addLine(l.from, 'tv-src-line')); break; }
        if (!o) { // shares its line with other material (a panel heading, a box around it): draw it in place
          if (touch(t.from, t.to)) mark(t.from, t.to, 'tv-src');
          else widget(t.from, t.to, new TableWidget(html, 'tv-tablewrap tv-table-inline', 'span', -1, sizeAt(t.from)));
          break;
        }
        const fsAttrs = sizeAt(t.from);
        const est = 30 + src.split('\\\\').length * 26;
        if (!touch(t.from, t.to)) {
          widget(o.from, o.to, new TableWidget(html, 'tv-tablewrap', 'div', est, fsAttrs), true);
        } else {
          eachLine(t.from, t.to, (l) => addLine(l.from, 'tv-src-line'));
          rep(o.to, o.to, Decoration.widget({ widget: new HtmlWidget(html, 'tv-tablewrap tv-preview', 'div', est, fsAttrs), block: true, side: 1 }));
        }
        break;
      }

      case 'verb': {
        skip = t.to;
        if (t.inline) mark(t.from, t.to, 'tv-src');
        else eachLine(t.from, t.to, (l) => addLine(l.from, 'tv-src-line'));
        break;
      }

      case 'section': {
        const rev = touch(t.from, t.to);
        if (t.level <= 3) eachLine(t.from, t.to, (l) => addLine(l.from, 'tv-h tv-h' + t.level));
        else mark(t.inner.from, t.inner.to, 'tv-run-head');
        if (rev) {
          mark(t.open.from, t.open.to, 'tv-cs');
          mark(t.close.from, t.close.to, 'tv-cs');
        } else {
          if (t.num && t.level <= 3) widget(t.open.from, t.open.to, new HtmlWidget(esc(t.num), 'tv-secnum'));
          else hide(t.open.from, t.open.to);
          hide(t.close.from, t.close.to);
        }
        break;
      }

      case 'style': {
        const rev = touch(t.from, t.to);
        const cls = STYLE_CLASS[t.kind];
        if (cls) mark(t.inner.from, t.inner.to, cls);
        paint(t.inner.from, t.inner.to, t);
        if (t.kind === 'caption') {
          const cls = 'tv-caption' + (t.inner.to - t.inner.from > LONG_CAPTION ? ' tv-caption-long' : '');
          eachLine(t.from, t.to, (l) => addLine(l.from, cls));
        } else if (t.kind === 'notes' && inFloat(t.from)) {
          eachLine(t.inner.from, t.inner.to, (l) => addLine(l.from, 'tv-notes'));
        }
        if (rev) {
          mark(t.open.from, t.open.to, 'tv-cs');
          mark(t.close.from, t.close.to, 'tv-cs');
        } else {
          if (t.kind === 'caption' && t.num) widget(t.open.from, t.open.to, new HtmlWidget(`${t.floatName} ${esc(t.num)}:&nbsp;`, 'tv-caption-label'));
          else if (t.kind === 'caption' && t.sub) widget(t.open.from, t.open.to, new HtmlWidget(`${esc(t.sub)}&nbsp;`, 'tv-caption-label tv-subcaption-label'));
          else if (t.kind === 'fn') widget(t.open.from, t.open.to, new HtmlWidget('note', 'tv-fn-mark'));
          else hide(t.open.from, t.open.to);
          hide(t.close.from, t.close.to);
        }
        break;
      }

      case 'ref': {
        if (touch(t.from, t.to)) { mark(t.from, t.to, 'tv-src'); break; }
        const info = ctx.refInfo(t);
        widget(t.from, t.to, new HtmlWidget(esc(info.text), 'tv-ref' + (info.missing ? ' tv-missing' : ''), 'span', -1,
          { 'data-key': t.keys[0], title: `\\${t.name}{${t.keys.join(',')}} — ⌘-click to jump` }));
        break;
      }
      case 'cite': {
        if (touch(t.from, t.to)) { mark(t.from, t.to, 'tv-src'); break; }
        const info = ctx.citeInfo(t);
        widget(t.from, t.to, new HtmlWidget(info.html, 'tv-cite' + (info.missing ? ' tv-missing' : ''), 'span', -1,
          { 'data-cite': t.keys[0], title: `\\${t.name}{${t.keys.join(',')}}` }));
        break;
      }
      case 'label': {
        if (touch(t.from, t.to)) mark(t.from, t.to, 'tv-src');
        else widget(t.from, t.to, new HtmlWidget(esc(t.key), 'tv-label'));
        break;
      }
      case 'input': {
        const src = ext.inputs ? ext.inputs[t.path] : null;
        // the numbers its captions took are part of what is drawn
        const nums = t.sub ? t.sub.tokens.filter((u) => u.num && u.kind === 'caption').map((u) => u.num).join(',') : '';
        const html = src != null ? cachedTable(`\\input ${nums} ${src}`, () => inputHtml(src, ctx, t.sub)) : null;
        const rev = touch(t.from, t.to);
        if (!html) {
          if (rev) mark(t.from, t.to, 'tv-src');
          else widget(t.from, t.to, new HtmlWidget('↳ ' + esc(t.path), 'tv-input', 'span', -1, { 'data-input': t.path, title: '⌘-click to open' }));
          break;
        }
        const attrs = Object.assign({ 'data-input': t.path }, sizeAt(t.from));
        const o = own(t.from, t.to);
        const est = 30 + src.split('\\\\').length * 26;
        if (!o) {
          if (rev) mark(t.from, t.to, 'tv-src');
          else widget(t.from, t.to, new TableWidget(html, 'tv-tablewrap tv-table-inline', 'span', -1, attrs));
        } else if (!rev) {
          widget(o.from, o.to, new TableWidget(html, 'tv-tablewrap', 'div', est, attrs), true);
        } else {
          mark(t.from, t.to, 'tv-src');
          rep(o.to, o.to, Decoration.widget({ widget: new HtmlWidget(html, 'tv-tablewrap tv-preview', 'div', est, attrs), block: true, side: 1 }));
        }
        break;
      }
      case 'url': {
        if (touch(t.from, t.to)) mark(t.from, t.to, 'tv-src');
        else widget(t.from, t.to, new HtmlWidget(esc(t.url), 'tv-link tv-tt'));
        break;
      }

      case 'item': {
        const l = doc.lineAt(t.from);
        const lead = /^\s*$/.test(doc.sliceString(l.from, t.from)) ? l.from : t.from;
        if (t.notes) {
          if (touch(lead, t.to)) { mark(t.from, t.to, 'tv-cs'); break; }
          const to = next(t.to) === ' ' ? t.to + 1 : t.to;
          if (t.custom) widget(lead, to, new HtmlWidget(texToHtml(t.label, ctx), 'tv-note-mark'));
          else hide(lead, to);
          break;
        }
        if (lead === l.from) addLine(l.from, 'tv-li-first');
        if (touch(lead, t.to)) { mark(t.from, t.to, 'tv-cs'); break; }
        const to = next(t.to) === ' ' ? t.to + 1 : t.to;
        const html = t.custom ? texToHtml(t.label, ctx) : esc(t.bullet == null ? '•' : t.bullet);
        widget(lead, to, new HtmlWidget(html, 'tv-bullet' + (t.custom ? ' tv-bullet-custom' : '')));
        break;
      }

      case 'begin': {
        if (!t.rec) { mark(t.from, t.to, 'tv-cs'); break; }
        const kind = envKind(t.env, t);
        if (kind === 'thm') {
          const headTo = t.opt ? t.opt.to : t.nameTo;
          if (touch(t.from, headTo)) { mark(t.from, t.nameTo, 'tv-cs'); break; }
          const proof = t.env === 'proof';
          const title = proof ? 'Proof' : esc(t.title) + (t.num ? ' ' + esc(t.num) : '');
          const sp = /\s/.test(next(headTo)) ? '' : ' ';
          if (t.opt) {
            widget(t.from, t.opt.from + 1, new HtmlWidget(proof ? '' : `<b>${title}</b> (`, 'tv-thm-head'));
            mark(t.opt.from + 1, t.opt.to - 1, proof ? 'tv-em' : 'tv-thm-note');
            widget(t.opt.to - 1, t.opt.to, new HtmlWidget(proof ? '.' + sp : ').' + sp, 'tv-thm-head'));
          } else {
            widget(t.from, t.nameTo, new HtmlWidget((proof ? `<em>${title}.</em>` : `<b>${title}.</b>`) + sp, 'tv-thm-head'));
          }
          // Run the heading into the first line of the body when it sits alone on its line.
          const hl = doc.lineAt(t.from);
          if (hl.number < doc.lines && !touch(hl.from, hl.to) && /^\s*$/.test(doc.sliceString(hl.from, t.from)) &&
              /^\s*(\\label\{[^{}]*\}\s*)*$/.test(doc.sliceString(headTo, hl.to))) {
            const nl = doc.line(hl.number + 1);
            if (nl.text.trim() !== '' && !/^\s*(\\begin\{|\\end\{|\\item\b|\\\[|\$\$)/.test(nl.text)) {
              rep(hl.to, hl.to + 1, Decoration.replace({ widget: new HtmlWidget(' ', 'tv-sym') }));
              joined.add(hl.to);
            }
          }
          break;
        }
        if (kind === 'other') { mark(t.from, t.to, 'tv-cs'); break; }
        const o = own(t.from, t.to);
        if (touch(o ? o.from : t.from, o ? o.to : t.to)) { mark(t.from, t.to, 'tv-cs'); break; }
        if (kind === 'abstract' && o) widget(o.from, o.to, new HtmlWidget('Abstract', 'tv-abstract-head', 'div', 30), true);
        else if (kind === 'bib' && o) widget(o.from, o.to, new HtmlWidget('References', 'tv-h tv-h1 tv-bib-head', 'div', 50), true);
        else if (o) rep(o.from, o.to, HIDE_BLOCK);
        else hide(t.from, t.to);
        break;
      }

      case 'end': {
        if (!t.rec) { mark(t.from, t.to, 'tv-cs'); break; }
        const kind = envKind(t.env, t.rec.begin);
        if (kind === 'other') { mark(t.from, t.to, 'tv-cs'); break; }
        const o = own(t.from, t.to);
        if (touch(o ? o.from : t.from, o ? o.to : t.to)) { mark(t.from, t.to, 'tv-cs'); break; }
        if (t.env === 'proof') {
          if (o) widget(o.from, o.to, new HtmlWidget('□', 'tv-qed tv-in-thm', 'div', 24), true);
          else widget(t.from, t.to, new HtmlWidget('□', 'tv-qed-inline'));
        } else if (o) rep(o.from, o.to, HIDE_BLOCK);
        else hide(t.from, t.to);
        break;
      }

      case 'bibitem': {
        const o = own(t.from, t.to);
        if (touch(o ? o.from : t.from, o ? o.to : t.to)) mark(t.from, t.to, 'tv-cs');
        else if (o) rep(o.from, o.to, HIDE_BLOCK);
        else hide(t.from, next(t.to) === ' ' ? t.to + 1 : t.to);
        break;
      }

      case 'graphics': {
        const o = own(t.from, t.to);
        if (touch(t.from, t.to)) { mark(t.from, t.to, 'tv-src'); break; }
        const w = new FigureWidget(t.path, t.opt, ext.baseUri, sc.meta.graphicsPaths, ext.assetGen, !!o);
        if (o) widget(o.from, o.to, w, true);
        else widget(t.from, t.to, w);
        break;
      }

      case 'maketitle': {
        const o = own(t.from, t.to);
        if (!o) { mark(t.from, t.to, 'tv-cs'); break; }
        const html = titleHtml(sc.meta, ctx);
        if (!touch(o.from, o.to)) widget(o.from, o.to, new HtmlWidget(html, 'tv-titleblock', 'div', 130), true);
        else {
          // the cursor on \maketitle: the command, with the title block kept under it (and still clickable)
          mark(t.from, t.to, 'tv-cs');
          rep(o.to, o.to, Decoration.widget({ widget: new HtmlWidget(html, 'tv-titleblock tv-preview', 'div', 130), block: true, side: 1 }));
        }
        break;
      }

      case 'sym': {
        if (touch(t.from, t.to)) break;
        if (t.text === '') hide(t.from, t.to);
        else widget(t.from, t.to, new HtmlWidget(esc(t.text), 'tv-sym'));
        break;
      }

      case 'cs': {
        if (!t.br && !HIDE.has(t.name)) {
          // a macro the document defines for running text shows what it stands for
          const html = touch(t.from, t.to) ? null : macroHtml(t.name, ctx);
          if (html) {
            const to = doc.sliceString(t.to, t.to + 2) === '{}' ? t.to + 2 : t.to;
            widget(t.from, to, new HtmlWidget(html, 'tv-macro', 'span', -1, { title: '\\' + t.name }));
            break;
          }
        }
        if (t.br || !HIDE.has(t.name)) { mark(t.from, t.to, 'tv-cs'); break; }
        const o = own(t.from, t.to);
        if (touch(o ? o.from : t.from, o ? o.to : t.to)) mark(t.from, t.to, 'tv-cs');
        else if (o) rep(o.from, o.to, HIDE_BLOCK);
        else hide(t.from, next(t.to) === ' ' ? t.to + 1 : t.to);
        break;
      }

      case 'colorsw': {
        // \color{red}: what follows is red to the end of its group. In {\color{red} …} the braces
        // are part of the command, shown and hidden with it.
        paint(t.to, t.scopeTo, t);
        if (touch(t.open ? t.open.from : t.from, t.close ? t.close.to : t.to)) {
          mark(t.open ? t.open.from : t.from, t.to, 'tv-cs');
          if (t.close) mark(t.close.from, t.close.to, 'tv-cs');
        } else {
          hide(t.open ? t.open.from : t.from, next(t.to) === ' ' ? t.to + 1 : t.to);
          if (t.close) hide(t.close.from, t.close.to);
        }
        break;
      }

      case 'raw': {
        if (t.name === 'bibliography' || t.name === 'printbibliography') {
          const o = own(t.from, t.to);
          const html = o ? ctx.referencesHtml() : null;
          if (!html) { mark(t.from, t.to, 'tv-cs'); break; }
          const est = 60 + (html.split('tv-refs-entry').length - 1) * 52;
          if (!touch(o.from, o.to)) widget(o.from, o.to, new HtmlWidget(html, 'tv-refs', 'div', est), true);
          else {
            mark(t.from, t.to, 'tv-cs');
            rep(o.to, o.to, Decoration.widget({ widget: new HtmlWidget(html, 'tv-refs tv-preview', 'div', est), block: true, side: 1 }));
          }
          break;
        }
        const layout = HIDE_RAW.has(t.name) || (t.titlemeta && hasMaketitle) ||
          (t.name === 'renewcommand' && t.target != null && LAYOUT_MACRO.test(t.target));
        if (!layout) { mark(t.from, t.to, 'tv-cs'); break; }
        const o = own(t.from, t.to);
        if (touch(o ? o.from : t.from, o ? o.to : t.to)) mark(t.from, t.to, 'tv-cs');
        else if (o) rep(o.from, o.to, HIDE_BLOCK);
        else if (t.name === 'hspace' || t.name === 'hskip') widget(t.from, t.to, new HtmlWidget(' ', 'tv-sym'));
        else hide(t.from, t.to);
        break;
      }

      case 'enddoc': {
        eachLine(t.from, doc.length, (l) => addLine(l.from, 'tv-pre'));
        break;
      }
      default:
    }
  }

  // ---- environment bodies
  for (const e of sc.envs) {
    const kind = envKind(e.name, e.begin);
    if (kind === 'thm') {
      const cls = e.name === 'proof' ? 'tv-thm tv-proof' : 'tv-thm';
      eachLine(e.from, e.to, (l) => addLine(l.from, cls));
    } else if (kind === 'list') {
      eachLine(e.from, e.to, (l) => { lineInfo(l.from).indent++; });
    } else if (kind === 'abstract') {
      eachLine(e.from, e.to, (l) => addLine(l.from, 'tv-abstract'));
    } else if (kind === 'bib') {
      eachLine(e.from, e.to, (l) => addLine(l.from, 'tv-bib'));
    } else if (kind === 'notes') {
      eachLine(e.from, e.to, (l) => addLine(l.from, 'tv-notes'));
    } else if (CENTERED.has(e.name)) {
      eachLine(e.from, e.to, (l) => addLine(l.from, 'tv-center'));
    } else if (e.name === 'quote' || e.name === 'quotation') {
      eachLine(e.from, e.to, (l) => addLine(l.from, 'tv-quote'));
    }
  }

  // ---- subfigures: one row of images with their (a), (b) captions, unless the cursor is inside
  for (const e of sc.envs) {
    if (!FLOATS[e.name]) continue;
    const subs = sc.envs.filter((x) => SUBFLOATS.has(x.name) && x.from > e.from && x.to < e.to);
    if (subs.length < 2) continue;
    const items = [];
    for (const x of subs) {
      let fig = null, caption = '', n = 0;
      for (let k = firstTokenAt(x.from); k < sc.tokens.length && sc.tokens[k].from < x.to; k++) {
        const u = sc.tokens[k];
        if (u.type === 'graphics') { n++; fig = fig || new FigureWidget(u.path, u.opt, ext.baseUri, sc.meta.graphicsPaths, ext.assetGen, true); }
        else if (u.type === 'tabular' || u.type === 'math' && u.display) n = 9;
        else if (u.type === 'style' && u.kind === 'caption' && !caption) {
          caption = (u.sub ? `<span class="tv-subcaption-label">${esc(u.sub)}</span> ` : '') + texToHtml(doc.sliceString(u.inner.from, u.inner.to), ctx);
        }
      }
      if (n !== 1) { items.length = 0; break; }      // not a plain image per subfigure: leave it as lines
      const m = /([\d.]*)\s*\\(?:textwidth|linewidth|columnwidth|hsize)/.exec(x.begin.arg || '');
      const frac = m ? (m[1] === '' ? 1 : parseFloat(m[1])) : 1 / subs.length;
      items.push({ fig, caption, width: Math.round(Math.min(1, Math.max(0.1, frac)) * 980) / 10 });
    }
    if (!items.length) continue;
    const a = own(subs[0].from, subs[0].begin.to), b = own(subs[subs.length - 1].end.from, subs[subs.length - 1].to);
    if (!a || !b || touch(a.from, b.to)) continue;
    widget(a.from, b.to, new SubRowWidget(items), true);
  }

  // ---- source indentation means nothing in the rendered view: hide it
  {
    const endPos = sc.tail >= 0 ? sc.tail : doc.length;
    for (let n = doc.lineAt(Math.min(doc.length, sc.bodyFrom)).number; n <= doc.lines; n++) {
      const l = doc.line(n);
      if (l.from > endPos) break;
      const c = l.text.charCodeAt(0);
      if (c !== 32 && c !== 9) continue;
      const ws = /^[ \t]+/.exec(l.text)[0].length;
      if (ws === l.length) continue;
      const li = lines.get(l.from);
      if (li && li.cls.some((k) => k === 'tv-src-line' || k === 'tv-pre')) continue;
      if (touch(l.from, l.from + ws - 1)) continue;
      hide(l.from, l.from + ws);
    }
  }

  // ---- a line on which everything is hidden takes no room at all
  if (hidden.length) {
    hidden.sort((a, b) => a.from - b.from);
    for (let k = 0; k < hidden.length;) {
      const l = doc.lineAt(hidden[k].from);
      let pos = l.from, ok = true, q = k;
      for (; q < hidden.length && hidden[q].from <= l.to; q++) {
        const h = hidden[q];
        if (h.from > pos && /\S/.test(doc.sliceString(pos, h.from))) ok = false;
        if (h.to > pos) pos = h.to;
      }
      if (pos > l.to || /\S/.test(doc.sliceString(pos, l.to))) ok = false;
      if (ok && !touch(l.from, l.to)) rep(l.from, l.to, HIDE_BLOCK);
      k = q;
    }
  }

  // ---- a line break inside a paragraph is a space, as it is to TeX: a paragraph fills its lines
  // the same way however its source is wrapped. The source keeps its line breaks.
  if (flow.length) {
    // whole lines taken by a block widget stay out of it
    const blocks = [];
    for (const r of reps) if (r.deco.spec.block) blocks.push([r.from, r.to]);
    blocks.sort((a, b) => a[0] - b[0]);
    let bi = 0, reach = -1;                 // reach: how far the blocks starting before `bi` extend
    const lineKey = (from, lead) => {
      const li = lines.get(from);
      if (!li) return '|0';
      const cls = (lead ? li.cls.filter((c) => c !== 'tv-li-first') : li.cls).slice().sort().join(' ');
      return cls + '|' + li.indent;
    };
    for (const b of flow) {
      if (b.after === 'label' && !joined.has(b.line - 1)) continue;
      while (bi < blocks.length && blocks[bi][0] <= b.at + 1) { if (blocks[bi][1] > reach) reach = blocks[bi][1]; bi++; }
      if (reach >= b.at) continue;
      const ka = lineKey(b.line, true), kb = lineKey(b.at + 1, false);
      if (ka !== kb || OWN_LINE.test(ka)) continue;
      // a space is already there when the line ends in one
      const c = b.at > b.line ? doc.sliceString(b.at - 1, b.at) : '';
      rep(b.at, b.at + 1, c === ' ' || c === '\t' ? HIDE_INLINE : JOIN);
      joined.add(b.at);
    }
  }

  // ---- assemble: drop replace ranges that start inside an earlier one
  reps.sort((a, b) => a.from - b.from || b.to - a.to);
  const out = marks;
  const blocks = [];
  let covered = -1;
  for (const r of reps) {
    if (r.from < covered) continue;
    if (r.to > r.from) {
      covered = r.to;
      if (r.deco.spec.block) blocks.push(r);
    }
    out.push(r.deco.range(r.from, r.to));
  }
  let bi = 0;
  const froms = [...lines.keys()].sort((a, b) => a - b);
  for (const from of froms) {
    while (bi < blocks.length && blocks[bi].to < from) bi++;
    if (bi < blocks.length && blocks[bi].from <= from) continue; // line is replaced by a block widget
    const li = lines.get(from);
    const attrs = {};
    if (li.cls.length) attrs.class = li.cls.join(' ');
    if (li.indent) attrs.style = `--tv-indent:${li.indent}`;
    out.push(Decoration.line({ attributes: attrs }).range(from));
  }
  return Decoration.set(out, true);
}

export const decoField = StateField.define({
  create: build,
  update(v, tr) {
    if (tr.docChanged || tr.selection || tr.effects.length ||
        tr.startState.field(parseField) !== tr.state.field(parseField)) return build(tr.state);
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ------------------------------------------------------------------ inline math preview tooltip

function mathAt(state) {
  if (state.field(modeField).source || !state.field(focusField)) return null;
  const main = state.selection.main;
  if (!main.empty) return null;
  const { sc } = state.field(parseField);
  const p = main.head;
  for (const t of sc.tokens) {
    if (t.from > p) break;
    if (t.type === 'math' && !t.display && t.to >= p) return t;
  }
  return null;
}

export const mathTip = StateField.define({
  create: () => null,
  update(v, tr) {
    if (!tr.docChanged && !tr.selection && !tr.effects.length) return v;
    const t = mathAt(tr.state);
    if (!t || !t.tex.trim()) return null;
    if (v && v.from === t.from) return { from: v.from, tex: t.tex, tooltip: v.tooltip };
    const tooltip = {
      pos: t.from,
      above: true,
      arrow: false,
      create(view) {
        const dom = document.createElement('div');
        dom.className = 'tv-math-tip';
        let shown = null;
        const paint = (state) => {
          const cur = state.field(mathTip);
          if (!cur || cur.tex === shown) return;
          shown = cur.tex;
          const html = renderMath(cur.tex, false);
          // Mid-edit the formula is often unparsable: keep the last good rendering, dimmed.
          const bad = isMathError(html);
          dom.classList.toggle('tv-stale', bad);
          if (!bad || !dom.firstChild) dom.innerHTML = html;
        };
        paint(view.state);
        return { dom, update(u) { paint(u.state); } };
      },
    };
    return { from: t.from, tex: t.tex, tooltip };
  },
  provide: (f) => showTooltip.from(f, (v) => (v ? v.tooltip : null)),
});

/**
 * Where a part of the title block is written: inside \title{…}, \author{…} or \date{…}, or inside
 * its `note`-th \thanks{…}. Null when the command is not in this file.
 */
export function titlePartPos(state, name, note) {
  const src = state.field(parseField).sc.titleSrc[name];
  if (!src) return null;
  const text = state.doc.sliceString(src.arg.from, src.arg.to);
  if (note != null) {
    const re = /\\thanks\s*\{\s*/g;
    let m, k = Number(note);
    while ((m = re.exec(text))) if (k-- === 0) return src.arg.from + m.index + m[0].length;
  }
  return src.arg.from + /^\s*/.exec(text)[0].length;
}

/** A cursor position in the body that touches no token, so nothing is revealed on open. */
export function neutralPos(state) {
  const { sc } = state.field(parseField);
  const doc = state.doc;
  let ti = 0;
  for (let n = doc.lineAt(Math.min(doc.length, sc.bodyFrom)).number; n <= doc.lines; n++) {
    const l = doc.line(n);
    while (ti < sc.tokens.length && sc.tokens[ti].to < l.from) ti++;
    let hit = false;
    for (let k = ti; k < sc.tokens.length && sc.tokens[k].from <= l.from; k++) if (sc.tokens[k].to >= l.from) { hit = true; break; }
    if (!hit) return l.from;
  }
  return Math.min(doc.length, sc.bodyFrom);
}
