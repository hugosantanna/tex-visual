// Rendering helpers: KaTeX with the document's macros, a small LaTeX-text-to-HTML
// converter for widgets (title block, table cells, item labels), and tabular rendering.
import katex from 'katex';
import { scan, matchBrace, today } from './latex.js';
import { cssColor } from './color.js';

let macros = {};
let macroSig = null;
let colorMeta = null;      // the document's colors, for the ones math names
let cache = new Map();
export let renderGen = 0; // bumps whenever macros change, so widgets know to re-render

export function setMacros(defs, meta = null) {
  const sig = defs.map((d) => d.tex).join('\n') + '\n' + (meta && meta.colorSig || '');
  colorMeta = meta;
  if (sig === macroSig) return false;
  macroSig = sig;
  macros = {};
  for (const d of defs) {
    for (const cmd of ['\\newcommand', '\\renewcommand']) {
      try {
        katex.renderToString(cmd + d.tex, { macros, globalGroup: true, throwOnError: true, strict: 'ignore' });
        break;
      } catch (e) { /* try \renewcommand, else skip this definition */ }
    }
  }
  cache = new Map();
  renderGen++;
  return true;
}

// KaTeX takes CSS colors only: give it the color that an xcolor name, a color of the document's
// or a mix (red!60!black) stands for.
const mathColors = (tex) => (tex.includes('color{') || tex.includes('color[')
  ? tex.replace(/\\(textcolor|color|colorbox)\s*(?:\[([^\]]*)\]\s*)?\{([^{}#]*)\}/g, (m, cmd, model, spec) => {
    const c = cssColor(spec, model, colorMeta);
    return c ? `\\${cmd}{${c}}` : m;
  })
  : tex);
// …and its colors go through --tv-c like the colors of text, so a dark theme can lift them (app.css)
const themedColors = (html) => html.replace(/(style="(?:[^"]*;)?)color:(#[0-9a-f]{6});/gi, '$1--tv-c:$2;');

export function renderMath(tex, display) {
  const key = (display ? 'D' : 'I') + tex;
  let html = cache.get(key);
  if (html !== undefined) return html;
  tex = mathColors(tex);
  try {
    html = katex.renderToString(tex, {
      displayMode: display, throwOnError: true, strict: 'ignore', output: 'html', macros, trust: false,
    });
  } catch (e) {
    const msg = String(e && e.message || e).replace(/^KaTeX parse error: /, '');
    try {
      html = katex.renderToString(tex, {
        displayMode: display, throwOnError: false, strict: 'ignore', output: 'html', macros, trust: false,
      });
      html = `<span class="tv-math-err" title="${esc(msg)}">${html}</span>`;
    } catch (e2) {
      html = `<span class="tv-math-err" title="${esc(msg)}">${esc(tex)}</span>`;
    }
  }
  html = themedColors(html);
  if (cache.size > 8000) cache = new Map();
  cache.set(key, html);
  return html;
}

/** True when renderMath() had to fall back to KaTeX's error output. */
export const isMathError = (html) => html.startsWith('<span class="tv-math-err"');

export function esc(s) {
  // U+00A0 is drawn as an ordinary space: the text font's no-break glyph is twice as wide.
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\u00A0/g, ' ');
}

const KATEX_TAIL = '</span></span></span>';
const KATEX_HEAD = '<span class="base">';
/** Attach adjacent punctuation to the formula so a line never breaks between them. */
export function withGlue(html, before, after) {
  if (!before && !after) return html;
  const g = (t) => `<span class="tv-glue">${esc(t)}</span>`;
  const h = html.indexOf(KATEX_HEAD);
  if (html.endsWith(KATEX_TAIL) && h >= 0) {
    let out = html;
    if (after) out = out.slice(0, -KATEX_TAIL.length) + g(after) + KATEX_TAIL;
    if (before) out = out.slice(0, h + KATEX_HEAD.length) + g(before) + out.slice(h + KATEX_HEAD.length);
    return out;
  }
  return `<span class="tv-nowrap">${before ? g(before) : ''}${html}${after ? g(after) : ''}</span>`;
}

