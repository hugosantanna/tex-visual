// Which line breaks of the source are a space to TeX. Those are the ones the visual view draws
// as a space, so that a paragraph fills its lines the same way however its source is wrapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, softBreaks } from '../src/webview/latex.js';

// the numbers (from 1) of the lines that run on into the next line, as the view decides it: a
// line of labels runs on only if the line before ran into it
const runOn = (text, opts = {}) => {
  const sc = scan(text, { fragment: !opts.document });
  const taken = new Set();
  for (const b of softBreaks(text, sc, opts.keep)) if (b.after !== 'label' || taken.has(b.line - 1)) taken.add(b.at);
  return [...taken].map((at) => text.slice(0, at).split('\n').length);
};

test('the lines of a paragraph run on; a blank line ends it', () => {
  assert.deepEqual(runOn('One line of text\nand a second line\nand a third.\n\nA new paragraph\nof two lines.\n'), [1, 2, 5]);
  assert.deepEqual(runOn('A paragraph on one line.\n\nAnother one.\n'), []);
  assert.deepEqual(runOn('text\n   \nmore text'), [], 'a line of spaces is a blank line');
});

test('what asks for a new line gets one', () => {
  assert.deepEqual(runOn('Jane Doe\\\\\nUniversity of Somewhere\\\\[2pt]\nSomewhere'), [], '\\\\');
  assert.deepEqual(runOn('first \\par\nsecond \\newline\nthird'), [], '\\par, \\newline');
  assert.deepEqual(runOn('a line \\\\ that goes on\nand on'), [1], '\\\\ in the middle of a line');
  assert.deepEqual(runOn('text % a remark\nmore text'), [], 'a comment hides the line break');
  assert.deepEqual(runOn('text\n% a line of comment\nmore text'), [], 'a comment line stands alone');
});

test('math: displays keep their lines, a formula in the text does not', () => {
  assert.deepEqual(runOn('We estimate\n\\begin{equation}\n  y = x\n\\end{equation}\nwhere $y$ is\nthe outcome.'), [5]);
  assert.deepEqual(runOn('We estimate\n\\[\n  y = x\n\\]\nwhere'), []);
  assert.deepEqual(runOn('so that $a +\nb$ holds\nfor all $x$'), [1, 2], 'inline math over a line break');
  assert.deepEqual(runOn('it follows that\n$x = 1$,\nas claimed'), [1, 2], 'a line that is only a formula');
});

test('lists: an item runs on, the next item starts a line', () => {
  const list = '\\begin{itemize}\n\\item first point\n  goes on here\n\\item second point\n\\item\n  third, written under its \\item\n\\end{itemize}\nAfter the list\nmore text';
  assert.deepEqual(runOn(list), [2, 5, 8]);
});

test('headings stand alone, a \\paragraph head runs into its text', () => {
  assert.deepEqual(runOn('\\section{Results}\nWe estimate\nthe model.'), [2]);
  assert.deepEqual(runOn('\\section{Results}\n\\label{sec:results}\nWe estimate'), [], 'the label under a heading keeps its line');
  assert.deepEqual(runOn('Some text\n\\label{here}\nmore text'), [1, 2], 'a label inside a paragraph does not break it');
  assert.deepEqual(runOn('Text before\n\\paragraph{Demand.}\nThere are $n$ firms.'), [2]);
});

test('lines of commands are not text', () => {
  assert.deepEqual(runOn('\\input{sections/intro}\n\\input{sections/data}\n\\input{sections/results}'), []);
  assert.deepEqual(runOn('Some text\n\\clearpage\nMore text'), []);
  assert.deepEqual(runOn('\\centering\n\\includegraphics[width=\\textwidth]{fig}\n\\caption{A caption that is\nwritten on two lines}\n\\label{fig:a}'), [3, 4]);
  assert.deepEqual(runOn('\\begin{tabular}{ll}\na & b \\\\\nc & d\n\\end{tabular}\nNotes: the rows\nabove.'), [5]);
});

test('text set by a command is text', () => {
  assert.deepEqual(runOn('as shown by\n\\citet{card1994}\nand others'), [1, 2]);
  assert.deepEqual(runOn('\\textbf{Result 1.}\nMinimum wages\n\\emph{do not} reduce it.\\footnote{A note that\nis long.}'), [1, 2, 3]);
  assert.deepEqual(runOn('an unknown \\command{with text}\n\\another{argument}\nruns on'), [1, 2]);
});

test('environments', () => {
  assert.deepEqual(runOn('Text before\n\\begin{quote}\nQuoted text that is\nwrapped.\n\\end{quote}\nText after\nit.'), [3, 6]);
  assert.deepEqual(runOn('\\begin{proof} The claim\nfollows. \\end{proof}\nNext.'), [1]);
  const verse = 'Text\ngoes on\n\\begin{verse}\nA line\nand a line\n\\end{verse}\nand on\nand on';
  assert.deepEqual(runOn(verse), [1, 4, 7]);
  assert.deepEqual(runOn(verse, { keep: (e) => e.name === 'verse' }), [1, 7], 'an environment told to keep its lines');
});

test('a line of labels runs on only when told the line before did', () => {
  const text = 'Some text\n\\label{a}\nmore text';
  const sc = scan(text, { fragment: true });
  assert.deepEqual(softBreaks(text, sc).map((b) => [b.at, b.line, b.after]), [[9, 0, 'text'], [19, 10, 'label']]);
});

test('only the body of the document', () => {
  const doc = '\\documentclass{article}\n\\title{A title\nin two lines}\n\\begin{document}\nBody text\ngoes on.\n\\end{document}\nleft over\nafter the end';
  assert.deepEqual(runOn(doc, { document: true }), [5]);
});
