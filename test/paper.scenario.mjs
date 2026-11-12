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

  const cites = await text('.tv-cite');
  t.assert(cites.includes('Card and Krueger (1994)') && cites.includes('(Neumark and Wascher, 2008)'), 'citations resolved from refs.bib: ' + cites.join(' · '));
  const refs = await text('.tv-ref');
  t.assert(refs.includes('Table 1') && refs.includes('Figure 1') && refs.includes('Table A1'), '\\cref uses \\crefname and the appendix number: ' + refs.join(' · '));

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
  await page.evaluate(() => window.__tv.flush());
  await t.sleep(300);
  t.assert(await page.evaluate(() => window.__tv.view.state.doc.toString() === window.__host.text), 'editor and document in sync');
}
