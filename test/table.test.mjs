// Table model: every cell must own exactly the characters of its content, so an edit of one
// cell changes nothing else in the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tabularModel, tabularHtml } from '../src/webview/render.js';

const cellsOf = (src) => tabularModel(src).rows.map((r) => r.cells.map((c) => src.slice(c.from, c.to)));

test('cells of a generated regression table', () => {
  const src = fs.readFileSync(new URL('../examples/tables/teens.tex', import.meta.url), 'utf8').trim();
  const m = tabularModel(src);
  assert.equal(m.rows.length, 7);
  assert.deepEqual(cellsOf(src)[2], ['Log minimum wage', '-0.112**', '-0.041', '-0.058*']);
  assert.deepEqual(m.rows.map((r) => r.rule), ['heavy', null, 'light', null, 'light', null, null]);
  assert.equal(m.bottom, 'heavy');
  // the end of a row is where a new row would go: right after its \\
  assert.equal(src.slice(m.rows[2].end - 2, m.rows[2].end), '\\\\');
});

test('comments, multicolumn, math with &, escaped &, empty cells', () => {
  const src = [
    '\\begin{tabular}{l p{3cm} c}', '\\toprule % top', ' & \\multicolumn{2}{c}{ Both } \\\\', '\\cmidrule(lr){2-3}',
    'A & b \\& c % note', ' & $x & y$ \\\\[2pt]', '\\midrule', ' & & 3', '\\\\ \\bottomrule', '\\end{tabular}',
  ].join('\n');
  const m = tabularModel(src);
  assert.deepEqual(cellsOf(src), [['', 'Both'], ['A', 'b \\& c', '$x & y$'], ['', '', '3']]);
  assert.deepEqual(m.rows[0].cells.map((c) => c.span), [1, 2]);
  assert.equal(m.rows[1].cells[1].para, true);
  assert.deepEqual(m.rows.map((r) => r.rule), ['heavy', 'partial', 'light']);
});

test('replacing a cell range changes that cell and nothing else', () => {
  const src = '\\begin{tabular}{lcc}\n\\toprule\n & (1) & (2) \\\\\n\\midrule\nEffect & -0.193** & -0.141* \\\\\n & (0.076) &  \\\\\n\\bottomrule\n\\end{tabular}';
  const m = tabularModel(src);
  const edit = (r, c, text) => { const cell = m.rows[r].cells[c]; return src.slice(0, cell.from) + text + src.slice(cell.to); };
  assert.equal(edit(1, 1, '-0.2'), src.replace('-0.193**', '-0.2'));
  assert.deepEqual(cellsOf(edit(2, 2, '(0.08)'))[2], ['', '(0.076)', '(0.08)']);       // into an empty cell
  assert.deepEqual(cellsOf(edit(0, 0, 'Outcome'))[0], ['Outcome', '(1)', '(2)']);
  assert.match(edit(0, 0, 'Outcome'), /\\toprule\n Outcome& \(1\)/);      // on the row's own line, not after the rule
  assert.match(edit(2, 0, 'SE'), /\\\\\n SE& \(0\.076\)/);               // nor glued to the previous row's \\\\
  const last = '\\begin{tabular}{lc}\nA & \n\\\\\n\\end{tabular}';
  const lm = tabularModel(last).rows[0].cells[1];
  assert.equal(last.slice(0, lm.from) + 'x' + last.slice(lm.to), '\\begin{tabular}{lc}\nA & x\n\\\\\n\\end{tabular}');
});

test('html carries the ranges, shifted by where the table starts in its file', () => {
  const src = '\\begin{tabular}{lc}\nA & 1 \\\\\n\\end{tabular}';
  const at = src.indexOf('A');
  assert.match(tabularHtml(src, {}, 0), new RegExp(`data-c="${at}:${at + 1}"`));
  assert.match(tabularHtml(src, {}, 500), new RegExp(`data-c="${at + 500}:${at + 501}"`));
  assert.match(tabularHtml(src, {}, 500), /data-end="5\d\d"/);
});
