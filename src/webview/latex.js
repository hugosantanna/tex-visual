// Lightweight LaTeX scanner. Produces a flat, position-sorted token list that the
// decoration layer turns into rendered widgets. It is deliberately forgiving: anything
// it does not understand is left alone and shows up as plain source.

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
  textsuperscript: 'sup', textsubscript: 'sub', thanks: 'fn',
};
const SECTION = {
  part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5,
};
const REF = new Set(['ref', 'eqref', 'cref', 'Cref', 'autoref', 'pageref', 'nameref', 'vref']);
const CITE_RE = /^(cite|citet|citep|citealt|citealp|citeauthor|citeyear|citeyearpar|textcite|parencite|footcite|autocite|Citet|Citep|Textcite|Parencite|nocite|citenum)$/;
// Commands that only steer layout: hidden in the visual view.
export const HIDE = new Set([
  'noindent', 'centering', 'medskip', 'smallskip', 'bigskip', 'FloatBarrier', 'newpage',
  'clearpage', 'par', 'indent', 'raggedright', 'raggedleft', 'pagebreak', 'cleardoublepage',
  'hfill', 'vfill', 'appendix', 'small', 'footnotesize', 'normalsize', 'large', 'Large',
  'onehalfspacing', 'doublespacing', 'singlespacing', 'sloppy', 'nopagebreak', 'linebreak',
  'protect', 'displaystyle', 'bfseries', 'itshape', 'scriptsize', 'tiny', 'LARGE', 'huge',
]);
// Commands shown as dim source together with their arguments.
const RAW_ARGS = {
  vspace: 1, hspace: 1, setlength: 2, pagestyle: 1, thispagestyle: 1, bibliographystyle: 1,
  setcounter: 2, addtocounter: 2, usepackage: 1, documentclass: 1, graphicspath: 1,
  numberwithin: 2, theoremstyle: 1, newtheorem: 2, title: 1, author: 1, date: 1,
  renewcommand: 2, newcommand: 2, providecommand: 2, DeclareMathOperator: 2,
  bibliography: 1, addbibresource: 1, printbibliography: 0, geometry: 1, hypersetup: 1,
  linespread: 1, pagenumbering: 1, definecolor: 3, color: 1, phantom: 1, rule: 2,
  include: 1, includeonly: 1, subfile: 1, tableofcontents: 0, keywords: 1, JEL: 1,
};
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

function composeAccent(base, mark) {
  if (base === '\\i' || base === 'ı') base = 'i';
  return (base + mark).normalize('NFC');
}

/** Read the preamble (and any root-file preamble) for macros, theorem names, title block. */
export function parsePreamble(src) {
  const text = stripComments(src);
  const meta = {
    defs: [], theorems: {}, title: null, author: null, date: undefined,
    numberWithin: {}, graphicsPaths: [], bibFiles: [],
  };
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
    } else if (name === 'graphicspath') {
      const a = readReq(text, after);
      if (a) for (const g of text.slice(a.from + 1, a.to - 1).matchAll(/\{([^{}]*)\}/g)) meta.graphicsPaths.push(g[1]);
    } else if (name === 'bibliography' || name === 'addbibresource') {
      const a = readReq(text, after);
      if (a) for (const f of text.slice(a.from + 1, a.to - 1).split(',')) if (f.trim()) meta.bibFiles.push(f.trim());
    }
    void at;
  }
  return meta;
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
 * Returns { tokens, envs, bodyFrom, meta }.
 */
