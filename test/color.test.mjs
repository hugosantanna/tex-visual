// Colors: xcolor's names, the colors a document defines, and what the scanner, the HTML
// converter and KaTeX are handed for \textcolor, \color, \hl and \colorbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../src/webview/latex.js';
import { cssColor } from '../src/webview/color.js';
import { texToHtml, renderMath, setMacros } from '../src/webview/render.js';

test('named colors, models and mixes', () => {
  const css = (spec, model = null, meta = null) => cssColor(spec, model, meta);
  assert.equal(css('red'), '#ff0000');
  assert.equal(css('green'), '#00ff00');                 // xcolor's green, not the darker CSS one
  assert.equal(css('gray'), '#808080');
  assert.notEqual(css('Gray'), css('gray'));             // dvipsnames' Gray is 50% black ink: names are case-sensitive
  // dvipsnames are cmyk, drawn as a PDF viewer draws them rather than as 1 - c - k
  assert.equal(css('ForestGreen'), '#129f57');
  assert.equal(css('ForestGreen', null, { colors: {}, svgnames: true }), '#228b22');
  assert.equal(css('Crimson'), '#dc143c');               // svgnames only
  assert.equal(css('31,78,121', 'RGB'), '#1f4e79');
  assert.equal(css('1F4E79', 'HTML'), '#1f4e79');
  assert.equal(css('0, 0.5, 1', 'rgb'), '#0080ff');
  assert.equal(css('0.5', 'gray'), '#808080');
  assert.equal(css('0.6,1,1', 'hsb'), '#0066ff');
  assert.equal(css('red!50'), '#ff8080');                // with white
  assert.equal(css('red!60!black'), '#990000');
  assert.equal(css('accent!50', null, { colors: { accent: [0, 0, 1] } }), '#8080ff');
  for (const bad of [css('nosuchcolor'), css('red!x'), css('1,2', 'RGB'), css('xyz', 'HTML'), css('500', 'wave')]) assert.equal(bad, null);
});

const DOC = [
  '\\documentclass{article}', '\\usepackage[dvipsnames]{xcolor}',
  '\\newcommand{\\response}[1]{\\textcolor{responsecolor}{#1}}',     // the color is defined after the macro
  '\\newcommand{\\hugo}[1]{{\\color{uabgreen}\\bfseries #1}}',
  '\\newcommand{\\plain}[1]{\\textbf{#1}}',
  '\\definecolor{responsecolor}{RGB}{0, 90, 160}', '\\definecolor{uabgreen}{HTML}{1E6B52}', '\\colorlet{soft}{uabgreen!30}',
  '\\begin{document}',
  '\\textcolor{red}{a} \\textcolor[rgb]{0,0,1}{b} \\textcolor{BrickRed}{c} \\textcolor{nosuchcolor}{d}',
  '\\response{e} \\hugo{f} \\plain{g} \\hl{h} \\colorbox{soft}{i}',
  '{\\color{red} group} \\textbf{\\color{blue} arg} tail',
  '\\begin{quote}\\color{teal} quoted\\end{quote} after',
  '\\definecolor{late}{gray}{0.5}\\textcolor{late}{j} \\sethlcolor{pink}\\hl{k}',
  '\\end{document}', '',
].join('\n');

test('scanner: \\textcolor, the document\'s colors, and macros that color their argument', () => {
  const s = scan(DOC);
  const by = (name) => s.tokens.filter((t) => t.type === 'style' && t.name === name);
  assert.deepEqual(by('textcolor').map((t) => t.color), ['#ff0000', '#0000ff', '#c43119', null, '#808080']);
  assert.equal(DOC.slice(by('textcolor')[1].inner.from, by('textcolor')[1].inner.to), 'b');   // past the [rgb]
  assert.equal(by('response')[0].color, '#005aa0');
  assert.equal(by('hugo')[0].color, '#1e6b52');
  assert.equal(by('plain')[0].color, undefined);
  assert.deepEqual(by('hl').map((t) => t.bg), ['#ffff00', '#ffbfbf']);      // yellow, then \sethlcolor{pink}
  assert.equal(by('colorbox')[0].bg, cssColor('uabgreen!30', null, s.meta));
  assert.equal(DOC.slice(by('colorbox')[0].inner.from, by('colorbox')[0].inner.to), 'i');
});

