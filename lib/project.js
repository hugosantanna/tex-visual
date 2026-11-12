// Project files around a .tex document: labels from .aux, bibliography entries, the root
// file's preamble, and the tables it \input's. No VS Code dependency, so the test harness
// reads a project exactly the way the extension does.
const path = require('path');
const fs = require('fs');

const fsp = fs.promises;

async function readSmall(file, limit = 4 * 1024 * 1024) {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile() || st.size > limit) return null;
    return await fsp.readFile(file, 'utf8');
  } catch (e) { return null; }
}

function parseAux(text, out) {
  const re = /\\newlabel\{([^{}]+)\}\{\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1].endsWith('@cref')) continue;
    out[m[1]] = m[2].replace(/[{}]/g, '').replace(/\\[a-zA-Z]+\s*/g, '').trim();
  }
}

function bibField(body, name) {
  const m = new RegExp('(?:^|[\\s,])' + name + '\\s*=\\s*', 'i').exec(body);
  if (!m) return null;
  let i = m.index + m[0].length;
  const c = body[i];
  if (c === '{' || c === '"') {
    let depth = 0;
    for (let j = i; j < body.length; j++) {
      const ch = body[j];
      if (ch === '\\') { j++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0 && c === '{') return body.slice(i + 1, j); }
      else if (ch === '"' && c === '"' && j > i && depth === 0) return body.slice(i + 1, j);
    }
    return null;
  }
  const bare = /^[\w.-]+/.exec(body.slice(i));
  return bare ? bare[0] : null;
}

function splitName(n) {
  n = n.trim();
  if (n.startsWith('{') && n.endsWith('}')) return { last: n.slice(1, -1), first: '' };
  if (n.includes(',')) {
    const p = n.split(',').map((x) => x.trim());
    return { last: p[0], first: p[p.length - 1] === p[0] ? '' : p[p.length - 1] };
  }
  const parts = n.split(' ');
  let i = parts.length - 1;
  while (i > 0 && /^[a-z]/.test(parts[i - 1])) i--;
  return { last: parts.slice(i).join(' '), first: parts.slice(0, i).join(' ') };
}

function authorNames(a) {
  if (!a) return [];
  return a.replace(/\s+/g, ' ').split(/ and /i).map(splitName).filter((n) => n.last);
}

function formatAuthors(a) {
  const names = authorNames(a).map((n) => n.last);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + ' and ' + names[1];
  return names[0] + ' et al.';
}

