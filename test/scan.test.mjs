// Scanner and numbering against the demo paper. The expected numbers are what pdflatex
// writes to demo.aux, so this checks the live numbering against a real TeX run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scan, number, splitRows } from '../src/webview/latex.js';

const text = fs.readFileSync(new URL('../examples/demo.tex', import.meta.url), 'utf8');
const sc = scan(text);
const num = number(text, sc);
const count = (type) => sc.tokens.filter((t) => t.type === type).length;

test('labels get the numbers LaTeX gives them', () => {
  const got = Object.fromEntries([...num.labels].map(([k, v]) => [k, v.text]));
  assert.deepEqual(got, {
    'eq:demand': '1', 'eq:profit': '2', 'def:eq': '1', 'lem:br': '1', 'eq:br': '3', 'prop:eq': '1',
    'eq:q': '4', 'eq:p': '5', 'eq:pi': '6', 'tab:n': '1', 'fig:br': '1',
  });
});

test('preamble: macros, theorem names, title block', () => {
  assert.deepEqual(sc.meta.defs.map((d) => d.name), ['\\R', '\\BR', '\\qstar', '\\argmax']);
  assert.match(sc.meta.defs[3].tex, /operatorname\*/);
  assert.equal(sc.meta.theorems.proposition.title, 'Proposition');
  assert.equal(sc.meta.theorems.proposition.style, 'plain');
  assert.equal(sc.meta.theorems.remark.style, 'definition');
  assert.equal(sc.meta.title, 'Cournot Competition in One Page');
});

test('structure tokens', () => {
  assert.equal(sc.tokens.filter((t) => t.type === 'section' && t.level === 1).length, 4);
  assert.equal(count('tabular'), 1);
  assert.equal(count('graphics'), 1);
  assert.equal(count('bibitem'), 2);
  assert.equal(count('cite'), 2);
  assert.equal(count('maketitle'), 1);
  assert.ok(count('math') > 40);
  assert.equal(sc.envs.filter((e) => e.name === 'proof').length, 2);
});

test('align rows are tagged individually and labels stripped', () => {
  const align = sc.tokens.find((t) => t.type === 'math' && t.env === 'align');
  assert.match(align.tex, /^\\begin\{align\*\}/);
  assert.deepEqual([...align.tex.matchAll(/\\tag\{(\d+)\}/g)].map((m) => m[1]), ['4', '5', '6']);
  assert.doesNotMatch(align.tex, /\\label/);
});

test('unfinished input never produces a token that runs past it', () => {
  for (const frag of ['$x', '\\begin{equation} a=b', '\\emph{open', '\\section{', '$$', '\\[ x', '\\begin{tabular}{ll} a & b']) {
    const s = scan('\\begin{document}\n' + frag + '\n\nNext paragraph with $y$.\n');
    const math = s.tokens.filter((t) => t.type === 'math');
    assert.equal(math.length, 1, frag);
    assert.equal(math[0].to - math[0].from, 3, frag);
  }
});

test('splitRows ignores \\\\ inside nested environments and braces', () => {
  assert.equal(splitRows('a \\\\ \\begin{cases} x \\\\ y \\end{cases} \\\\ c').length, 3);
  assert.equal(splitRows('a & {b \\\\ c}').length, 1);
});

test('theorem counters: shared, numbered within sections, starred', () => {
  const src = [
    '\\documentclass{article}',
    '\\newtheorem{theorem}{Theorem}[section]',
    '\\newtheorem{lemma}[theorem]{Lemma}',
    '\\newtheorem*{claim}{Claim}',
    '\\numberwithin{equation}{section}',
    '\\begin{document}',
    '\\section{One}',
    '\\begin{theorem}\\label{a} x \\end{theorem}',
    '\\begin{lemma}\\label{b} x \\end{lemma}',
    '\\begin{claim} x \\end{claim}',
    '\\section{Two}\\label{s2}',
    '\\begin{lemma}\\label{c} x \\end{lemma}',
    '\\begin{equation}\\label{e} x \\end{equation}',
    '\\begin{enumerate} \\item one \\item two \\label{it} \\end{enumerate}',
    '\\end{document}',
  ].join('\n');
  const s2 = scan(src);
  const n2 = number(src, s2);
  const got = Object.fromEntries([...n2.labels].map(([k, v]) => [k, v.text]));
  assert.deepEqual(got, { a: '1.1', b: '1.2', s2: '2', c: '2.1', e: '2.1', it: '2' });
  assert.equal(s2.tokens.find((t) => t.type === 'begin' && t.env === 'claim').num, undefined);
});

// ---- examples/paper.tex: an applied paper with input tables, subfigures and an appendix.
// Expected numbers are again what pdflatex writes to paper.aux.
const paper = fs.readFileSync(new URL('../examples/paper.tex', import.meta.url), 'utf8');
const psc = scan(paper);
const pnum = number(paper, psc);

test('paper: floats, subfigures and the appendix are numbered as LaTeX numbers them', () => {
  const got = Object.fromEntries([...pnum.labels].map(([k, v]) => [k, v.text]));
  assert.deepEqual(got, {
    'sec:intro': '1', 'sec:results': '2', 'eq:main': '1', 'tab:main': '1', 'fig:trends_a': '1a',
    'fig:trends_b': '1b', 'fig:trends': '1', 'app:more': 'A', 'tab:robust': 'A1',
  });
  // a label after \caption inside threeparttable belongs to the table, not to the section
  assert.equal(pnum.labels.get('tab:main').name, 'Table');
  assert.equal(pnum.labels.get('app:more').name, 'Appendix');
});

