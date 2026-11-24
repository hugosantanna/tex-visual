// Renders examples/paper.tex (an applied paper: \input tables, table notes, subfigures,
// appendix numbering, a .bib file) and checks what a reader would see.
export default async function (t) {
  const { page } = t;
  const text = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
  let s = await t.state();
  t.assert(s.errors.length === 0 && s.mathErrors === 0, 'no script or KaTeX errors ' + s.errors.join('; '));

  // title block: \title, \author and \date sit after \begin{document}
  t.assert((await text('.tv-title'))[0].startsWith('Minimum Wages and Youth Employment'), 'title block built from \\title in the body');
  const notes = await text('.tv-title-note');
  t.assert(notes.length === 3 && notes[0].startsWith('*We thank') && notes[1].startsWith('†University'), '\\thanks notes listed under the title: ' + notes.map((n) => n.slice(0, 12)).join(' | '));
  t.assert(!(await page.$eval('.cm-content', (e) => e.textContent)).includes('\\title'), 'the \\title source line is hidden');

  // a click on a part of the title block goes to the command it is written in, not to \maketitle
  const head0 = await page.evaluate(() => window.__tv.view.state.selection.main.head);
  const clickOn = async (sel, i = 0) => {
    const p = await page.$$eval(sel, (els, i) => { const b = els[i].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, i);
    await page.mouse.click(p.x, p.y);
    await t.sleep(250);
  };
  await clickOn('.tv-title');
  const titleSrc = await page.$eval('.cm-content', (e) => e.innerText);
  t.assert(titleSrc.includes('\\title{Minimum Wages') && !titleSrc.includes('\\maketitle') && (await text('.tv-title')).length === 1, 'a click on the title shows \\title{…} above the title block, not \\maketitle');
  await clickOn('.tv-title-note', 2);
  const around = await page.evaluate(() => { const v = window.__tv.view, h = v.state.selection.main.head; return v.state.doc.sliceString(h - 8, h + 9); });
  t.assert(around === '\\thanks{Institute', 'a click on a \\thanks note puts the cursor in that note: ' + around);
  await page.evaluate((h) => window.__tv.view.dispatch({ selection: { anchor: h } }), head0);
  await t.sleep(150);
  t.assert(!(await page.$eval('.cm-content', (e) => e.textContent)).includes('\\title'), 'and it folds away again when the cursor leaves');

  const cites = await text('.tv-cite');
  t.assert(cites.includes('Card and Krueger (1994)') && cites.includes('(Neumark and Wascher, 2008)'), 'citations resolved from refs.bib: ' + cites.join(' · '));
  const refs = await text('.tv-ref');
  t.assert(refs.includes('Table 1') && refs.includes('Figure 1') && refs.includes('Table A1'), '\\cref uses \\crefname and the appendix number: ' + refs.join(' · '));

  // a paragraph fills its lines the same way however its source is wrapped: the introduction is
  // written on four lines, the abstract on one
  const flow = await page.evaluate(() => {
    const v = window.__tv.view, doc = v.state.doc, src = doc.toString();
    const para = (needle) => {
      const at = src.indexOf(needle), b = v.lineBlockAt(at);
      const n = v.domAtPos(at + 1).node, el = (n.nodeType === 1 ? n : n.parentElement).closest('.cm-line');
      return { lines: doc.lineAt(b.to).number - doc.lineAt(b.from).number + 1, joins: el.querySelectorAll('.tv-join').length, text: el.textContent };
    };
    return { intro: para('Whether minimum wages'), abstract: para('We revisit the employment'), kept: src.includes('Panel studies\noften find') };
  });
  t.assert(flow.intro.lines === 4 && flow.intro.joins === 3 && flow.abstract.lines === 1 && flow.abstract.joins === 0, 'a paragraph wrapped in the source is one paragraph on screen: ' + flow.intro.lines + ' source lines');
  t.assert(/Panel studies often find/.test(flow.intro.text) && /for our sample, Figure 1 shows/.test(flow.intro.text), 'its line breaks read as spaces');
  t.assert(flow.kept, 'and the source keeps its line breaks');

  // the table: both \input files drawn in place, panel headings, notes
  await t.scrollTo('\\begin{table}[t]', 'start');
  await t.sleep(300);
  const tables = await page.$$eval('.tv-tablewrap[data-input] .tv-table', (els) => els.map((e) => e.rows.length));
  t.assert(tables.length === 2 && tables.every((n) => n === 7), '\\input tables rendered in place: rows ' + tables.join(', '));
  t.assert((await text('.tv-table-inline')).join('|') === 'Panel A: Teenagers|Panel B: Young adults', 'one-cell tabulars render as panel headings');
  const visible = await page.$eval('.cm-content', (e) => e.innerText);
  for (const cmd of ['\\setlength', '\\vspace', '\\begin{tablenotes}', '\\end{tablenotes}', '\\par', '↳']) {
    t.assert(!visible.includes(cmd), `no ${cmd} left in the rendered table`);
  }
  t.assert(await page.$('.cm-line.tv-notes'), 'table notes set as a note paragraph');
  t.assert(!(await page.$('.cm-line.tv-notes .tv-bullet')), 'table notes carry no bullet');
  const labels = await text('.tv-caption-label');
  t.assert(labels.join(' ') === 'Table 1: Figure 1: Table A1:', 'captions numbered: ' + labels.join(' '));
  t.assert(await page.evaluate(() => [...document.querySelectorAll('.tv-table td')].every((td) => td.scrollWidth <= td.clientWidth + 1)), 'no table cell overflows');

  // the figure: two subfigures in one row, one figure number, unnumbered notes
  await t.scrollTo('\\begin{figure}[t]', 'start');
  await t.waitFor(async () => (await page.$$('.tv-subrow .tv-subcell img')).length === 2, 15000);
  const row = await page.$eval('.tv-subrow', (e) => {
    const r = [...e.querySelectorAll('.tv-subcell')].map((c) => c.getBoundingClientRect());
    return { n: r.length, sideBySide: r.length === 2 && r[1].left >= r[0].right - 1 && Math.abs(r[0].top - r[1].top) < 40 };
  }).catch(() => ({ n: 0 }));
  t.assert(row.n === 2 && row.sideBySide, 'subfigures drawn side by side');
  t.assert((await text('.tv-subcaption')).join('|') === '(a) Treated states|(b) Control states', 'sub-captions lettered');
  const figLabels = (await text('.tv-caption-label')).filter((l) => l.startsWith('Figure'));
  t.assert(figLabels.join() === 'Figure 1:', 'one figure number, none for \\caption*: ' + figLabels.join(' '));
  await t.shot('paper-floats');

  // references from the .bib file, cited entries only
  await t.scrollTo('\\bibliography{refs}', 'center');
  await t.sleep(300);
  const entries = await text('.tv-refs-entry');
  t.assert(entries.length === 4 && entries[0].startsWith('Card, David, and Alan B. Krueger. 1994.'), 'reference list from refs.bib, sorted: ' + entries.map((e) => e.slice(0, 10)).join(' | '));
  t.assert(!entries.some((e) => e.includes('Nobody')), 'uncited entries are left out');

  // appendix
  await t.scrollTo('\\appendix', 'start');
  await t.sleep(300);
  t.assert((await text('.tv-secnum')).includes('A'), 'appendix section lettered');
  t.assert((await text('.tv-caption-label')).includes('Table A1:'), 'appendix table numbered A1');
  t.assert((await page.$$eval('.tv-table', (els) => els.map((e) => e.textContent))).some((x) => x.includes('Teenagers') && !x.includes('2*')), '\\multirow shows its text only');

  // editing: the cursor on an \input line shows the command and keeps the table as a preview
  await page.focus('.cm-content');
  await t.goto('\\input{tables/teens.tex}', 3);
  await t.sleep(200);
  t.assert((await page.$eval('.cm-content', (e) => e.innerText)).includes('\\input{tables/teens.tex}') && await page.$('.tv-tablewrap.tv-preview .tv-table'), '\\input under the cursor: source plus preview');
  // completion: environments after \begin{
  await t.goto('\\section{Results}', 0);
  await page.keyboard.type('\\begin{thr', { delay: 15 });
  await t.sleep(400);
  const opts = await text('.cm-tooltip-autocomplete li');
  t.assert(opts.some((o) => o.startsWith('threeparttable')), 'environment completion: ' + opts.slice(0, 3).join(', '));
  await page.keyboard.press('Escape');

  // ---- tables are edited cell by cell
  const clickCell = async (text) => {
    const pt = await page.evaluate((text) => {
      const td = [...document.querySelectorAll('.tv-tablewrap.tv-editable td[data-c]')].find((x) => x.textContent.trim() === text);
      if (!td) return null;
      td.scrollIntoView({ block: 'center' });
      const r = td.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, text);
    if (!pt) throw new Error('no cell showing ' + text);
    await page.mouse.click(pt.x, pt.y);
    await t.sleep(150);
  };
  const editor = () => page.$eval('.tv-cell-input', (e) => e.value).catch(() => null);
  const hostText = async () => { await page.evaluate(() => window.__tv.flush()); await t.sleep(350); return page.evaluate(() => window.__host.text); };

  // a tabular written in the document: the edit lands in the document, Tab moves on
  await t.scrollTo('\\begin{table}[h]', 'start');
  await t.sleep(300);
  await clickCell('-0.041');
  t.assert(await editor() === '-0.041', 'clicking a cell opens it with its LaTeX source');
  await page.keyboard.type('$-0.999^{*}$');
  await page.keyboard.press('Tab');
  await t.sleep(250);
  let host = await hostText();
  t.assert(host.includes('\\multirow{2}{*}{Teenagers} & None & $-0.999^{*}$ \\\\'), 'the cell, and only the cell, changed in the document');
  t.assert(await editor() === '', 'Tab opened the next cell (an empty one)');
  await page.keyboard.type('Teens, again');
  await page.keyboard.press('Enter');
  await t.sleep(250);
  host = await hostText();
  t.assert(host.includes('\n Teens, again & Division trends & -0.036 \\\\'), 'text typed into an empty cell: ' + JSON.stringify(host.slice(host.indexOf('Teens, again') - 4, host.indexOf('Teens, again') + 46)));
  t.assert(await page.$('.tv-table .katex'), 'math typed into a cell renders');
  // Enter moved down a row; Ctrl/Cmd+Enter adds a row under it
  await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
  await t.sleep(250);
  await page.keyboard.type('New row');
  await page.keyboard.press('Escape');
  host = await hostText();
  t.assert(/Young adults\} & None & 0\.006 \\\\\n &  &  \\\\\n & Division trends & 0\.004/.test(host), 'Ctrl+Enter adds an empty row below; Escape discards what was typed');
  t.assert(await page.evaluate(() => window.__tv.view.state.doc.toString() === window.__host.text), 'editor and document in sync after table edits');

  // a table kept in its own file: the edit goes to that file, not to the document
  const before = await hostText();
  await t.scrollTo('\\begin{table}[t]', 'start');
  await t.sleep(300);
  await clickCell('-0.112**');
  t.assert(await editor() === '-0.112**', 'a cell of an \\input table opens the same way');
  await page.keyboard.type('-0.5');
  await page.keyboard.press('Enter');
  await t.sleep(400);
  const file = await page.evaluate(() => window.__EXT__.inputs['tables/teens.tex']);
  t.assert(file.includes('Log minimum wage & -0.5 & -0.041 & -0.058* \\\\') && !file.includes('-0.112'), 'the edit was written to tables/teens.tex');
  t.assert(await editor() === '(0.047)', 'Enter moved to the cell below');
  await page.keyboard.press('Escape');
  await t.sleep(200);
  const shown = await page.$$eval('.tv-tablewrap[data-input] td', (els) => els.map((e) => e.textContent));
  t.assert(shown.includes('-0.5') && !shown.includes('-0.112**'), 'the table shows the new value');
  t.assert(await hostText() === before, 'the document itself is untouched by an edit of an \\input table');
  await t.shot('paper-table-edit');

  await page.evaluate(() => window.__tv.flush());
  await t.sleep(300);
  t.assert(await page.evaluate(() => window.__tv.view.state.doc.toString() === window.__host.text), 'editor and document in sync');
}
