// Renders examples/demo.tex in headless Chrome and checks what a reader would see.
export default async function (t) {
  const { page } = t;
  let s = await t.state();
  t.assert(s.math > 5 && s.mathErrors === 0, `math rendered without KaTeX errors (${s.math} formulas in view)`);
  t.assert(s.fontsLoaded > 0, 'KaTeX fonts loaded');
  t.assert(s.errors.length === 0, 'no script errors ' + s.errors.join('; '));
  t.assert(await page.$eval('.tv-title', (e) => e.textContent).catch(() => '') === 'Cournot Competition in One Page', 'title block rendered from the preamble');
  t.assert(await page.$('.tv-preamble'), 'preamble collapsed');
  t.assert((await page.$$eval('.tv-secnum', (els) => els.map((e) => e.textContent)))[0] === '1', 'section numbered');
  const cites = await page.$$eval('.tv-cite', (els) => els.map((e) => e.textContent));
  t.assert(cites.includes('Cournot (1838)') && cites.includes('Tirole (1988)'), 'citations resolved from \\bibitem: ' + cites.join(', '));

  await t.scrollTo('\\begin{proof}\nSumming', 'center');
  await t.sleep(200);
  const refs = await page.$$eval('.tv-ref', (els) => els.map((e) => e.textContent));
  t.assert(['(1)', '(2)', '(5)', '(6)'].every((r) => refs.includes(r)), 'equation references show live numbers: ' + refs.join(' '));
  // KaTeX puts all the tags of one align into a single element
  const tags = (await page.$$eval('.tv-display .tag', (els) => els.map((e) => e.textContent).join(' '))).replace(/[^()\d ]/g, '');
  t.assert(tags.includes('(4)(5)(6)'), 'align rows numbered: ' + tags);
  const heads = await page.$$eval('.tv-thm-head', (els) => els.map((e) => e.textContent.trim()));
  t.assert(heads.some((h) => h.startsWith('Proposition 1')) && heads.some((h) => h.startsWith('Proof')), 'theorem and proof headings: ' + heads.join(' | '));
  t.assert((await page.$$('.tv-bullet')).length >= 3, 'list items have bullets');

  await t.scrollTo('\\begin{table}', 'center');
  t.assert((await page.$$eval('.tv-table tr', (r) => r.length).catch(() => 0)) === 6, 'tabular rendered as a 6-row table');
  const fig = await t.waitFor(async () => (await t.state()).figures > 0, 15000);
  s = await t.state();
  t.assert(fig, 'PDF figure rendered ' + JSON.stringify(s.figureErrors));
  t.assert((await page.$eval('.tv-caption-label', (e) => e.textContent).catch(() => '')).startsWith('Table 1'), 'caption labelled');

  // editing: cursor inside a display equation shows its source plus a live preview
  await page.focus('.cm-content');
  await t.goto('\\BR(Q_{-i}) = \\max', 3);
  await t.sleep(150);
  t.assert((await page.$$('.tv-src-line')).length === 3 && await page.$('.tv-preview .katex'), 'display math under the cursor shows source and preview');

  // typing a new formula goes to the host document exactly as typed
  await t.goto('This is the model of', 0);
  await page.keyboard.type('Let $x^{2}$ be. ', { delay: 4 });
  await page.evaluate(() => window.__tv.flush());
  await t.sleep(400);
  s = await t.state();
  const host = await page.evaluate(() => window.__host.text);
  t.assert(host.includes('Let $x^{2}$ be. This is the model of'), 'typed text (with auto-closed $ and braces) reached the document');
  t.assert(!s.pending && host.length === s.textLen, 'editor and document in sync');

  // an external change is merged in
  await page.evaluate(() => window.__remote(0, 0, '% edited elsewhere\n'));
  await t.sleep(300);
  t.assert(await page.evaluate(() => window.__tv.view.state.doc.toString() === window.__host.text), 'external edit merged');
}