test('scanner: \\color reaches the end of its group or environment', () => {
  const s = scan(DOC);
  const sw = s.tokens.filter((t) => t.type === 'colorsw');
  assert.deepEqual(sw.map((t) => [t.color, DOC.slice(t.to, t.scopeTo)]), [['#ff0000', ' group'], ['#0000ff', ' arg'], ['#008080', ' quoted']]);
  // {\color{red} group}: the braces belong to the command. \textbf{\color{blue} arg}: they are \textbf's.
  assert.equal(DOC.slice(sw[0].open.from, sw[0].close.to), '{\\color{red} group}');
  assert.equal(sw[1].open, undefined);
  assert.equal(sw[2].open, undefined);
  // without a group it runs to the end
  const f = scan('a \\color{red} b', { fragment: true });
  assert.equal(f.tokens[0].scopeTo, 15);
});

test('a document\'s own \\hl wins over soul\'s', () => {
  const s = scan('\\newcommand{\\hl}[1]{\\textcolor{purple}{#1}}\n\\begin{document}\n\\hl{x}\n');
  const t = s.tokens.find((u) => u.name === 'hl');
  assert.equal(t.color, '#bf0040');
  assert.equal(t.bg, undefined);
});

test('\\sout and \\st strike text through, and so does a macro built on them', () => {
  const src = '\\newcommand{\\cut}[1]{\\textcolor{red}{\\sout{#1}}}\n\\begin{document}\n\\sout{a} \\st{b} \\cut{c}\n';
  const s = scan(src);
  const by = (name) => s.tokens.find((t) => t.type === 'style' && t.name === name);
  assert.equal(by('sout').kind, 'strike');
  assert.equal(by('st').kind, 'strike');
  assert.deepEqual([by('cut').color, by('cut').strike], ['#ff0000', true]);
  assert.equal(texToHtml('\\sout{a} \\cut{c}', { meta: s.meta }), '<s>a</s> <span class="tv-color tv-strike" style="--tv-c:#ff0000;">c</span>');
  // \st defined by the document as "subject to" is that, not soul's strike-through
  const own = scan('\\newcommand{\\st}{s.t.}\n\\begin{document}\nmax \\st{} x\n');
  assert.equal(own.tokens.some((t) => t.kind === 'strike'), false);
  assert.equal(texToHtml('max \\st{} x', { meta: own.meta }), 'max s.t. x');
});

test('HTML for widgets: spans that nest, and close where the group does', () => {
  const span = (c) => `<span class="tv-color" style="--tv-c:${c};">`;
  assert.equal(texToHtml('a \\textcolor{red}{b \\textbf{c}} d'), `a ${span('#ff0000')}b <strong>c</strong></span> d`);
  assert.equal(texToHtml('{\\color{blue} d \\color{teal} e} f'), `${span('#0000ff')} d ${span('#008080')} e</span></span> f`);
  assert.equal(texToHtml('\\textbf{\\color{red} g} h'), `<strong>${span('#ff0000')} g</span></strong> h`);
  assert.equal(texToHtml('\\hl{x} \\colorbox{red}{y}'), '<span class="tv-bgc" style="--tv-b:#ffff00;">x</span> <span class="tv-bgc" style="--tv-b:#ff0000;">y</span>');
  assert.equal(texToHtml('\\textcolor{nosuchcolor}{x}'), 'x');
  const s = scan(DOC);
  assert.equal(texToHtml('\\response{x}', { meta: s.meta }), `${span('#005aa0')}x</span>`);
});

test('math: KaTeX is given the color an xcolor name or a mix stands for', () => {
  const s = scan(DOC);
  setMacros(s.meta.defs, s.meta);
  const html = renderMath('\\textcolor{BrickRed}{a} + {\\color{uabgreen} b} + \\textcolor{red!60!black}{c}', false);
  assert.ok(!html.includes('tv-math-err'), 'a mix is not a KaTeX error');
  for (const c of ['#c43119', '#1e6b52', '#990000']) assert.ok(html.includes(`--tv-c:${c};`), c);
  setMacros([], null);
});