const STYLE_TAG = {
  em: ['<em>', '</em>'], b: ['<strong>', '</strong>'], sc: ['<span class="tv-sc">', '</span>'],
  tt: ['<code>', '</code>'], u: ['<u>', '</u>'], rm: ['<span class="tv-rm">', '</span>'],
  sf: ['<span class="tv-sf">', '</span>'], fn: ['<span class="tv-fn-inline"> (', ')</span>'],
  sup: ['<sup>', '</sup>'], sub: ['<sub>', '</sub>'], caption: ['', ''], href: ['<span class="tv-link">', '</span>'],
  color: ['', ''], strike: ['<s>', '</s>'],
};

/**
 * The class and style that put a token's color and background on screen (and the strike-through
 * a macro like \cut brings with its color), or null when it has none of them.
 */
export function colorAttrs(t) {
  if (!t.color && !t.bg && !t.strike) return null;
  return {
    class: [t.color && 'tv-color', t.bg && 'tv-bgc', t.strike && 'tv-strike'].filter(Boolean).join(' '),
    style: (t.color ? `--tv-c:${t.color};` : '') + (t.bg ? `--tv-b:${t.bg};` : ''),
  };
}

/**
 * Convert a short run of LaTeX text to HTML. ctx may provide refText(key, name) and
 * citeText(token) for cross references.
 */
export function texToHtml(src, ctx = {}) {
  if (!src) return '';
  const { tokens } = scan(src, { fragment: true, meta: ctx.meta });
  const ev = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'math':
        ev.push({ from: t.from, to: t.to, html: renderMath(src.slice(t.body.from, t.body.to).replace(/\\label\s*\{[^{}]*\}/g, ''), t.display) });
        break;
      case 'sym': ev.push({ from: t.from, to: t.to, html: esc(t.text) }); break;
      case 'style': case 'section': {
        if (t.name === 'thanks' && ctx.thanks) {
          // title block: the note moves under the block, a mark stays behind
          ctx.thanks.push(src.slice(t.inner.from, t.inner.to));
          ev.push({ from: t.from, to: t.to, html: `<sup class="tv-thanks">${thanksMark(ctx.thanks.length - 1)}</sup>` });
          break;
        }
        const tag = t.type === 'section' ? STYLE_TAG.b : STYLE_TAG[t.kind] || ['', ''];
        const c = colorAttrs(t);
        ev.push({ from: t.open.from, to: t.open.to, html: (c ? `<span class="${c.class}" style="${c.style}">` : '') + tag[0] });
        ev.push({ from: t.close.from, to: t.close.to, html: tag[1] + (c ? '</span>' : '') });
        break;
      }
      case 'colorsw': {          // \color{…}: a span from the command to the end of its group
        const c = colorAttrs(t);
        ev.push({ from: t.from, to: t.to, html: c ? `<span class="${c.class}" style="${c.style}">` : '' });
        if (c) ev.push({ from: t.scopeTo, to: t.scopeTo, html: '</span>' });
        break;
      }
      case 'ref': ev.push({ from: t.from, to: t.to, html: esc(ctx.refText ? ctx.refText(t) : t.keys.join(', ')) }); break;
      case 'cite': ev.push({ from: t.from, to: t.to, html: esc(ctx.citeText ? ctx.citeText(t) : t.keys.join(', ')) }); break;
      case 'url': ev.push({ from: t.from, to: t.to, html: `<span class="tv-link">${esc(t.url)}</span>` }); break;
      case 'cs':
        if (t.br) ev.push({ from: t.from, to: t.to, html: '<br>' });
        else if (t.name === 'and') ev.push({ from: t.from, to: t.to, html: ' &nbsp;·&nbsp; ' });
        else ev.push({ from: t.from, to: t.to, html: macroHtml(t.name, ctx) || '' });
        break;
      case 'item': ev.push({ from: t.from, to: t.to, html: '• ' }); break;
      case 'verb': ev.push({ from: t.from, to: t.to, html: `<code>${esc(src.slice(t.from, t.to))}</code>` }); break;
      default: ev.push({ from: t.from, to: t.to, html: '' });
    }
  }
  ev.sort((a, b) => a.from - b.from || a.to - b.to);
  let out = '', pos = 0;
  const plain = (s) => esc(s.replace(/[{}]/g, ''));
  for (const e of ev) {
    if (e.from < pos) continue;
    out += plain(src.slice(pos, e.from)) + e.html;
    pos = e.to;
  }
  return out + plain(src.slice(pos));
}

