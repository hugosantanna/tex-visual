// Lightweight LaTeX scanner. Produces a flat, position-sorted token list that the
// decoration layer turns into rendered widgets. It is deliberately forgiving: anything
// it does not understand is left alone and shows up as plain source.
import { findColor, cssColor } from './color.js';

export const MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*',
  'flalign', 'flalign*', 'alignat', 'alignat*', 'eqnarray', 'eqnarray*', 'displaymath', 'math',
]);
const VERB_ENVS = new Set([
  'verbatim', 'verbatim*', 'lstlisting', 'minted', 'tikzpicture', 'comment', 'filecontents',
  'filecontents*', 'algorithm', 'algorithmic', 'algorithm2e', 'Verbatim',
]);
const TABLE_ENVS = new Set(['tabular', 'tabular*', 'tabularx', 'longtable', 'tabulary']);
export const LIST_ENVS = new Set(['itemize', 'enumerate', 'description']);
const DEFAULT_THEOREMS = {
  theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition', corollary: 'Corollary',
  definition: 'Definition', remark: 'Remark', example: 'Example', assumption: 'Assumption',
  claim: 'Claim', conjecture: 'Conjecture', fact: 'Fact', result: 'Result',
  hypothesis: 'Hypothesis', observation: 'Observation', condition: 'Condition',
};
const STYLE = {
  emph: 'em', textit: 'em', textsl: 'em', textbf: 'b', textsc: 'sc', texttt: 'tt',
  underline: 'u', textrm: 'rm', textsf: 'sf', textup: 'rm', textnormal: 'rm', mbox: 'rm',
  footnote: 'fn', caption: 'caption', href: 'href', textcolor: 'color', uline: 'u',
  textsuperscript: 'sup', textsubscript: 'sub', thanks: 'fn', subcaption: 'caption',
  textmd: 'rm', footnotetext: 'fn',
};
// \name{layout}...{content}: the leading arguments only steer layout, the last one is text.
const WRAP = {
  parbox: 1, multirow: 2, resizebox: 2, scalebox: 1, raisebox: 1, rotatebox: 1,
  makebox: 0, fbox: 0, framebox: 0, makecell: 0, shortstack: 0, hyperref: 0, floatfoot: 0,
  centerline: 0, thead: 0,
};
// Environments whose \begin takes mandatory arguments (hidden along with it).
const ENV_ARGS = {
  thebibliography: 1, minipage: 1, subfigure: 1, subtable: 1, wrapfigure: 2, wraptable: 2,
  adjustbox: 1, adjustwidth: 2, spacing: 1, multicols: 1,
};
export const FLOATS = {
  figure: 'figure', 'figure*': 'figure', table: 'table', 'table*': 'table',
  sidewaysfigure: 'figure', sidewaystable: 'table', 'sidewaysfigure*': 'figure',
  'sidewaystable*': 'table', wrapfigure: 'figure', wraptable: 'table',
};
export const SUBFLOATS = new Set(['subfigure', 'subtable']);
const SECTION = {
  part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5,
};
const REF = new Set(['ref', 'eqref', 'cref', 'Cref', 'autoref', 'pageref', 'nameref', 'vref', 'subref']);
const CITE_RE = /^(cite|citet|citep|citealt|citealp|citeauthor|citeyear|citeyearpar|textcite|parencite|footcite|autocite|Citet|Citep|Textcite|Parencite|nocite|citenum)$/;
// Commands that only steer layout: hidden in the visual view.
export const HIDE = new Set([
  'noindent', 'centering', 'medskip', 'smallskip', 'bigskip', 'FloatBarrier', 'newpage',
  'clearpage', 'par', 'indent', 'raggedright', 'raggedleft', 'pagebreak', 'cleardoublepage',
  'hfill', 'vfill', 'appendix', 'small', 'footnotesize', 'normalsize', 'large', 'Large',
  'onehalfspacing', 'doublespacing', 'singlespacing', 'sloppy', 'nopagebreak', 'linebreak',
  'protect', 'displaystyle', 'bfseries', 'itshape', 'scriptsize', 'tiny', 'LARGE', 'huge',
  'Huge', 'mdseries', 'upshape', 'rmfamily', 'sffamily', 'normalfont', 'newline', 'relax',
  'flushbottom', 'raggedbottom', 'frenchspacing', 'selectfont', 'strut', 'null', 'hrulefill',
  'justifying', 'midsloppy', 'fussy', 'allowdisplaybreaks', 'leavevmode', 'smallbreak',
  'medbreak', 'bigbreak', 'vfil', 'hfil', 'onecolumn', 'twocolumn', 'maketitlepage', 'hrule',
  'newblock',
]);
// Layout commands with arguments: shown as source in the preamble, hidden in the body.
export const HIDE_RAW = new Set([
  'vspace', 'hspace', 'setlength', 'addtolength', 'captionsetup', 'pagestyle', 'thispagestyle',
  'setcounter', 'addtocounter', 'pagenumbering', 'linespread', 'enlargethispage', 'fontsize',
  'bibliographystyle', 'numberwithin', 'counterwithin', 'setstretch', 'phantom', 'hphantom', 'vphantom',
  'crefalias', 'crefname', 'Crefname',
  'vskip', 'hskip', 'addvspace', 'pdfbookmark', 'addcontentsline', 'markboth', 'markright',
  'sethlcolor',
]);
// Commands shown as dim source together with their arguments.
const RAW_ARGS = {
  vspace: 1, hspace: 1, setlength: 2, pagestyle: 1, thispagestyle: 1, bibliographystyle: 1,
  setcounter: 2, addtocounter: 2, usepackage: 1, documentclass: 1, graphicspath: 1,
  numberwithin: 2, counterwithin: 2, theoremstyle: 1, newtheorem: 2, title: 1, author: 1, date: 1,
  renewcommand: 2, newcommand: 2, providecommand: 2, DeclareMathOperator: 2,
  bibliography: 1, addbibresource: 1, printbibliography: 0, geometry: 1, hypersetup: 1,
  linespread: 1, pagenumbering: 1, definecolor: 3, color: 1, phantom: 1, rule: 2,
  include: 1, includeonly: 1, subfile: 1, tableofcontents: 0, keywords: 1, JEL: 1,
  captionsetup: 1, addtolength: 2, enlargethispage: 1, fontsize: 2, setstretch: 1,
  hphantom: 1, vphantom: 1, addvspace: 1, pdfbookmark: 2, addcontentsline: 3, markboth: 2,
  markright: 1, crefname: 3, Crefname: 3, crefalias: 2, listoffigures: 0, listoftables: 0,
  colorlet: 2, providecolor: 3, sethlcolor: 1,
};
const COLOR_DEF = new Set(['definecolor', 'providecolor', 'colorlet']);
// What soul, ulem and xcolor mark an argument with. A macro of the document's with the same
// name wins: \st is as often "s.t." as it is soul's strike-through.
const MARKUP = { hl: 'plain', colorbox: 'plain', st: 'strike', sout: 'strike' };
const HL_DEFAULT = '#ffff00';   // soul's \hl is yellow until \sethlcolor says otherwise
const SYMBOLS = {
  ldots: '…', dots: '…', textellipsis: '…', LaTeX: 'LaTeX', TeX: 'TeX', textbackslash: '\\',
  S: '§', P: '¶', copyright: '©', pounds: '£', textendash: '–', textemdash: '—',
  quad: '\u2003', qquad: '\u2003\u2003', textasciitilde: '~', slash: '/', ss: 'ß', o: 'ø',
  O: 'Ø', aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', l: 'ł', L: 'Ł', i: 'ı',
  j: 'ȷ', textbar: '|', textless: '<', textgreater: '>', textquotedblleft: '“',
  textquotedblright: '”', textdollar: '$', textregistered: '®', texttrademark: '™',
  textdegree: '°', euro: '€', texteuro: '€', dag: '†', ddag: '‡',
};
const ACCENT_SYM = { '"': '\u0308', "'": '\u0301', '`': '\u0300', '^': '\u0302', '~': '\u0303', '=': '\u0304', '.': '\u0307' };
const ACCENT_LET = { c: '\u0327', v: '\u030C', H: '\u030B', k: '\u0328', u: '\u0306', r: '\u030A', b: '\u0331', d: '\u0323' };

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isLetter = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 64;