/** One bibliography entry as a line of LaTeX text, author-year style. */
function formatReference(type, body, author, year) {
  const f = (name) => { const v = bibField(body, name); return v ? v.replace(/\s+/g, ' ').trim() : ''; };
  const names = authorNames(author).map((n, i) => (i === 0 ? (n.first ? `${n.last}, ${n.first}` : n.last) : (n.first ? `${n.first} ${n.last}` : n.last)));
  let who = names.length <= 1 ? names.join('') : names.length === 2 ? `${names[0]}, and ${names[1]}`
    : names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  if (who === '' && f('title')) who = '';
  const dot = (s) => (s && !/[.?!]$/.test(s.replace(/[}'"]+$/, '')) ? s + '.' : s);
  const parts = [];
  if (who) parts.push(dot(who));
  parts.push(dot(year || 'n.d.'));
  const title = f('title');
  const journal = f('journal') || f('journaltitle');
  const pages = f('pages').replace(/\s*-+\s*/g, '--');
  if (type === 'book' || type === 'phdthesis' || type === 'mastersthesis' || type === 'thesis') {
    if (title) parts.push(dot(`\\emph{${title}}`));
    const pub = [f('address') || f('location'), f('publisher') || f('school') || f('institution')].filter(Boolean).join(': ');
    if (pub) parts.push(dot(pub));
  } else if (journal) {
    if (title) parts.push(`\`\`${dot(title)}''`);
    let j = `\\emph{${journal}}`;
    const vol = f('volume'), no = f('number') || f('issue');
    if (vol) j += ` ${vol}`;
    if (no) j += ` (${no})`;
    if (pages) j += `${vol || no ? ': ' : ', '}${pages}`;
    parts.push(dot(j));
  } else {
    if (title) parts.push(`\`\`${dot(title)}''`);
    const book = f('booktitle');
    if (book) parts.push(dot(`In \\emph{${book}}${pages ? ', ' + pages : ''}`));
    const series = [f('type') || (type === 'techreport' || type === 'report' ? '' : ''), f('series'), f('number')].filter(Boolean).join(' ');
    const where = [f('institution') || f('organization') || f('publisher') || f('school'), series].filter(Boolean).join(' ');
    if (where) parts.push(dot(where));
    const how = f('howpublished') || f('note');
    if (how && !where && !book) parts.push(dot(how));
  }
  return parts.join(' ');
}

function parseBib(text, out) {
  const re = /@(\w+)\s*\{\s*([^,\s{}]+)\s*,/g;
  const starts = [];
  let m;
  while ((m = re.exec(text))) starts.push({ type: m[1].toLowerCase(), key: m[2], at: re.lastIndex, head: m.index });
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    if (s.type === 'comment' || s.type === 'string' || s.type === 'preamble') continue;
    const body = text.slice(s.at, i + 1 < starts.length ? starts[i + 1].head : text.length);
    const author = bibField(body, 'author') || bibField(body, 'editor') || bibField(body, 'institution') || bibField(body, 'organization');
    let year = bibField(body, 'year') || '';
    if (!year) { const d = bibField(body, 'date'); if (d) year = (/\d{4}/.exec(d) || [''])[0]; }
    year = String(year).trim();
    out[s.key] = { a: formatAuthors(author), y: year, r: formatReference(s.type, body, author, year) };
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripComments = (s) => s.replace(/(^|[^\\])%.*$/gm, '$1');

async function findRoot(file, text) {
  if (/\\documentclass/.test(text) && /\\begin\{document\}/.test(text)) return null;
  const dir = path.dirname(file);
  const magic = /^\s*%\s*!\s*TEX\s+root\s*=\s*(.+?)\s*$/mi.exec(text);
  if (magic) {
    const p = path.resolve(dir, magic[1]);
    if (fs.existsSync(p)) return p;
  }
  const base = escapeRe(path.basename(file).replace(/\.(tex|ltx)$/i, ''));
  const ref = new RegExp('\\\\(?:input|include|subfile)\\s*\\{[^}]*' + base + '(?:\\.tex)?\\s*\\}');
  for (const d of [dir, path.dirname(dir), path.dirname(path.dirname(dir))]) {
    let names;
    try { names = await fsp.readdir(d); } catch (e) { continue; }
    for (const n of names) {
      if (!/\.(tex|ltx)$/i.test(n)) continue;
      const p = path.join(d, n);
      if (p === file) continue;
      const t = await readSmall(p, 2 * 1024 * 1024);
      if (t && /\\documentclass/.test(t) && ref.test(stripComments(t))) return p;
    }
  }
  return null;
}

const INPUT_LIMIT = 512 * 1024, INPUT_TOTAL = 6 * 1024 * 1024, INPUT_COUNT = 300, INPUT_DEPTH = 4;

/**
 * The files the document pulls in with \input (and the files those pull in). Tables kept in
 * their own files are drawn in place of the command; sections and floats in them are counted.
 */
async function gatherInputs(text, dirs) {
  const inputs = {};
  let total = 0, count = 0;
  const visit = async (src, depth) => {
    for (const m of stripComments(src).matchAll(/\\input\s*\{([^{}]+)\}/g)) {
      const name = m[1].trim();
      if (!name || name in inputs || count >= INPUT_COUNT) continue;
      for (const base of dirs) {
        const p = path.resolve(base, name);
        const t = (await readSmall(p, INPUT_LIMIT)) ?? (await readSmall(p + '.tex', INPUT_LIMIT));
        if (t == null) continue;
        if (total + t.length > INPUT_TOTAL || /\\documentclass/.test(t)) break;
        inputs[name] = t; total += t.length; count++;
        if (depth < INPUT_DEPTH) await visit(t, depth + 1);
        break;
      }
    }
  };
  const d = text.search(/\\begin\{document\}/);
  await visit(d >= 0 ? text.slice(d) : text, 1);
  return inputs;
}

/**
 * Everything the webview needs from the files around `file`.
 * opts.outDir: extra directory to search for .aux files (LaTeX Workshop's latex.outDir).
 */
async function gatherExternal(file, text, opts = {}) {
  const dir = path.dirname(file);
  const rootFile = await findRoot(file, text);
  const rootDir = rootFile ? path.dirname(rootFile) : dir;
  const rootText = rootFile ? await readSmall(rootFile) : null;

  // Preamble of the root file (for sub-files) plus anything the preamble \input's.
  let preamble = '';
  const own = rootText != null ? rootText : text;
  const d = own.search(/\\begin\{document\}/);
  const head = stripComments(d >= 0 ? own.slice(0, d) : rootText != null ? own : '');
  if (rootText != null) preamble += head + '\n';
  for (const m of head.matchAll(/\\(?:input|include)\s*\{([^{}]+)\}/g)) {
    const p = path.resolve(rootDir, m[1].trim());
    const t = (await readSmall(p)) || (await readSmall(p + '.tex'));
    if (t) preamble += t + '\n';
  }

  // Labels from .aux files (fallback for references this file does not define itself).
  const aux = {};
  const auxDirs = new Set([dir, rootDir]);
  if (opts.outDir) auxDirs.add(path.resolve(rootDir, opts.outDir));
  const mainAux = path.basename(rootFile || file).replace(/\.(tex|ltx)$/i, '') + '.aux';
  for (const ad of auxDirs) {
    let names;
    try { names = (await fsp.readdir(ad)).filter((n) => n.endsWith('.aux')); } catch (e) { continue; }
    names.sort((a, b) => (a === mainAux) - (b === mainAux));
    for (const n of names.slice(-40)) {
      const t = await readSmall(path.join(ad, n));
      if (t) parseAux(t, aux);
    }
  }

  // Bibliography databases.
  const bib = {};
  const all = stripComments(text) + '\n' + (rootText ? stripComments(rootText) : '') + '\n' + preamble;
  const seen = new Set();
  for (const m of all.matchAll(/\\(?:bibliography|addbibresource|addglobalbib)\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)) {
    for (let name of m[1].split(',')) {
      name = name.trim();
      if (!name) continue;
      for (const base of [rootDir, dir]) {
        const p = path.resolve(base, /\.bib$/i.test(name) ? name : name + '.bib');
        if (seen.has(p)) continue;
        seen.add(p);
        const t = await readSmall(p, 16 * 1024 * 1024);
        if (t) parseBib(t, bib);
      }
    }
  }

  const inputs = await gatherInputs(text, rootDir === dir ? [dir] : [rootDir, dir]);
  return { aux, bib, rootPreamble: preamble, inputs };
}

module.exports = { gatherExternal, gatherInputs, parseAux, parseBib, formatReference, findRoot };