const THANKS = ['*', '†', '‡', '§', '¶', '‖'];
const thanksMark = (i) => THANKS[i % THANKS.length].repeat(Math.floor(i / THANKS.length) + 1);

const MATHY = /\\(ensuremath|math[a-z]+|operatorname|frac|hat|bar|tilde|widehat|overline|mathbb|mathcal)\b|[_^]/;

/** A macro of the document's own used in running text (\\newcommand{\\nObs}{11,672}), or null. */
export function macroHtml(name, ctx = {}) {
  const defs = ctx.meta && ctx.meta.textMacros;
  if (!defs || !Object.prototype.hasOwnProperty.call(defs, name)) return null;
  const body = defs[name];
  if (!body.trim()) return null;
  if (MATHY.test(body)) return renderMath(body.replace(/\\ensuremath/g, ''), false);
  const depth = ctx.macroDepth || 0;
  if (depth > 4) return null;
  return texToHtml(body, Object.assign({}, ctx, { macroDepth: depth + 1 }));
}

export function titleHtml(meta, ctx) {
  let h = '';
  const notes = [], owner = [];
  const c = Object.assign({}, ctx, { thanks: notes });
  // data-meta names the command a part comes from, so a click on it can go to where it is written
  const part = (name, tex) => {
    h += `<div class="tv-${name}" data-meta="${name}">${texToHtml(tex, c)}</div>`;
    while (owner.length < notes.length) owner.push(name);
  };
  if (meta.title) part('title', meta.title);
  if (meta.author && meta.author.trim()) part('author', meta.author);
  const date = meta.date === undefined ? today() : meta.date;
  if (date) part('date', date);
  // \thanks notes, in the order LaTeX numbers them
  if (notes.length) {
    const nth = {};
    h += '<div class="tv-title-notes">' + notes.map((n, i) => {
      const k = nth[owner[i]] = (nth[owner[i]] || 0) + 1;
      return `<div class="tv-title-note" data-meta="${owner[i]}" data-note="${k - 1}"><sup class="tv-thanks">${thanksMark(i)}</sup>${texToHtml(n, ctx)}</div>`;
    }).join('') + '</div>';
  }
  return h || '<div class="tv-date">\\maketitle</div>';
}

/** A file pulled in with \input: its tables (and their captions), or null if it holds none. */
export function inputHtml(src, ctx = {}, sub = null) {
  const { tokens } = sub || scan(src, { fragment: true, meta: ctx.meta });
  let html = '', n = 0;
  for (const t of tokens) {
    if (t.type === 'tabular') {
      const h = tabularHtml(src.slice(t.from, t.to), ctx, t.from);
      if (h) { html += `<div class="tv-input-table">${h}</div>`; n++; }
    } else if (t.type === 'style' && t.kind === 'caption' && !t.star) {
      const label = t.num ? `<span class="tv-caption-label">${t.floatName} ${esc(t.num)}:&nbsp;</span>` : '';
      html += `<div class="tv-input-caption">${label}${texToHtml(src.slice(t.inner.from, t.inner.to), ctx)}</div>`;
    }
  }
  return n ? html : null;
}