/** Index of the brace matching text[i] === '{', or -1. */
export function matchBrace(text, i, limit = text.length) {
  let depth = 0;
  for (let j = i; j < limit; j++) {
    const c = text.charCodeAt(j);
    if (c === 92) { j++; continue; }                    // backslash escapes next char
    if (c === 37) {                                     // % comment
      const nl = text.indexOf('\n', j);
      if (nl < 0 || nl >= limit) return -1;
      j = nl; continue;
    }
    if (c === 123) depth++;
    else if (c === 125) { depth--; if (depth === 0) return j; }
  }
  return -1;
}

/** Index of the ']' matching text[i] === '[' at brace depth 0, or -1. */
export function matchBracket(text, i, limit = text.length) {
  let depth = 0;
  for (let j = i + 1; j < limit; j++) {
    const c = text.charCodeAt(j);
    if (c === 92) { j++; continue; }
    if (c === 123) depth++;
    else if (c === 125) { if (depth === 0) return -1; depth--; }
    else if (c === 93 && depth === 0) return j;
    else if (c === 10 && text.charCodeAt(j + 1) === 10) return -1;
  }
  return -1;
}

function skipSpace(text, i) {
  // spaces/tabs and at most one newline
  let nl = 0;
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9) continue;
    if (c === 10 && nl === 0) { nl++; continue; }
    break;
  }
  return i;
}
const skipBlanks = (text, i) => { while (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9) i++; return i; };

function readReq(text, i) {
  const j = skipSpace(text, i);
  if (text.charCodeAt(j) !== 123) return null;
  const k = matchBrace(text, j);
  return k < 0 ? null : { from: j, to: k + 1 };
}
function readOpt(text, i) {
  const j = skipBlanks(text, i);
  if (text.charCodeAt(j) !== 91) return null;
  const k = matchBracket(text, j);
  return k < 0 ? null : { from: j, to: k + 1 };
}

function stripComments(s) {
  return s.replace(/(^|[^\\])%.*$/gm, '$1');
}

/** \definecolor{name}{model}{values} or \colorlet{name}{color}, its arguments starting at text[i]: kept in meta.colors. */
function readColorDef(text, name, i, meta) {
  const arg = (r) => text.slice(r.from + 1, r.to - 1);
  const o = readOpt(text, i);
  const a = readReq(text, o ? o.to : i);
  if (!a) return;
  let c = null;
  if (name === 'colorlet') {
    const o2 = readOpt(text, a.to), b = readReq(text, o2 ? o2.to : a.to);
    c = b && findColor(arg(b), null, meta);
  } else {
    const b = readReq(text, a.to), v = b && readReq(text, b.to);
    c = v && findColor(arg(v), arg(b), meta);
  }
  if (c) meta.colors[arg(a).trim()] = c;
}

/** Where the group or environment that text[i] is in ends: what a \color{…} written at i reaches. */
function scopeEnd(text, i) {
  let depth = 0, env = 0;
  for (let j = i; j < text.length; j++) {
    const c = text.charCodeAt(j);
    if (c === 92) {
      if (text.startsWith('begin{', j + 1)) env++;
      else if (text.startsWith('end{', j + 1) && env-- === 0) return j;
      j++;
    } else if (c === 37) {
      const nl = text.indexOf('\n', j);
      if (nl < 0) break;
      j = nl;
    } else if (c === 123) depth++;
    else if (c === 125 && depth-- === 0) return j;
  }
  return text.length;
}

/**
 * What a macro that wraps its argument does to it: the color, background and strike-through in
 * force at #1 in \newcommand{\edit}[1]{\textcolor{blue}{#1}}, {\color{blue}\bfseries #1} or
 * \textcolor{red}{\sout{#1}}.
 */
function wrapStyle(body, meta) {
  const at = body.indexOf('#1'), st = {};
  for (const t of scan(body, { fragment: true, meta }).tokens) {
    if (t.type === 'style' && t.inner.from <= at && at < t.inner.to) {
      if (t.color) st.color = t.color;
      if (t.bg) st.bg = t.bg;
      if (t.kind === 'strike' || t.strike) st.strike = true;
    } else if (t.type === 'colorsw' && t.color && t.to <= at && at < t.scopeTo) st.color = t.color;
  }
  return st;
}

function composeAccent(base, mark) {
  if (base === '\\i' || base === 'ı') base = 'i';
  return (base + mark).normalize('NFC');
}