test('paper: \\caption* is unnumbered, sub-captions get letters', () => {
  const caps = psc.tokens.filter((t) => t.type === 'style' && t.kind === 'caption');
  assert.deepEqual(caps.map((t) => t.num || t.sub || (t.star ? '*' : '?')), ['1', '(a)', '(b)', '1', '*', 'A1']);
});

test('paper: title block comes from the body, \\crefname from the preamble', () => {
  assert.match(psc.meta.title, /^Minimum Wages and Youth Employment\\thanks/);
  assert.match(psc.meta.author, /Jane Doe/);
  assert.equal(psc.meta.date, 'November 2026');
  assert.deepEqual(psc.meta.crefNames, { table: { c: 'Table' }, figure: { c: 'Figure' } });
});

test('paper: layout wrappers keep their text, table notes are not a bulleted list', () => {
  const s = scan('\\begin{document}\n\\multirow{2}{*}{Teen} \\parbox{5cm}{note} \\resizebox{\\textwidth}{!}{x}\n');
  const wraps = s.tokens.filter((t) => t.type === 'style');
  assert.deepEqual(wraps.map((t) => '\\begin{document}\n\\multirow{2}{*}{Teen} \\parbox{5cm}{note} \\resizebox{\\textwidth}{!}{x}\n'.slice(t.inner.from, t.inner.to)), ['Teen', 'note', 'x']);
  const item = psc.tokens.find((t) => t.type === 'item');
  assert.equal(item.notes, true);
});

test('counters: \\setcounter, \\addtocounter and \\the<counter> templates', () => {
  const src = [
    '\\begin{document}', '\\section{One}', '\\setcounter{equation}{4}',
    '\\begin{equation} a \\label{e5} \\end{equation}',
    '\\renewcommand{\\theequation}{S\\arabic{equation}}', '\\addtocounter{equation}{-5}',
    '\\begin{equation} b \\label{s1} \\end{equation}',
    '\\renewcommand{\\thefigure}{\\thesection.\\alph{figure}}',
    '\\begin{figure}\\caption{x}\\label{f}\\end{figure}', '',
  ].join('\n');
  const s = scan(src);
  const n = number(src, s);
  assert.deepEqual(Object.fromEntries([...n.labels].map(([k, v]) => [k, v.text])), { e5: '5', s1: 'S1', f: '1.a' });
});

test('numbering walks into \\input files; labels and citations in them count', () => {
  const src = [
    '\\documentclass{article}', '\\newcommand{\\nObs}{11,672}', '\\newcommand{\\edit}[1]{\\textcolor{blue}{#1}}',
    '\\renewcommand{\\thetable}{S\\arabic{table}}', '\\begin{document}',
    '\\input{sections/intro}', '\\begin{appendices}', '\\section{More}\\label{app}',
    '\\begin{table}\\caption{Here}\\label{t2}\\end{table}', '\\end{appendices}', 'We use \\nObs{} cells and \\edit{new text}.', '',
  ].join('\n');
  const inputs = { 'sections/intro': '\\section{Intro}\\label{sec}\nSee \\citet{k1}.\n\\input{tables/t1}\n', 'tables/t1': '\\begin{table}\\caption{There}\\label{t1}\\begin{tabular}{l}a\\end{tabular}\\end{table}' };
  const s = scan(src);
  const n = number(src, s, inputs);
  assert.deepEqual(Object.fromEntries([...n.labels].map(([k, v]) => [k, v.text])), { sec: '1', t1: 'S1', app: 'A', t2: 'S2' });
  assert.equal(n.labels.get('t1').pos, src.indexOf('\\input'));       // jumps to the \input line
  assert.deepEqual([...n.cited], ['k1']);
  assert.equal(s.meta.textMacros.nObs, '11,672');
  assert.equal(s.tokens.filter((t) => t.type === 'style' && t.name === 'edit').length, 1);
});

test('align: a commented-out \\nonumber does not count, a label waits for the next numbered row', () => {
  const src = '\\begin{document}\n\\begin{align}\n\\label{first} a &= b \\nonumber \\\\\n % &= c \\nonumber \\\\\n &= d \\\\\n e &= f \\label{second}\n\\end{align}\n';
  const s = scan(src);
  const n = number(src, s);
  assert.deepEqual(Object.fromEntries([...n.labels].map(([k, v]) => [k, v.text])), { first: '1', second: '2' });
});

test('title block: where \\title, \\author and \\date are written', () => {
  const at = (txt, s) => txt.slice(s.arg.from, s.arg.to);
  // demo.tex keeps them in the preamble, paper.tex after \begin{document}
  assert.equal(at(text, sc.titleSrc.title), 'Cournot Competition in One Page');
  assert.equal(at(text, sc.titleSrc.date), '\\today');
  assert.ok(sc.titleSrc.title.to <= sc.bodyFrom);
  assert.ok(psc.titleSrc.author.from >= psc.bodyFrom);
  assert.equal(at(paper, psc.titleSrc.date), 'November 2026');
  // a commented-out \title and \titleformat are not it; the optional argument is skipped
  const t2 = '% \\title{Old}\n\\title[Short]{New \\emph{one}}\n\\titleformat{x}\n\\begin{document}\n\\maketitle\n';
  const s2 = scan(t2);
  assert.equal(at(t2, s2.titleSrc.title), 'New \\emph{one}');
  assert.equal(s2.titleSrc.author, undefined);
});