/** The reference list: entries is [{ key, r }] with r a line of LaTeX text. */
export function referencesHtml(entries, ctx = {}) {
  const rows = entries.map((e) => {
    const html = texToHtml(e.r, ctx);
    return { key: e.key, html, sort: html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ') };
  });
  rows.sort((a, b) => a.sort.localeCompare(b.sort, 'en', { sensitivity: 'base' }));
  return '<div class="tv-h tv-h1 tv-bib-head">References</div>' +
    rows.map((r) => `<div class="tv-refs-entry" data-bibkey="${esc(r.key)}">${r.html}</div>`).join('');
}

// ---------------------------------------------------------------- tabular

function parseColSpec(spec) {
  const cols = [];
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i];
    if (c === '@' || c === '!' || c === '>' || c === '<') {
      const j = spec.indexOf('{', i);
      const k = j >= 0 ? matchBrace(spec, j) : -1;
      if (k >= 0) i = k;
      continue;
    }
    if (c === '*') {
      const j = spec.indexOf('{', i), k = j >= 0 ? matchBrace(spec, j) : -1;
      const j2 = k >= 0 ? spec.indexOf('{', k) : -1, k2 = j2 >= 0 ? matchBrace(spec, j2) : -1;
      if (k2 < 0) continue;
      const rep = parseInt(spec.slice(j + 1, k), 10) || 1;
      const sub = parseColSpec(spec.slice(j2 + 1, k2));
      for (let r = 0; r < rep; r++) cols.push(...sub);
      i = k2;
      continue;
    }
    if (c === 'l' || c === 'c' || c === 'r') cols.push(c === 'l' ? 'left' : c === 'c' ? 'center' : 'right');
    else if (c === 'p' || c === 'm' || c === 'b' || c === 'X' || c === 'L') {
      cols.push('para');
      if (spec[i + 1] === '{') { const k = matchBrace(spec, i + 1); if (k >= 0) i = k; }
    } else if (c === 'S' || c === 'D' || c === 'd' || c === 'R') {
      cols.push('right');
      if (spec[i + 1] === '{' || spec[i + 1] === '[') { const k = spec[i + 1] === '{' ? matchBrace(spec, i + 1) : spec.indexOf(']', i); if (k >= 0) i = k; }
    } else if (c === 'C') cols.push('center');
  }
  return cols;
}

const RULE_RE = /^\\(toprule|midrule|bottomrule|hline|cmidrule|cline|addlinespace|specialrule|noalign|morecmidrules|endhead|endfirsthead|endfoot|endlastfoot)\b\s*(\([^)]*\))?\s*(\[[^\]]*\])?\s*(\{[^{}]*\})?/;
const SKIP_RE = /^(?:\s+|%[^\n]*(?:\n|$))+/;      // whitespace and comments between rules
const isSpace = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r';

/** The content of a cell: [from, to) without surrounding whitespace, leading comments, or a comment that ends it. */
function trimCell(src, a, b) {
  const sk = SKIP_RE.exec(src.slice(a, b));
  if (sk) a += sk[0].length;
  for (;;) {
    while (b > a && isSpace(src[b - 1])) b--;
    let pc = -1;
    for (let p = Math.max(a, src.lastIndexOf('\n', b - 1) + 1); p < b; p++) {
      if (src[p] === '\\') { p++; continue; }
      if (src[p] === '%') { pc = p; break; }
    }
    if (pc < 0) break;
    b = pc;
  }
  return [a, Math.max(a, b)];
}

/**
 * Rows and cells of a \begin{tabular}...\end{tabular} source, each cell with the range of its
 * content in src, so a cell can be edited in place. Returns
 * { cols, rows: [{ rule, end, cells: [{ from, to, span, align, para }] }], bottom } or null.
 */