/** Read the preamble (and any root-file preamble) for macros, theorem names, title block. */
export function parsePreamble(src) {
  const text = stripComments(src);
  const meta = {
    defs: [], theorems: {}, title: null, author: null, date: undefined,
    numberWithin: {}, graphicsPaths: [], bibFiles: [], crefNames: {}, the: {}, counters: {},
    textMacros: {}, wrapMacros: {}, colors: {}, svgnames: /\bsvgnames\b/.test(text), hlColor: null,
  };
  const wraps = {};            // wrapping macros and their bodies
  let style = 'plain';
  const re = /\\([a-zA-Z]+)(\*?)/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1], star = m[2], at = m.index, after = re.lastIndex;
    if (name === 'newcommand' || name === 'renewcommand' || name === 'providecommand') {
      let i = skipSpace(text, after), macro;
      if (text[i] === '{') { const k = matchBrace(text, i); if (k < 0) continue; macro = text.slice(i + 1, k).trim(); i = k + 1; }
      else { const mm = /^\\[a-zA-Z@]+/.exec(text.slice(i)); if (!mm) continue; macro = mm[0]; i += mm[0].length; }
      let nargs = 0, dflt = null;
      let o = readOpt(text, i);
      if (o) { nargs = parseInt(text.slice(o.from + 1, o.to - 1), 10) || 0; i = o.to; o = readOpt(text, i); if (o) { dflt = text.slice(o.from + 1, o.to - 1); i = o.to; } }
      const b = readReq(text, i);
      if (!b) continue;
      let body = text.slice(b.from + 1, b.to - 1);
      if (/^\\the[a-zA-Z]+$/.test(macro) && nargs === 0) meta.the[macro.slice(4)] = body; // \renewcommand{\thetable}{A\arabic{table}}
      // macros of the document's own that show up in running text: \newcommand{\nObs}{11,672}, \newcommand{\edit}[1]{\textcolor{blue}{#1}}
      if (/^\\[a-zA-Z]+$/.test(macro) && !has(RAW_ARGS, macro.slice(1))) {
        if (nargs === 0 && dflt === null) meta.textMacros[macro.slice(1)] = body;
        else if (nargs === 1 && dflt === null && body.includes('#1')) { meta.wrapMacros[macro.slice(1)] = {}; wraps[macro.slice(1)] = body; }
      }
      if (dflt !== null) {
        // KaTeX has no optional arguments: bake the default in.
        body = body.replace(/#(\d)/g, (_, d) => (d === '1' ? dflt : '#' + (d - 1)));
        nargs -= 1;
      }
      meta.defs.push({ name: macro, tex: `{${macro}}${nargs > 0 ? `[${nargs}]` : ''}{${body}}` });
      re.lastIndex = b.to;
    } else if (name === 'def') {
      const mm = /^\s*(\\[a-zA-Z@]+)\s*((?:#\d)*)\s*\{/.exec(text.slice(after));
      if (!mm) continue;
      const bi = after + mm[0].length - 1, k = matchBrace(text, bi);
      if (k < 0) continue;
      const nargs = mm[2].length / 2;
      meta.defs.push({ name: mm[1], tex: `{${mm[1]}}${nargs ? `[${nargs}]` : ''}{${text.slice(bi + 1, k)}}` });
      re.lastIndex = k + 1;
    } else if (name === 'DeclareMathOperator') {
      const a = readReq(text, after), b = a && readReq(text, a.to);
      if (!b) continue;
      const macro = text.slice(a.from + 1, a.to - 1).trim();
      meta.defs.push({ name: macro, tex: `{${macro}}{\\operatorname${star}{${text.slice(b.from + 1, b.to - 1)}}}` });
      re.lastIndex = b.to;
    } else if (name === 'DeclarePairedDelimiter') {
      const a = readReq(text, after), l = a && readReq(text, a.to), r = l && readReq(text, l.to);
      if (!r) continue;
      const macro = text.slice(a.from + 1, a.to - 1).trim();
      meta.defs.push({ name: macro, tex: `{${macro}}[1]{\\left${text.slice(l.from + 1, l.to - 1)} #1 \\right${text.slice(r.from + 1, r.to - 1)}}` });
      re.lastIndex = r.to;
    } else if (name === 'setcounter') {
      const a = readReq(text, after), b = a && readReq(text, a.to);
      const v = b ? parseInt(text.slice(b.from + 1, b.to - 1), 10) : NaN;
      if (!Number.isNaN(v)) meta.counters[text.slice(a.from + 1, a.to - 1).trim()] = v;
    } else if (name === 'newenvironment') {
      // \newenvironment{named}[1]{\renewcommand\theinner{#1}\inner}{\endinner}: a theorem numbered by hand
      const a = readReq(text, after), o = a && readOpt(text, a.to), b = o && readReq(text, o.to);
      if (!b) continue;
      const code = text.slice(b.from + 1, b.to - 1);
      const mm = /\\renewcommand\*?\s*\{?\s*\\the([a-zA-Z]+)\s*\}?\s*\{\s*#1\s*\}/.exec(code);
      if (mm && meta.theorems[mm[1]] && code.includes('\\' + mm[1], mm.index + mm[0].length)) {
        meta.theorems[text.slice(a.from + 1, a.to - 1).trim()] = Object.assign({}, meta.theorems[mm[1]], { manual: true, counter: null, within: null });
      }
      re.lastIndex = b.to;
    } else if (name === 'theoremstyle') {
      const a = readReq(text, after);
      if (a) style = text.slice(a.from + 1, a.to - 1).trim();
    } else if (name === 'newtheorem') {
      const a = readReq(text, after);
      if (!a) continue;
      const shared = readOpt(text, a.to);
      const t = readReq(text, shared ? shared.to : a.to);
      if (!t) continue;
      const within = readOpt(text, t.to);
      meta.theorems[text.slice(a.from + 1, a.to - 1).trim()] = {
        title: text.slice(t.from + 1, t.to - 1),
        counter: shared ? text.slice(shared.from + 1, shared.to - 1).trim() : null,
        within: within ? text.slice(within.from + 1, within.to - 1).trim() : null,
        style, numbered: !star,
      };
      re.lastIndex = t.to;
    } else if (name === 'title' || name === 'author' || name === 'date') {
      const o = readOpt(text, after);
      const a = readReq(text, o ? o.to : after);
      if (a) { meta[name] = text.slice(a.from + 1, a.to - 1); re.lastIndex = a.to; }
    } else if (name === 'numberwithin') {
      const a = readReq(text, after), b = a && readReq(text, a.to);
      if (b) meta.numberWithin[text.slice(a.from + 1, a.to - 1).trim()] = text.slice(b.from + 1, b.to - 1).trim();
    } else if (name === 'crefname' || name === 'Crefname') {
      const a = readReq(text, after), b = a && readReq(text, a.to);
      if (b) {
        const type = text.slice(a.from + 1, a.to - 1).trim();
        (meta.crefNames[type] || (meta.crefNames[type] = {}))[name === 'Crefname' ? 'C' : 'c'] = text.slice(b.from + 1, b.to - 1).trim();
      }
    } else if (name === 'graphicspath') {
      const a = readReq(text, after);
      if (a) for (const g of text.slice(a.from + 1, a.to - 1).matchAll(/\{([^{}]*)\}/g)) meta.graphicsPaths.push(g[1]);
    } else if (name === 'bibliography' || name === 'addbibresource') {
      const a = readReq(text, after);
      if (a) for (const f of text.slice(a.from + 1, a.to - 1).split(',')) if (f.trim()) meta.bibFiles.push(f.trim());
    } else if (COLOR_DEF.has(name)) {
      readColorDef(text, name, after, meta);
    } else if (name === 'sethlcolor') {
      const a = readReq(text, after);
      if (a) meta.hlColor = text.slice(a.from + 1, a.to - 1);
    }
    void at;
  }
  // only now is every color known: a macro may use one that is defined after it
  if (meta.hlColor) meta.hlColor = cssColor(meta.hlColor, null, meta);
  for (const k in wraps) meta.wrapMacros[k] = wrapStyle(wraps[k], meta);
  return meta;
}

/**
 * Where \title{…}, \author{…} and \date{…} are written in text[0, limit): { title: { from, to, arg: { from, to } }, … }.
 * The last one of each counts, as in LaTeX.
 */
function findTitleSource(text, limit) {
  const out = {};
  const re = /\\(title|author|date)(?![a-zA-Z@])/g;
  let m;
  while ((m = re.exec(text)) && m.index < limit) {
    const ls = text.lastIndexOf('\n', m.index) + 1;
    if (/(^|[^\\])%/.test(text.slice(ls, m.index))) continue;        // commented out
    const o = readOpt(text, re.lastIndex);
    const a = readReq(text, o ? o.to : re.lastIndex);
    if (!a || a.to > limit) continue;
    out[m[1]] = { from: m.index, to: a.to, arg: { from: a.from + 1, to: a.to - 1 } };
    re.lastIndex = a.to;
  }
  return out;
}

function findDocBegin(text) {
  const re = /\\begin\{document\}/g;
  let m;
  while ((m = re.exec(text))) {
    const ls = text.lastIndexOf('\n', m.index) + 1;
    const pct = text.indexOf('%', ls);
    if (pct >= 0 && pct < m.index && text[pct - 1] !== '\\') continue;
    return m.index;
  }
  return -1;
}

function findEnvEnd(text, name, from) {
  // Matching \end{name}, allowing nested environments of the same name.
  const open = '\\begin{' + name + '}', close = '\\end{' + name + '}';
  let depth = 1, i = from;
  while (true) {
    const e = text.indexOf(close, i);
    if (e < 0) return -1;
    let b = text.indexOf(open, i);
    while (b >= 0 && b < e) { depth++; b = text.indexOf(open, b + open.length); }
    depth--;
    if (depth === 0) return e;
    i = e + close.length;
  }
}

/**
 * Scan a document (or, with fragment=true, a snippet of body text).
 * Returns { tokens, envs, bodyFrom, meta, titleSrc }.
 */
export function scan(text, opts = {}) {
  const n = text.length;
  const tokens = [];
  const envs = [];
  const stack = [];
  let bodyFrom = 0;
  let meta;
  let titleSrc = {};          // where \title, \author and \date are written in this text, for the title block
  if (opts.fragment) {
    meta = opts.meta || parsePreamble('');
  } else {
    const d = findDocBegin(text);
    meta = parsePreamble((opts.rootPreamble ? opts.rootPreamble + '\n' : '') + (d >= 0 ? text.slice(0, d) : text));
    if (d >= 0) {
      const nl = text.indexOf('\n', d);
      bodyFrom = nl < 0 ? n : nl + 1;
      titleSrc = findTitleSource(text, d);
    }
  }
  const theoremNames = Object.assign({}, DEFAULT_THEOREMS);
  for (const k in meta.theorems) theoremNames[k] = meta.theorems[k].title;
  const push = (t) => { tokens.push(t); return t; };
  let i = bodyFrom;
  let tail = -1;
  let hl = meta.hlColor || HL_DEFAULT;      // what \hl paints with
  const groups = [];                         // \color{…} right after a brace, which may be a bare group

  while (i < n) {
    const c = text.charCodeAt(i);

    if (c === 37) { // %
      let e = text.indexOf('\n', i);
      if (e < 0) e = n;
      const ls = text.lastIndexOf('\n', i - 1) + 1;
      const full = text.slice(ls, i).trim() === '';
      const body = text.slice(i + 1, e);
      push({ type: 'comment', from: i, to: e, full, sep: full && /^[\s=\-%*~#_+.]*$/.test(body) });
      i = e;
      continue;
    }

    if (c === 92) { // backslash
      const c1 = text.charCodeAt(i + 1);
      if (isLetter(c1)) {
        let j = i + 1;
        while (j < n && isLetter(text.charCodeAt(j))) j++;
        const name = text.slice(i + 1, j);
        let star = false;
        if (text.charCodeAt(j) === 42) { star = true; j++; }
        i = command(name, star, i, j);
        continue;
      }
      if (c1 === 40 || c1 === 91) { // \( or \[
        const close = c1 === 40 ? '\\)' : '\\]';
        const e = text.indexOf(close, i + 2);
        if (e >= 0) {
          push({ type: 'math', display: c1 === 91, from: i, to: e + 2, body: { from: i + 2, to: e } });
          i = e + 2;
          continue;
        }
        push({ type: 'cs', name: text[i + 1], from: i, to: i + 2 });
        i += 2;
        continue;
      }
      const ch = text[i + 1];
      if (ch === undefined) { i++; continue; }
      if ('%&$#_{}'.includes(ch)) { push({ type: 'sym', from: i, to: i + 2, text: ch }); i += 2; continue; }
      if (ch === ',' || ch === ';' || ch === ':' || ch === ' ' || ch === '!' || ch === '/') {
        push({ type: 'sym', from: i, to: i + 2, text: ch === '!' || ch === '/' ? '' : ch === ',' ? '\u2009' : ' ' });
        i += 2; continue;
      }
      if (ch === '-') { push({ type: 'sym', from: i, to: i + 2, text: '' }); i += 2; continue; }
      if (ACCENT_SYM[ch]) {
        const a = accentArg(i + 2);
        if (a) { push({ type: 'sym', from: i, to: a.to, text: composeAccent(a.base, ACCENT_SYM[ch]) }); i = a.to; continue; }
      }
      if (ch === '\\') {
        let e = i + 2;
        if (text[e] === '*') e++;
        const o = readOpt(text, e);
        if (o) e = o.to;
        push({ type: 'cs', name: '\\', from: i, to: e, br: true });
        i = e; continue;
      }
      i += 2;
      continue;
    }

    if (c === 36) { // $
      const dbl = text.charCodeAt(i + 1) === 36;
      const e = findDollar(i + (dbl ? 2 : 1), dbl);
      if (e >= 0) {
        const len = dbl ? 2 : 1;
        if (e > i + len) {
          push({ type: 'math', display: dbl, from: i, to: e + len, body: { from: i + len, to: e } });
          i = e + len;
          continue;
        }
      }
      i += dbl ? 2 : 1;
      continue;
    }

    if (c === 126) { push({ type: 'sym', from: i, to: i + 1, text: '\u00A0' }); i++; continue; }
    if (c === 45 && text.charCodeAt(i + 1) === 45) {
      if (text.charCodeAt(i + 2) === 45) {
        if (text.charCodeAt(i + 3) !== 45) { push({ type: 'sym', from: i, to: i + 3, text: '—' }); i += 3; continue; }
        while (text.charCodeAt(i) === 45) i++;
        continue;
      }
      push({ type: 'sym', from: i, to: i + 2, text: '–' }); i += 2; continue;
    }
    if (c === 96) {
      if (text.charCodeAt(i + 1) === 96) { push({ type: 'sym', from: i, to: i + 2, text: '“' }); i += 2; continue; }
      push({ type: 'sym', from: i, to: i + 1, text: '‘' }); i++; continue;
    }
    if (c === 123) { // {,} and {} groups in running text
      if (text.charCodeAt(i + 1) === 44 && text.charCodeAt(i + 2) === 125) { push({ type: 'sym', from: i, to: i + 3, text: ',' }); i += 3; continue; }
      if (text.charCodeAt(i + 1) === 125) { push({ type: 'sym', from: i, to: i + 2, text: '' }); i += 2; continue; }
    }
    if (c === 39 && text.charCodeAt(i + 1) === 39) { push({ type: 'sym', from: i, to: i + 2, text: '”' }); i += 2; continue; }
    i++;
  }

  while (stack.length) stack.pop(); // unclosed environments are simply left as source
  envs.sort((a, b) => a.from - b.from);
  if (groups.length) {
    // {\color{red} …}: the braces go with the command, unless they are some command's argument
    const args = new Set();
    for (const t of tokens) if (t.inner) args.add(t.inner.from - 1);
    for (const t of groups) {
      if (args.has(t.brace)) continue;
      t.open = { from: t.brace, to: t.brace + 1 };
      t.close = { from: t.scopeTo, to: t.scopeTo + 1 };
    }
  }
  // what the colors of this document are, for whatever caches things drawn with them
  if (!opts.fragment) meta.colorSig = JSON.stringify([meta.colors, meta.wrapMacros, meta.hlColor, meta.svgnames]);
  return { tokens, envs, bodyFrom, tail, meta, theoremNames, titleSrc };

  // ---- helpers (closures over text/tokens) ----

  function accentArg(j) {
    if (text[j] === '{') {
      const k = matchBrace(text, j);
      if (k < 0) return null;
      const inner = text.slice(j + 1, k).trim();
      if (inner === '\\i') return { base: 'i', to: k + 1 };
      if (inner.length !== 1) return null;
      return { base: inner, to: k + 1 };
    }
    if (text.startsWith('\\i', j) && !isLetter(text.charCodeAt(j + 2))) return { base: 'i', to: j + 2 };
    if (/[A-Za-z]/.test(text[j] || '')) return { base: text[j], to: j + 1 };
    return null;
  }

  function findDollar(j, dbl) {
    for (; j < n; j++) {
      const ch = text.charCodeAt(j);
      if (ch === 92) { j++; continue; }
      if (ch === 10 && /^[ \t]*\n/.test(text.slice(j + 1, j + 80))) return -1; // paragraph break
      if (ch === 37) { const nl = text.indexOf('\n', j); if (nl < 0) return -1; j = nl - 1; continue; }
      if (ch === 36) {
        if (!dbl) return j;
        if (text.charCodeAt(j + 1) === 36) return j;
      }
    }
    return -1;
  }

  function argCommand(type, name, from, j, extra) {
    // \name[opt]{inner}: keep scanning inside the argument so nested math etc. is found.
    const o = readOpt(text, j);
    const a = readReq(text, o ? o.to : j);
    if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
    push(Object.assign({
      type, name, from, to: a.to,
      open: { from, to: a.from + 1 }, close: { from: a.to - 1, to: a.to },
      inner: { from: a.from + 1, to: a.to - 1 },
      opt: o ? text.slice(o.from + 1, o.to - 1) : null,
    }, extra));
    return a.from + 1;
  }

  function command(name, star, from, j) {
    if (name === 'begin' || name === 'end') {
      const a = readReq(text, j);
      if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
      const env = text.slice(a.from + 1, a.to - 1).trim();
      if (name === 'end') {
        const tok = push({ type: 'end', env, from, to: a.to });
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].env === env) {
            const b = stack[s];
            stack.length = s;
            const rec = { name: env, from: b.from, headTo: b.to, endFrom: from, to: a.to, depth: s, begin: b, end: tok };
            b.rec = rec; tok.rec = rec;
            envs.push(rec);
            break;
          }
        }
        if (env === 'document') {
          tok.type = 'enddoc';
          tail = a.to;
          return n;
        }
        return a.to;
      }
      if (MATH_ENVS.has(env)) {
        const e = text.indexOf('\\end{' + env + '}', a.to);
        if (e < 0) { push({ type: 'cs', name, from, to: a.to }); return a.to; }
        const to = e + env.length + 6;
        push({ type: 'math', display: env !== 'math', env, from, to, body: { from: a.to, to: e } });
        return to;
      }
      if (VERB_ENVS.has(env)) {
        const e = text.indexOf('\\end{' + env + '}', a.to);
        if (e < 0) { push({ type: 'cs', name, from, to: a.to }); return a.to; }
        const to = e + env.length + 6;
        push({ type: 'verb', env, from, to });
        return to;
      }
      if (TABLE_ENVS.has(env)) {
        const e = findEnvEnd(text, env, a.to);
        if (e < 0) { push({ type: 'cs', name, from, to: a.to }); return a.to; }
        const to = e + env.length + 6;
        push({ type: 'tabular', env, from, to, body: { from: a.to, to: e } });
        return to;
      }
      const isThm = has(theoremNames, env) || env === 'proof';
      let nameTo = a.to, manual = null;
      if (isThm && meta.theorems[env] && meta.theorems[env].manual) {   // \begin{namedassumption}{MP-1}
        const r = text.charCodeAt(a.to) === 123 ? readReq(text, a.to) : null;
        if (r) { manual = text.slice(r.from + 1, r.to - 1); nameTo = r.to; }
      }
      const o = readOpt(text, nameTo);
      let to = o ? o.to : nameTo;
      let arg = null;
      for (let q = 0; q < (ENV_ARGS[env] || 0); q++) {
        const r = text.charCodeAt(skipBlanks(text, to)) === 123 ? readReq(text, to) : null;
        if (!r) break;
        if (!arg) arg = text.slice(r.from + 1, r.to - 1);
        to = r.to;
        const o2 = readOpt(text, to);
        if (o2) to = o2.to;
      }
      const tok = push({
        type: 'begin', env, from, to, nameTo,
        opt: o ? { from: o.from, to: o.to } : null, thm: isThm, arg, manual,
      });
      stack.push(tok);
      return isThm ? nameTo : to;
    }

    if (has(SECTION, name)) {
      return argCommand('section', name, from, j, { level: SECTION[name], star });
    }
    if (name === 'captionof') {   // \captionof{table}{...}: a caption outside a float
      const ty = readReq(text, j), o = ty && readOpt(text, ty.to), a = ty && readReq(text, o ? o.to : ty.to);
      if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
      push({
        type: 'style', name, kind: 'caption', star, floatType: text.slice(ty.from + 1, ty.to - 1).trim(), from, to: a.to,
        open: { from, to: a.from + 1 }, close: { from: a.to - 1, to: a.to }, inner: { from: a.from + 1, to: a.to - 1 },
      });
      return a.from + 1;
    }
    if (has(STYLE, name)) {
      const kind = STYLE[name];
      if (kind === 'href' || kind === 'color') {
        const o = kind === 'color' ? readOpt(text, j) : null;          // \textcolor[rgb]{1,0,0}{…}
        const u = readReq(text, o ? o.to : j), a = u && readReq(text, u.to);
        if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
        const arg = text.slice(u.from + 1, u.to - 1);
        push({
          type: 'style', name, kind, from, to: a.to, url: arg,
          color: kind === 'color' ? cssColor(arg, o && text.slice(o.from + 1, o.to - 1), meta) : null,
          open: { from, to: a.from + 1 }, close: { from: a.to - 1, to: a.to }, inner: { from: a.from + 1, to: a.to - 1 },
        });
        return a.from + 1;
      }
      return argCommand('style', name, from, j, { kind, star });
    }
    if (REF.has(name)) {
      const a = readReq(text, j);
      if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
      push({ type: 'ref', name, from, to: a.to, keys: text.slice(a.from + 1, a.to - 1).split(',').map((s) => s.trim()) });
      return a.to;
    }
    if (CITE_RE.test(name)) {
      let k = j;
      const o1 = readOpt(text, k); if (o1) k = o1.to;
      const o2 = readOpt(text, k); if (o2) k = o2.to;
      const a = readReq(text, k);
      if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
      const pre = o2 ? text.slice(o1.from + 1, o1.to - 1) : '';
      const post = o2 ? text.slice(o2.from + 1, o2.to - 1) : o1 ? text.slice(o1.from + 1, o1.to - 1) : '';
      push({
        type: 'cite', name, star, from, to: a.to, pre, post,
        keys: text.slice(a.from + 1, a.to - 1).split(',').map((s) => s.trim()).filter(Boolean),
        keysFrom: a.from + 1,
      });
      return a.to;
    }
    if (name === 'label') {
      const a = readReq(text, j);
      if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
      push({ type: 'label', from, to: a.to, key: text.slice(a.from + 1, a.to - 1).trim() });
      return a.to;
    }
    if (name === 'item') {
      const o = readOpt(text, j);
      push({ type: 'item', from, to: o ? o.to : j, label: o ? text.slice(o.from + 1, o.to - 1) : null });
      return o ? o.to : j;
    }
    if (name === 'includegraphics') {
      const o = readOpt(text, j);
      const a = readReq(text, o ? o.to : j);
      if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
      push({ type: 'graphics', from, to: a.to, path: text.slice(a.from + 1, a.to - 1).trim(), opt: o ? text.slice(o.from + 1, o.to - 1) : '' });
      return a.to;
    }
    if (name === 'bibitem') {
      const o = readOpt(text, j);
      const a = readReq(text, o ? o.to : j);
      if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
      push({ type: 'bibitem', from, to: a.to, key: text.slice(a.from + 1, a.to - 1).trim(), label: o ? text.slice(o.from + 1, o.to - 1) : null });
      return a.to;
    }
    if (name === 'input') {
      const a = readReq(text, j);
      if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
      push({ type: 'input', from, to: a.to, path: text.slice(a.from + 1, a.to - 1).trim() });
      return a.to;
    }
    if (name === 'url') {
      const a = readReq(text, j);
      if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
      push({ type: 'url', from, to: a.to, url: text.slice(a.from + 1, a.to - 1) });
      return a.to;
    }
    if (name === 'verb') {
      const d = text[j];
      const e = d ? text.indexOf(d, j + 1) : -1;
      const nl = text.indexOf('\n', j);
      if (e < 0 || (nl >= 0 && e > nl)) { push({ type: 'cs', name, from, to: j }); return j; }
      push({ type: 'verb', inline: true, from, to: e + 1 });
      return e + 1;
    }
    if (name === 'maketitle') { push({ type: 'maketitle', from, to: j }); return j; }
    if (name === 'today') { push({ type: 'sym', from, to: swallowEmpty(j), text: today() }); return swallowEmpty(j); }
    if (has(SYMBOLS, name) && !star) {
      const to = swallowEmpty(j);
      push({ type: 'sym', from, to, text: SYMBOLS[name] });
      return to;
    }
    if (has(ACCENT_LET, name) && !star) {
      const a = accentArg(text[j] === ' ' ? j + 1 : j);
      if (a && (text[j] === '{' || text[j] === ' ')) {
        push({ type: 'sym', from, to: a.to, text: composeAccent(a.base, ACCENT_LET[name]) });
        return a.to;
      }
    }
    if (name === 'texorpdfstring') {   // \texorpdfstring{shown}{bookmark text}
      const a = readReq(text, j), b = a && readReq(text, a.to);
      if (!b) { push({ type: 'cs', name, from, to: j }); return j; }
      push({
        type: 'style', name, kind: 'plain', from, to: b.to,
        open: { from, to: a.from + 1 }, close: { from: a.to - 1, to: b.to }, inner: { from: a.from + 1, to: a.to - 1 },
      });
      return a.from + 1;
    }
    if (has(WRAP, name) || (has(meta.wrapMacros, name) && !has(STYLE, name) && !has(SECTION, name))) {
      let k = j, ok = true, o;
      for (let q = 0; q < (WRAP[name] || 0) && ok; q++) {
        while ((o = readOpt(text, k))) k = o.to;
        const r = text.charCodeAt(skipBlanks(text, k)) === 123 ? readReq(text, k) : null;
        if (r) k = r.to; else ok = false;
      }
      while (ok && (o = readOpt(text, k))) k = o.to;
      const a = ok && text.charCodeAt(skipSpace(text, k)) === 123 ? readReq(text, k) : null;
      if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
      push(Object.assign({
        type: 'style', name, kind: name === 'parbox' || name === 'floatfoot' ? 'notes' : 'plain', from, to: a.to,
        open: { from, to: a.from + 1 }, close: { from: a.to - 1, to: a.to }, inner: { from: a.from + 1, to: a.to - 1 },
      }, has(WRAP, name) ? null : meta.wrapMacros[name]));     // a macro of the document's brings its color along
      return a.from + 1;
    }
    if (has(MARKUP, name) && !meta.defs.some((d) => d.name === '\\' + name)) {
      // \hl{text} and \colorbox[model]{color}{text} put a background behind it, \st and \sout a line through it
      let bg = name === 'hl' ? hl : null, k = j;
      if (name === 'colorbox') {
        const o = readOpt(text, j), c = readReq(text, o ? o.to : j);
        if (!c) { push({ type: 'cs', name, from, to: j }); return j; }
        bg = cssColor(text.slice(c.from + 1, c.to - 1), o && text.slice(o.from + 1, o.to - 1), meta);
        k = c.to;
      }
      return argCommand('style', name, from, k, { kind: MARKUP[name], bg });
    }
    if (name === 'color') {   // \color[model]{color}: colors what follows, to the end of the group or environment it is in
      const o = readOpt(text, j), a = readReq(text, o ? o.to : j);
      if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
      const tok = push({
        type: 'colorsw', from, to: a.to, scopeTo: scopeEnd(text, a.to),
        color: cssColor(text.slice(a.from + 1, a.to - 1), o && text.slice(o.from + 1, o.to - 1), meta),
      });
      let b = from - 1;
      while (b >= 0 && (text.charCodeAt(b) === 32 || text.charCodeAt(b) === 9)) b--;
      if (text.charCodeAt(b) === 123 && text.charCodeAt(b - 1) !== 92 && text.charCodeAt(tok.scopeTo) === 125) { tok.brace = b; groups.push(tok); }
      return a.to;
    }
    if (has(RAW_ARGS, name)) {
      let to = j;
      // \newcommand\foo{...} form
      const mm = /^\s*\\[a-zA-Z@]+/.exec(text.slice(to, to + 60));
      let need = RAW_ARGS[name];
      if (mm && (name === 'newcommand' || name === 'renewcommand' || name === 'providecommand')) { to += mm[0].length; need--; }
      let got = 0;
      for (;;) {
        const o = readOpt(text, to);
        if (o) { to = o.to; continue; }
        if (got >= need) break;
        const a = text.charCodeAt(skipBlanks(text, to)) === 123 ? readReq(text, to) : null;
        if (!a) break;
        to = a.to; got++;
      }
      const tok = push({ type: 'raw', name, from, to });
      if (COLOR_DEF.has(name)) {
        if (!opts.fragment) readColorDef(text, name, j, meta);      // a color defined in the body counts from here on
      } else if (name === 'sethlcolor') {
        const a = readReq(text, j);
        hl = (a && cssColor(text.slice(a.from + 1, a.to - 1), null, meta)) || hl;
      }
      if (name === 'renewcommand' || name === 'setcounter' || name === 'addtocounter' || name === 'numberwithin' || name === 'counterwithin') {
        // \renewcommand{\thetable}{A\arabic{table}} and \setcounter{table}{0} steer the numbering.
        const m = /^\\[a-zA-Z]+\*?\s*\{?\s*(\\?[a-zA-Z@]+)\s*\}?\s*(?:\[[^\]]*\]\s*)*\{/.exec(text.slice(from, to));
        if (m && text[to - 1] === '}' && from + m[0].length <= to - 1) { tok.target = m[1]; tok.value = text.slice(from + m[0].length, to - 1); }
      } else if (!opts.fragment && (name === 'title' || name === 'author' || name === 'date')) {
        // \title{...} after \begin{document}: still what \maketitle prints.
        const a = /\{/.exec(text.slice(j, to));
        if (a && text[to - 1] === '}') {
          meta[name] = text.slice(j + a.index + 1, to - 1); tok.titlemeta = true;
          titleSrc[name] = { from, to, arg: { from: j + a.index + 1, to: to - 1 } };
        }
      }
      return to;
    }
    push({ type: 'cs', name, from, to: j });
    return j;
  }

  function swallowEmpty(j) {
    if (text.charCodeAt(j) === 123 && text.charCodeAt(j + 1) === 125) return j + 2;
    return j;
  }
}

// ------------------------------------------------------------------ line breaks inside a paragraph

const BREAK_CS = new Set(['par', 'newline', 'linebreak', 'break']);

/**
 * The line breaks of running text. TeX reads a single line break inside a paragraph as a space,
 * so a paragraph is the same paragraph however its source is wrapped; these are the breaks the
 * visual view draws as a space, to let every paragraph fill its lines the same way.
 *
 * A break counts when the lines on both sides print text and nothing asks for a new line there:
 * no `\\`, \par or comment before it, no \item, \paragraph, \begin or \end after it. Display
 * math, tables, verbatim, headings and lines that hold only commands keep their lines, and so
 * does everything inside an environment that `keepLines(env)` is true for.
 *
 * Returns them in document order as { at, line, after }: `at` is the offset of the line break,
 * `line` the start of the line it ends. `after` is 'label' when that line holds nothing but
 * \label{…}: such a line runs on only if the line before it ran into it.
 */
export function softBreaks(text, sc, keepLines) {
  const from = sc.bodyFrom, end = sc.tail >= 0 ? sc.tail : text.length;
  if (end <= from) return [];
  const starts = [from];
  for (let i = text.indexOf('\n', from); i >= 0 && i < end; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const L = starts.length;
  const lineOf = (pos) => {
    let lo = 0, hi = L - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const endOf = (k) => (k + 1 < L ? starts[k + 1] - 1 : end);
  const blank = (a, b) => { for (let i = a; i < b; i++) { const c = text.charCodeAt(i); if (c !== 32 && c !== 9) return false; } return true; };

  const keep = new Uint8Array(L);       // the line stays a line of its own
  const prints = new Uint8Array(L);     // it has a token that prints text
  const labels = new Uint8Array(L);     // it has a \label
  const noBefore = new Uint8Array(L);   // what it starts with begins a new line
  const noAfter = new Uint8Array(L);    // what it ends with ends the line
  const mask = new Uint8Array(end - from);   // characters that are command syntax, not text
  const hide = (a, b) => mask.fill(1, Math.max(a, from) - from, Math.max(from, Math.min(b, end)) - from);
  const span = (arr, a, b) => { for (let k = lineOf(a), k2 = lineOf(Math.max(a, Math.min(b, end) - 1)); k <= k2; k++) arr[k] = 1; };
  const edges = (t) => {                // a command that opens the line, or closes it
    const a = lineOf(t.from), b = lineOf(Math.min(t.to, end));
    if (blank(starts[a], t.from)) noBefore[a] = 1;
    if (blank(t.to, endOf(b))) noAfter[b] = 1;
  };

  for (const t of sc.tokens) {
    if (t.from >= end) break;
    const k = lineOf(t.from);
    switch (t.type) {
      case 'comment':
        hide(t.from, t.to);
        if (t.full) keep[k] = 1; else noAfter[k] = 1;
        break;
      case 'math':
        span(t.display ? keep : prints, t.from, t.to);
        break;
      case 'tabular':
        span(keep, t.from, t.to);
        break;
      case 'verb':
        span(t.inline ? prints : keep, t.from, t.to);
        break;
      case 'section':
        hide(t.open.from, t.open.to); hide(t.close.from, t.close.to);
        if (t.level <= 3) span(keep, t.from, t.to);
        else if (blank(starts[k], t.from)) noBefore[k] = 1;      // \paragraph{…} starts a paragraph
        break;
      case 'style':
        hide(t.open.from, t.open.to); hide(t.close.from, t.close.to);
        break;
      case 'ref': case 'cite': case 'url':
        span(prints, t.from, t.to);
        break;
      case 'sym':
        if (t.text === '') hide(t.from, t.to); else prints[k] = 1;
        break;
      case 'label':
        hide(t.from, t.to); labels[k] = 1;
        break;
      case 'item':
        hide(t.from, t.to); prints[k] = 1;
        if (blank(starts[k], t.from)) noBefore[k] = 1;
        break;
      case 'bibitem':
        hide(t.from, t.to); noBefore[k] = 1;
        break;
      case 'begin': case 'end':
        hide(t.from, t.to); edges(t);
        break;
      case 'enddoc':
        hide(t.from, t.to); keep[k] = 1;
        break;
      case 'cs':
        hide(t.from, t.to);
        if ((t.br || BREAK_CS.has(t.name)) && blank(t.to, endOf(lineOf(Math.min(t.to, end))))) noAfter[lineOf(Math.min(t.to, end))] = 1;
        break;
      case 'colorsw':
        hide(t.from, t.to);
        break;
      default:          // input, graphics, maketitle, raw: commands with their arguments
        hide(t.from, t.to);
    }
  }
  if (keepLines) for (const e of sc.envs) if (keepLines(e)) span(keep, e.from, e.to);

  // 0: nothing to run on, 1: text, 2: only labels
  const kind = new Uint8Array(L);
  for (let k = 0; k < L; k++) {
    if (keep[k]) continue;
    let text1 = prints[k];
    for (let i = starts[k], e = endOf(k); !text1 && i < e; i++) {
      if (mask[i - from]) continue;
      const c = text.charCodeAt(i);
      if (c !== 32 && c !== 9 && c !== 123 && c !== 125) text1 = 1;
    }
    kind[k] = text1 ? 1 : labels[k] ? 2 : 0;
  }
  const out = [];
  for (let k = 0; k + 1 < L; k++) {
    if (!kind[k] || !kind[k + 1] || noAfter[k] || noBefore[k + 1]) continue;
    out.push({ at: starts[k + 1] - 1, line: starts[k], after: kind[k] === 2 ? 'label' : 'text' });
  }
  return out;
}

export function today() {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

const ROMAN = [['m', 1000], ['cm', 900], ['d', 500], ['cd', 400], ['c', 100], ['xc', 90], ['l', 50], ['xl', 40], ['x', 10], ['ix', 9], ['v', 5], ['iv', 4], ['i', 1]];
function roman(n) { let s = ''; for (const [r, v] of ROMAN) while (n >= v) { s += r; n -= v; } return s; }
const alpha = (n) => String.fromCharCode(96 + ((n - 1) % 26) + 1);

/** Split display-math source into rows at top-level \\ (outside braces and inner environments). */
export function splitRows(src) {
  const rows = [];
  let depth = 0, env = 0, start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '%') { const nl = src.indexOf('\n', i); if (nl < 0) break; i = nl; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '\\') {
      if (src.startsWith('\\begin{', i)) env++;
      else if (src.startsWith('\\end{', i)) env--;
      else if (src[i + 1] === '\\' && depth === 0 && env === 0) {
        rows.push(src.slice(start, i));
        start = i + 2;
      }
      i++;
    }
  }
  rows.push(src.slice(start));
  return rows;
}

const fmtCounter = (style, n) => (style === 'alph' ? alpha(n) : style === 'Alph' ? alpha(n).toUpperCase()
  : style === 'roman' ? roman(n) : style === 'Roman' ? roman(n).toUpperCase() : String(n));
const SEC_COUNTER = { chapter: 0, part: 0, section: 1, subsection: 2, subsubsection: 3 };
const SEC_NAME = ['chapter', 'section', 'subsection', 'subsubsection'];

const subScans = new Map();   // \input file text -> its scan, reused across keystrokes

/**
 * Number sections, theorems, equations, floats and list items, and resolve labels.
 * Follows \appendix, \setcounter, \numberwithin and \renewcommand{\the<counter>}{...}, and
 * walks into the files the document \input's (inputs: path -> text), so a float or section
 * kept in another file still takes its number.
 * Mutates tokens (adds .num / .tex / .labels) and returns { labels, bibitems }.
 */
export function number(text, sc, inputs = {}) {
  const { meta, theoremNames } = sc;
  const labels = new Map();
  const bibitems = new Map();
  const cited = new Set();
  const sec = [0, 0, 0, 0, 0, 0];
  const counters = { equation: 0, figure: 0, table: 0 };
  const the = Object.assign({}, meta.the);          // counter -> \renewcommand{\the<counter>} template
  const within = Object.assign({}, meta.numberWithin);
  let appendix = false, guard = 0;
  const scope = [{ cur: null, kind: null, name: null, list: null }];
  const top = () => scope[scope.length - 1];
  // theorem environments keep their counters under 'thm:<name>' (shared ones under the owner's name)
  const ckey = (c) => (has(meta.theorems, c) || has(DEFAULT_THEOREMS, c) ? 'thm:' + ((meta.theorems[c] && meta.theorems[c].counter) || c) : c);
  const raw = (c) => (has(SEC_COUNTER, c) ? sec[SEC_COUNTER[c]] : counters[ckey(c)] || 0);
  const setRaw = (c, v) => { if (has(SEC_COUNTER, c)) sec[SEC_COUNTER[c]] = v; else counters[ckey(c)] = v; };
  for (const c in meta.counters) setRaw(c, meta.counters[c]);
  const expand = (tpl) => tpl
    .replace(/\\(arabic|alph|Alph|roman|Roman)\s*\{\s*([a-zA-Z]+)\s*\}/g, (_, st, c) => fmtCounter(st, raw(c)))
    .replace(/\\the([a-zA-Z]+)/g, (_, c) => show(c))
    .replace(/\\[a-zA-Z]+\s*|[{}]/g, '').trim();
  function show(c) {
    if (the[c] != null && guard < 6) { guard++; try { return expand(the[c]); } finally { guard--; } }
    if (c === 'section') return appendix ? alpha(sec[1]).toUpperCase() : String(sec[1]);
    if (c === 'subsection') return show('section') + '.' + sec[2];
    if (c === 'subsubsection') return show('subsection') + '.' + sec[3];
    return String(raw(c));
  }
  const secPrefix = (parent) => (parent === 'section' || parent === 'subsection' || parent === 'chapter' ? show(parent) + '.' : '');
  const next = (c, parent) => { setRaw(c, raw(c) + 1); return the[c] != null ? show(c) : secPrefix(parent) + raw(c); };
  const nextEq = () => next('equation', within.equation);
  const nextFloat = (f) => next(f, within[f]);
  const floatName = (f) => (f === 'figure' ? 'Figure' : 'Table');
  const setCur = (from, cur, kind, name) => { for (let q = from; q < scope.length; q++) { scope[q].cur = cur; scope[q].kind = kind; scope[q].name = name; } };
  const startAppendix = () => { if (!appendix) { appendix = true; sec[1] = sec[2] = sec[3] = 0; } };
  // Does the float starting at token ti carry a numbered \caption of its own?
  const hasMainCaption = (tokens, ti, end) => {
    let sub = 0;
    for (let k = ti + 1; k < tokens.length && tokens[k].from < end; k++) {
      const u = tokens[k];
      if (u.type === 'begin' && SUBFLOATS.has(u.env)) sub++;
      else if (u.type === 'end' && SUBFLOATS.has(u.env)) sub--;
      else if (u.type === 'style' && u.name === 'caption' && !u.star && sub === 0) return true;
    }
    return false;
  };
  let listDepth = 0, enumDepth = 0;
  const open = [];                       // \input files being walked, to stop a file that includes itself
  const metaSig = Object.keys(meta.theorems).join() + '|' + Object.keys(meta.wrapMacros).join() + '|' + meta.colorSig;

  walk(sc.tokens, text, null);
  return { labels, bibitems, cited };

  // at: where labels found here point to; null in the document itself, the \input command otherwise
  function walk(tokens, text, at) {
    for (let ti = 0; ti < tokens.length; ti++) {
      const t = tokens[ti];
      switch (t.type) {
        case 'section': {
          if (t.level >= 4) { t.num = null; break; }
          if (!t.star) {
            sec[t.level]++;
            for (let l = t.level + 1; l < 6; l++) sec[l] = 0;
            for (const c in within) if (within[c] === t.name) setRaw(c, 0);
            for (const k in meta.theorems) if (meta.theorems[k].within === t.name) counters['thm:' + (meta.theorems[k].counter || k)] = 0;
            t.num = show(SEC_NAME[t.level]);
            // every open scope: a section inside \begin{appendices} or {spacing} is still the current one
            setCur(0, t.num, 'sec', t.level === 0 ? 'Chapter' : appendix ? 'Appendix' : 'Section');
          } else t.num = null;
          break;
        }
        case 'cs': {
          if (t.name === 'appendix') startAppendix();
          break;
        }
        case 'raw': {
          if (t.target == null) break;
          if (t.name === 'renewcommand') {
            if (t.target.startsWith('\\the')) the[t.target.slice(4)] = t.value;
          } else if (t.name === 'numberwithin' || t.name === 'counterwithin') {
            within[t.target] = t.value.trim();
          } else {
            const v = parseInt(t.value, 10);
            if (!Number.isNaN(v)) setRaw(t.target, t.name === 'addtocounter' ? raw(t.target) + v : v);
          }
          break;
        }
        case 'input': {
          const src = inputs[t.path];
          t.sub = null;
          if (src == null || open.length > 4 || open.includes(t.path)) break;
          let sub = subScans.get(src);
          if (!sub || sub.sig !== metaSig) {          // rescanned when the preamble defines new environments or macros
            if (subScans.size > 400) subScans.clear();
            subScans.set(src, sub = scan(src, { fragment: true, meta }));
            sub.sig = metaSig;
          }
          open.push(t.path);
          walk(sub.tokens, src, at == null ? t.from : at);
          open.pop();
          t.sub = sub;
          break;
        }
        case 'begin': {
          const s = { cur: top().cur, kind: top().kind, name: top().name, list: null, env: t.env };
          if (t.thm && t.env !== 'proof') {
            const def = meta.theorems[t.env];
            const numbered = def ? def.numbered : !t.env.endsWith('*');
            t.title = theoremNames[t.env];
            t.plain = !def || def.style === 'plain';
            t.num = undefined;
            if (def && def.manual) {
              if (t.manual != null) { t.num = t.manual.replace(/[{}$\\]/g, ''); s.cur = t.num; s.kind = 'thm'; s.name = t.title; }
            } else if (numbered) {
              const base = (def && def.counter) || t.env;
              const owner = def && def.counter ? meta.theorems[def.counter] : def;
              t.num = next(base, within[base] != null ? within[base] : owner && owner.within);
              s.cur = t.num; s.kind = 'thm'; s.name = t.title;
            }
          } else if (has(FLOATS, t.env)) {
            s.float = FLOATS[t.env]; s.subN = 0;
            // Number the float up front, so sub-captions and early labels see it.
            if (t.rec && hasMainCaption(tokens, ti, t.rec.to)) {
              s.num = nextFloat(s.float); s.pre = true;
              s.cur = s.num; s.kind = s.float; s.name = floatName(s.float);
            }
          } else if (SUBFLOATS.has(t.env)) {
            s.sub = true;
          } else if (t.env === 'tablenotes') {
            s.notes = true;
          } else if (LIST_ENVS.has(t.env)) {
            listDepth++;
            if (t.env === 'enumerate') enumDepth++;
            s.list = { kind: t.env, n: 0, depth: listDepth, edepth: enumDepth, parent: top().cur && top().kind === 'item' ? top().cur : '' };
          } else if (t.env === 'appendices' || t.env === 'appendix' || t.env === 'subappendices') {
            startAppendix();
          }
          scope.push(s);
          break;
        }
        case 'end': case 'enddoc': {
          for (let k = scope.length - 1; k > 0; k--) {
            if (scope[k].env === t.env) {
              for (let q = scope.length - 1; q >= k; q--) {
                const l = scope[q].list;
                if (l) { listDepth--; if (l.kind === 'enumerate') enumDepth--; }
              }
              scope.length = k;
              break;
            }
          }
          break;
        }
        case 'item': {
          let s = null;
          for (let k = scope.length - 1; k > 0; k--) if (scope[k].list || scope[k].notes) { s = scope[k]; break; }
          if (!s) { t.bullet = '•'; t.depth = 1; break; }
          if (s.notes) { t.notes = true; t.depth = 0; if (t.label !== null) t.custom = true; break; }
          const l = s.list;
          t.depth = l.depth;
          if (t.label !== null) { t.custom = true; s.cur = t.label.replace(/^[([]|[)\].]$/g, ''); s.kind = 'item'; s.name = 'item'; break; }
          if (l.kind === 'enumerate') {
            l.n++;
            const d = ((l.edepth - 1) % 4) + 1;
            const v = d === 1 ? String(l.n) : d === 2 ? alpha(l.n) : d === 3 ? roman(l.n) : alpha(l.n).toUpperCase();
            t.bullet = d === 1 ? v + '.' : d === 2 ? '(' + v + ')' : v + '.';
            s.cur = l.parent + v; s.kind = 'item'; s.name = 'item';
          } else if (l.kind === 'itemize') {
            t.bullet = ['•', '–', '∗', '·'][(l.depth - 1) % 4];
          } else t.bullet = '';
          break;
        }
        case 'style': {
          if (t.kind !== 'caption') break;
          t.num = undefined; t.sub = undefined;
          if (t.star) break;                            // \caption* carries no number
          if (t.floatType === 'figure' || t.floatType === 'table') {   // \captionof{table}{...}
            t.num = nextFloat(t.floatType);
            t.floatName = floatName(t.floatType);
            setCur(scope.length - 1, t.num, t.floatType, t.floatName);
            break;
          }
          let k = scope.length - 1;
          while (k > 0 && !scope[k].float && !scope[k].sub) k--;
          if (k === 0) break;                           // a stray caption
          const s = scope[k];
          if (s.sub || t.name === 'subcaption') {
            let p = k;
            while (p > 0 && !scope[p].float) p--;
            const parent = p > 0 ? scope[p] : null;
            const letter = alpha(parent ? ++parent.subN : 1);
            t.sub = '(' + letter + ')';
            const kind = parent ? parent.float : 'figure';
            setCur(k, (parent && parent.num ? parent.num : '') + letter, kind, floatName(kind));
            break;
          }
          if (s.pre) s.pre = false; else s.num = nextFloat(s.float);
          t.num = s.num;
          t.floatName = floatName(s.float);
          setCur(k, s.num, s.float, t.floatName);       // also the scopes nested inside (threeparttable…)
          break;
        }
        case 'label': {
          const s = top();
          labels.set(t.key, { text: s.cur, kind: s.kind, name: s.name, pos: at == null ? t.from : at });
          break;
        }
        case 'bibitem': {
          bibitems.set(t.key, t.label);
          break;
        }
        case 'cite': {
          for (const k of t.keys) cited.add(k);
          break;
        }
        case 'math': {
          prepareMath(text, t, nextEq, labels, at == null ? t.from : at);
          break;
        }
        default:
      }
    }
  }
}

function prepareMath(text, t, nextEq, labels, pos) {
  let src = text.slice(t.body.from, t.body.to);
  const found = [];
  const env = t.env || '';
  const starred = env.endsWith('*');
  const base = env.replace('*', '');
  const strip = (s, into) => s.replace(/\\label\s*\{([^{}]*)\}/g, (_, k) => { into.push(k.trim()); return ''; });
  if (!t.display || !env || env === 'displaymath' || env === 'math') {
    t.tex = strip(src, found);
    t.labels = found;
    return;
  }
  src = src.replace(/(^|[^\\])%.*$/gm, '$1');     // a commented-out \nonumber must not count
  const multi = base === 'align' || base === 'gather' || base === 'alignat' || base === 'flalign' || base === 'eqnarray';
  if (!multi) {
    // equation / multline: one number for the whole display
    let body = strip(src, found);
    let num = null;
    if (!starred && !/\\(nonumber|notag)\b/.test(body) && !/\\tag\s*\*?\s*\{/.test(body)) num = nextEq();
    body = body.replace(/\\(nonumber|notag)\b/g, '');
    if (base === 'multline') body = `\\begin{gathered}${body}\\end{gathered}`;
    t.tex = body + (num ? `\\tag{${num}}` : '');
    t.num = num;
    for (const k of found) labels.set(k, { text: num, kind: 'eq', name: 'Equation', pos });
    t.labels = found;
    return;
  }
  // multi-row environments: number each row unless suppressed
  let argPrefix = '';
  if (base === 'alignat') {
    const m = /^\s*\{[^{}]*\}/.exec(src);
    if (m) { argPrefix = m[0]; src = src.slice(m[0].length); }
  }
  const rows = splitRows(src);
  const out = [];
  let waiting = [];                                // amsmath keeps a label until a row takes a number
  rows.forEach((row, idx) => {
    const rl = [];
    let r = strip(row, rl);
    let num = null;
    const blank = r.trim() === '';
    if (!(blank && idx === rows.length - 1)) {
      if (!starred && !/\\(nonumber|notag)\b/.test(r) && !/\\tag\s*\*?\s*\{/.test(r)) num = nextEq();
    }
    r = r.replace(/\\(nonumber|notag)\b/g, '');
    if (base === 'eqnarray') { let seen = 0; r = r.replace(/&/g, () => (seen++ === 0 ? '&' : '')); }
    out.push(r + (num ? `\\tag{${num}}` : ''));
    if (num == null && !/\\tag\s*\*?\s*\{/.test(r)) waiting.push(...rl);
    else {
      const tag = num != null ? num : (/\\tag\s*\*?\s*\{([^{}]*)\}/.exec(r) || [])[1];
      for (const k of [...waiting, ...rl]) labels.set(k, { text: tag == null ? null : tag, kind: 'eq', name: 'Equation', pos });
      waiting = [];
    }
    found.push(...rl);
  });
  for (const k of waiting) labels.set(k, { text: null, kind: 'eq', name: 'Equation', pos });
  const kenv = base === 'alignat' ? 'alignat*' : base === 'gather' ? 'gather*' : 'align*';
  t.tex = `\\begin{${kenv}}${argPrefix}${out.join('\\\\')}\\end{${kenv}}`;
  t.labels = found;
}
