// Rendering helpers: KaTeX with the document's macros, a small LaTeX-text-to-HTML
// converter for widgets (title block, table cells, item labels), and tabular rendering.
import katex from 'katex';
import { scan, matchBrace, today } from './latex.js';

let macros = {};
let macroSig = null;
let cache = new Map();
export let renderGen = 0; // bumps whenever macros change, so widgets know to re-render

export function setMacros(defs) {
  const sig = defs.map((d) => d.tex).join('\n');
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

export function renderMath(tex, display) {
  const key = (display ? 'D' : 'I') + tex;
  let html = cache.get(key);
  if (html !== undefined) return html;
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
  color: ['', ''],
};

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
        const tag = t.type === 'section' ? STYLE_TAG.b : STYLE_TAG[t.kind] || ['', ''];
        ev.push({ from: t.open.from, to: t.open.to, html: tag[0] });
        ev.push({ from: t.close.from, to: t.close.to, html: tag[1] });
        break;
      }
      case 'ref': ev.push({ from: t.from, to: t.to, html: esc(ctx.refText ? ctx.refText(t) : t.keys.join(', ')) }); break;
      case 'cite': ev.push({ from: t.from, to: t.to, html: esc(ctx.citeText ? ctx.citeText(t) : t.keys.join(', ')) }); break;
      case 'url': ev.push({ from: t.from, to: t.to, html: `<span class="tv-link">${esc(t.url)}</span>` }); break;
      case 'cs':
        if (t.br) ev.push({ from: t.from, to: t.to, html: '<br>' });
        else if (t.name === 'and') ev.push({ from: t.from, to: t.to, html: ' &nbsp;·&nbsp; ' });
        else ev.push({ from: t.from, to: t.to, html: '' });
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

export function titleHtml(meta, ctx) {
  let h = '';
  if (meta.title) h += `<div class="tv-title">${texToHtml(meta.title, ctx)}</div>`;
  if (meta.author) h += `<div class="tv-author">${texToHtml(meta.author, ctx)}</div>`;
  const date = meta.date === undefined ? today() : meta.date;
  if (date) h += `<div class="tv-date">${texToHtml(date, ctx)}</div>`;
  return h || '<div class="tv-date">\\maketitle</div>';
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
      cols.push('left');
      if (spec[i + 1] === '{') { const k = matchBrace(spec, i + 1); if (k >= 0) i = k; }
    } else if (c === 'S' || c === 'D' || c === 'd' || c === 'R') {
      cols.push('right');
      if (spec[i + 1] === '{' || spec[i + 1] === '[') { const k = spec[i + 1] === '{' ? matchBrace(spec, i + 1) : spec.indexOf(']', i); if (k >= 0) i = k; }
    } else if (c === 'C') cols.push('center');
  }
  return cols;
}

function splitTop(src, sepRe) {
  // split at top-level separators: '&' or '\\\\'
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      if (sepRe === '\\\\' && src[i + 1] === '\\' && depth === 0) {
        parts.push(src.slice(start, i));
        i += 2;
        if (src[i] === '*') i++;
        const m = /^\s*\[[^\]]*\]/.exec(src.slice(i, i + 30));
        if (m) i += m[0].length;
        start = i; i--;
        continue;
      }
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '$') { const e = src.indexOf('$', i + 1); if (e > 0) i = e; }
    else if (sepRe === '&' && c === '&' && depth === 0) { parts.push(src.slice(start, i)); start = i + 1; }
  }
  parts.push(src.slice(start));
  return parts;
}

const RULE_RE = /^\s*\\(toprule|midrule|bottomrule|hline|cmidrule|cline|addlinespace|specialrule|noalign|morecmidrules|endhead|endfirsthead|endfoot|endlastfoot)\b\s*(\([^)]*\))?\s*(\[[^\]]*\])?\s*(\{[^{}]*\})?/;

export function tabularHtml(src, ctx = {}) {
  // src is the full \begin{tabular}...\end{tabular} source
  const m = /^\\begin\{([a-z*]+)\}/.exec(src);
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
  const body = src.slice(i, end).replace(/(^|[^\\])%.*$/gm, '$1');
  const rows = [];
  let pendingRule = null;
  for (let raw of splitTop(body, '\\\\')) {
    let rule = pendingRule;
    pendingRule = null;
    let mm;
    while ((mm = RULE_RE.exec(raw))) {
      const r = mm[1];
      if (r === 'toprule' || r === 'bottomrule') rule = 'heavy';
      else if (r === 'midrule' || r === 'hline') rule = rule === 'heavy' ? 'heavy' : 'light';
      else if ((r === 'cmidrule' || r === 'cline') && !rule) rule = 'partial';
      raw = raw.slice(mm[0].length);
    }
    if (raw.trim() === '') { if (rule) pendingRule = rule; continue; }
    rows.push({ rule, cells: splitTop(raw, '&') });
  }
  let html = '<table class="tv-table"><tbody>';
  rows.forEach((row, ri) => {
    const cls = [];
    if (row.rule === 'heavy') cls.push('tv-rule-heavy');
    else if (row.rule === 'light') cls.push('tv-rule-light');
    if (ri === rows.length - 1 && pendingRule) cls.push(pendingRule === 'heavy' ? 'tv-rule-bottom-heavy' : 'tv-rule-bottom-light');
    html += `<tr class="${cls.join(' ')}">`;
    let ci = 0;
    for (let cell of row.cells) {
      cell = cell.trim();
      let span = 1, align = cols[ci] || 'left';
      const mc = /^\\multicolumn\s*\{(\d+)\}\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*\{/.exec(cell);
      if (mc) {
        span = parseInt(mc[1], 10) || 1;
        const a = parseColSpec(mc[2])[0];
        if (a) align = a;
        const k = matchBrace(cell, mc[0].length - 1);
        cell = k >= 0 ? cell.slice(mc[0].length, k) : cell.slice(mc[0].length);
      }
      html += `<td style="text-align:${align}"${span > 1 ? ` colspan="${span}"` : ''}>${texToHtml(cell, ctx)}</td>`;
      ci += span;
    }
    html += '</tr>';
  });
  return html + '</tbody></table>';
}