export function scan(text, opts = {}) {
  const n = text.length;
  const tokens = [];
  const envs = [];
  const stack = [];
  let bodyFrom = 0;
  let meta;
  if (opts.fragment) {
    meta = opts.meta || parsePreamble('');
  } else {
    const d = findDocBegin(text);
    meta = parsePreamble((opts.rootPreamble ? opts.rootPreamble + '\n' : '') + (d >= 0 ? text.slice(0, d) : text));
    if (d >= 0) {
      const nl = text.indexOf('\n', d);
      bodyFrom = nl < 0 ? n : nl + 1;
    }
  }
  const theoremNames = Object.assign({}, DEFAULT_THEOREMS);
  for (const k in meta.theorems) theoremNames[k] = meta.theorems[k].title;
  const push = (t) => { tokens.push(t); return t; };
  let i = bodyFrom;
  let tail = -1;

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
  return { tokens, envs, bodyFrom, tail, meta, theoremNames };

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
      const o = readOpt(text, a.to);
      let to = o ? o.to : a.to;
      if (env === 'thebibliography' || env === 'minipage' || env === 'subfigure' || env === 'subtable' || env === 'wrapfigure') {
        let r = readReq(text, to);
        if (r) { to = r.to; if (env === 'wrapfigure') { r = readReq(text, to); if (r) to = r.to; } }
      }
      const tok = push({
        type: 'begin', env, from, to, nameTo: a.to,
        opt: o ? { from: o.from, to: o.to } : null, thm: isThm,
      });
      stack.push(tok);
      return isThm ? a.to : to;
    }

    if (has(SECTION, name)) {
      return argCommand('section', name, from, j, { level: SECTION[name], star });
    }
    if (has(STYLE, name)) {
      const kind = STYLE[name];
      if (kind === 'href' || kind === 'color') {
        const u = readReq(text, j), a = u && readReq(text, u.to);
        if (!a) { push({ type: 'cs', name, from, to: j }); return j; }
        push({
          type: 'style', name, kind, from, to: a.to, url: text.slice(u.from + 1, u.to - 1),
          open: { from, to: a.from + 1 }, close: { from: a.to - 1, to: a.to }, inner: { from: a.from + 1, to: a.to - 1 },
        });
        return a.from + 1;
      }
      return argCommand('style', name, from, j, { kind });
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
      push({ type: 'raw', name, from, to });
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

/**
 * Number sections, theorems, equations, floats and list items, and resolve labels.
 * Mutates tokens (adds .num / .tex / .labels) and returns { labels, bibitems }.
 */
export function number(text, sc) {
  const { tokens, meta, theoremNames } = sc;
  const labels = new Map();
  const bibitems = new Map();
  const sec = [0, 0, 0, 0, 0, 0];
  const counters = { equation: 0, figure: 0, table: 0 };
  const scope = [{ cur: null, kind: null, name: null, list: null }];
  const top = () => scope[scope.length - 1];
  const secPrefix = (within) => {
    if (within === 'section') return sec[1] + '.';
    if (within === 'subsection') return sec[1] + '.' + sec[2] + '.';
    if (within === 'chapter') return sec[0] + '.';
    return '';
  };
  const eqWithin = meta.numberWithin.equation;
  const nextEq = () => secPrefix(eqWithin) + (++counters.equation);
  let listDepth = 0, enumDepth = 0;

  for (const t of tokens) {
    switch (t.type) {
      case 'section': {
        if (t.level >= 4) { t.num = null; break; }
        if (!t.star) {
          sec[t.level]++;
          for (let l = t.level + 1; l < 6; l++) sec[l] = 0;
          if (eqWithin && (eqWithin === t.name)) counters.equation = 0;
          for (const k in meta.theorems) if (meta.theorems[k].within === t.name) counters['thm:' + (meta.theorems[k].counter || k)] = 0;
          t.num = sec.slice(1, t.level + 1).join('.');
          if (t.level === 0) t.num = String(sec[0]);
          scope[0].cur = t.num; scope[0].kind = 'sec'; scope[0].name = t.level === 0 ? 'Chapter' : 'Section';
        } else t.num = null;
        break;
      }
      case 'begin': {
        const s = { cur: top().cur, kind: top().kind, name: top().name, list: null, env: t.env };
        if (t.thm && t.env !== 'proof') {
          const def = meta.theorems[t.env];
          const numbered = def ? def.numbered : !t.env.endsWith('*');
          t.title = theoremNames[t.env];
          t.plain = !def || def.style === 'plain';
          if (numbered) {
            const cname = 'thm:' + ((def && def.counter) || t.env);
            counters[cname] = (counters[cname] || 0) + 1;
            const owner = def && def.counter ? meta.theorems[def.counter] : def;
            t.num = secPrefix(owner && owner.within) + counters[cname];
            s.cur = t.num; s.kind = 'thm'; s.name = t.title;
          }
        } else if (t.env === 'figure' || t.env === 'figure*' || t.env === 'table' || t.env === 'table*') {
          s.float = t.env.replace('*', '');
        } else if (LIST_ENVS.has(t.env)) {
          listDepth++;
          if (t.env === 'enumerate') enumDepth++;
          s.list = { kind: t.env, n: 0, depth: listDepth, edepth: enumDepth, parent: top().cur && top().kind === 'item' ? top().cur : '' };
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
        for (let k = scope.length - 1; k > 0; k--) if (scope[k].list) { s = scope[k]; break; }
        if (!s) { t.bullet = '•'; t.depth = 1; break; }
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
        if (t.kind === 'caption') {
          let s = null;
          for (let k = scope.length - 1; k > 0; k--) if (scope[k].float) { s = scope[k]; break; }
          if (s) {
            counters[s.float]++;
            t.num = String(counters[s.float]);
            t.floatName = s.float === 'figure' ? 'Figure' : 'Table';
            s.cur = t.num; s.kind = s.float; s.name = t.floatName;
          }
        }
        break;
      }
      case 'label': {
        const s = top();
        labels.set(t.key, { text: s.cur, kind: s.kind, name: s.name, pos: t.from });
        break;
      }
      case 'bibitem': {
        bibitems.set(t.key, t.label);
        break;
      }
      case 'math': {
        prepareMath(text, t, nextEq, labels);
        break;
      }
      default:
    }
  }
  return { labels, bibitems };
}

function prepareMath(text, t, nextEq, labels) {
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
    for (const k of found) labels.set(k, { text: num, kind: 'eq', name: 'Equation', pos: t.from });
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
    for (const k of rl) labels.set(k, { text: num, kind: 'eq', name: 'Equation', pos: t.from });
    found.push(...rl);
  });
  const kenv = base === 'alignat' ? 'alignat*' : base === 'gather' ? 'gather*' : 'align*';
  t.tex = `\\begin{${kenv}}${argPrefix}${out.join('\\\\')}\\end{${kenv}}`;
  t.labels = found;
}