export function tabularModel(src) {
  const m = /^\\begin\{([a-zA-Z*]+)\}/.exec(src);
  if (!m) return null;
  let i = m[0].length;
  const end = src.lastIndexOf('\\end{' + m[1] + '}');
  if (end < 0) return null;
  if (m[1] === 'tabular*' || m[1] === 'tabularx' || m[1] === 'tabulary') {
    const k = src[i] === '{' ? matchBrace(src, i) : -1;
    if (k >= 0) i = k + 1;
  }
  if (src[i] === '[') { const k = src.indexOf(']', i); if (k >= 0) i = k + 1; }
  let spec = '';
  if (src[i] === '{') {
    const k = matchBrace(src, i);
    if (k < 0) return null;
    spec = src.slice(i + 1, k);
    i = k + 1;
  }
  const cols = parseColSpec(spec);

  // split [i, end) at top-level \\ into rows and at top-level & into cells, keeping offsets
  const raw = [];
  let depth = 0, cellFrom = i, cur = { cells: [], end: null };
  for (let p = i; p < end; p++) {
    const c = src[p];
    if (c === '%') { const nl = src.indexOf('\n', p); p = nl < 0 || nl >= end ? end : nl; continue; }
    if (c === '\\') {
      if (src[p + 1] === '\\' && depth === 0) {
        cur.cells.push({ from: cellFrom, to: p });
        let q = p + 2;
        if (src[q] === '*') q++;
        const o = /^[ \t]*\[[^\]\n]*\]/.exec(src.slice(q, q + 30));
        if (o) q += o[0].length;
        cur.end = q;
        raw.push(cur);
        cur = { cells: [], end: null };
        cellFrom = q; p = q - 1;
        continue;
      }
      p++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '$') { const e = src.indexOf('$', p + 1); if (e > 0 && e < end) p = e; }
    else if (c === '&' && depth === 0) { cur.cells.push({ from: cellFrom, to: p }); cellFrom = p + 1; }
  }
  cur.cells.push({ from: cellFrom, to: end });
  raw.push(cur);

  const rows = [];
  let pending = null;
  for (const r of raw) {
    let rule = pending;
    pending = null;
    // rules in front of the row belong to its top edge
    let at = r.cells[0].from;
    const stop = r.cells[0].to;
    for (;;) {
      const sk = SKIP_RE.exec(src.slice(at, stop));
      const q = at + (sk ? sk[0].length : 0);
      const mm = RULE_RE.exec(src.slice(q, stop));
      if (!mm) break;
      const name = mm[1];
      if (name === 'toprule' || name === 'bottomrule') rule = 'heavy';
      else if (name === 'midrule' || name === 'hline') rule = rule === 'heavy' ? 'heavy' : 'light';
      else if ((name === 'cmidrule' || name === 'cline') && !rule) rule = 'partial';
      at = q + mm[0].length;
    }
    r.cells[0].from = at;
    const cells = [];
    let ci = 0, any = false;
    for (let idx = 0; idx < r.cells.length; idx++) {
      const c = r.cells[idx];
      let [a, b] = trimCell(src, c.from, c.to);
      let span = 1, align = cols[ci] || 'left';
      const mc = /^\\multicolumn\s*\{(\d+)\}\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*\{/.exec(src.slice(a, b));
      if (mc) {
        span = parseInt(mc[1], 10) || 1;
        const al = parseColSpec(mc[2])[0];
        if (al) align = al;
        const open = a + mc[0].length - 1, k = matchBrace(src, open, b);
        [a, b] = trimCell(src, open + 1, k >= 0 ? k : b);
      }
      if (a < b) any = true;
      else if (!mc) {
        // an empty cell: new text goes one space in. When the gap runs over a line break or a
        // comment (the first cell of a row), it goes at the end of the gap, in front of the &.
        const gap = src.slice(c.from, c.to);
        const sameLine = idx > 0 && idx === r.cells.length - 1;
        a = b = !sameLine && /[\n%]/.test(gap) ? c.to : c.from + (gap[0] === ' ' ? 1 : 0);
      }
      const para = align === 'para';
      cells.push({ from: a, to: b, span, align: para ? 'left' : align, para });
      ci += span;
    }
    if (!any && cells.length === 1) { if (rule) pending = rule; continue; }   // nothing but rules
    rows.push({ rule, end: r.end, cells });
  }
  return { cols, rows, bottom: pending };
}

/**
 * HTML for a tabular. Every cell carries data-c="from:to", the range of its content in the
 * text the table came from (base is where src starts in that text).
 */
export function tabularHtml(src, ctx = {}, base = 0) {
  const model = tabularModel(src);
  if (!model) return null;
  const { rows, bottom } = model;
  const width = Math.max(model.cols.length, ...rows.map((r) => r.cells.reduce((n, c) => n + c.span, 0)));
  let html = '<table class="tv-table"><tbody>';
  rows.forEach((row, ri) => {
    const cls = [];
    if (row.rule === 'heavy') cls.push('tv-rule-heavy');
    else if (row.rule === 'light') cls.push('tv-rule-light');
    if (ri === rows.length - 1 && bottom) cls.push(bottom === 'heavy' ? 'tv-rule-bottom-heavy' : 'tv-rule-bottom-light');
    html += `<tr class="${cls.join(' ')}"${row.end != null ? ` data-end="${base + row.end}"` : ''} data-n="${width}">`;
    for (const c of row.cells) {
      html += `<td style="text-align:${c.align}" data-c="${base + c.from}:${base + c.to}"${c.para ? ' class="tv-para"' : ''}${c.span > 1 ? ` colspan="${c.span}"` : ''}>${texToHtml(src.slice(c.from, c.to), ctx)}</td>`;
    }
    html += '</tr>';
  });
  return html + '</tbody></table>';
}
