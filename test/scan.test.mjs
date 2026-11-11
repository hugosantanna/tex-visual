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
