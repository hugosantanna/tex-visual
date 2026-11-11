// Random edits + cursor moves: the editor must never throw, and the host document must
// end up identical to the editor's text.
export default async function (t) {
  await t.page.focus('.cm-content');
  const res = await t.page.evaluate(async () => {
    const v = window.__tv.view;
    const frags = ['$', '$$', '\\begin{equation}\n', '\\end{equation}\n', '{', '}', '\\item ', '%', '\n', '\n\n', '\\[', '\\]', 'x^2',
      '\\section{', '\\emph{', '\\ref{eq:demand}', '\\begin{proof}', '\\end{proof}', '\\begin{enumerate}\n', '\\end{enumerate}\n', '~', '--', '\\\\',
      '\\begin{tabular}{ll}', '\\end{tabular}', '&', '\\label{a}', '\\cite{x}', '\\includegraphics{nope}', ' ', 'word', '\\begin{align}', '\\end{align}',
      '\\begin{document}', '\\end{document}', '\\maketitle', '\\footnote{', '[', ']', '\\(', '\\)', '\\begin{itemize}', '\\end{itemize}', '\\caption{'];
    let seed = 12345;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const errors = [];
    const times = [];
    let n = 0;
    for (let i = 0; i < 1500; i++) {
      const len = v.state.doc.length;
      const op = rnd(10);
      const t0 = performance.now();
      try {
        if (op < 4) { const at = rnd(len + 1); v.dispatch({ changes: { from: at, insert: frags[rnd(frags.length)] }, selection: { anchor: at }, userEvent: 'input' }); }
        else if (op < 6) { const a = rnd(len + 1), b = Math.min(len, a + rnd(40)); v.dispatch({ changes: { from: a, to: b }, selection: { anchor: a }, userEvent: 'delete' }); }
        else if (op < 9) { const a = rnd(len + 1); v.dispatch({ selection: { anchor: a, head: rnd(4) === 0 ? rnd(len + 1) : a } }); }
        else { window.__remote(Math.min(len, rnd(len + 1)), Math.min(len, rnd(len + 1)), ''); }
        n++;
      } catch (e) { errors.push(`${i} op${op}: ${e.message}`.slice(0, 200)); if (errors.length > 8) break; }
      times.push(performance.now() - t0);
      if (i % 50 === 0) await new Promise((r) => setTimeout(r, 30));
    }
    window.__tv.flush();
    await new Promise((r) => setTimeout(r, 1200));
    window.__tv.flush();
    await new Promise((r) => setTimeout(r, 600));
    times.sort((a, b) => a - b);
    return { n, errors, synced: window.__host.text === v.state.doc.toString(), hostLen: window.__host.text.length, docLen: v.state.doc.length,
      median: times[times.length >> 1].toFixed(2), p95: times[Math.floor(times.length * 0.95)].toFixed(2), max: times[times.length - 1].toFixed(1) };
  });
  console.log('fuzz', JSON.stringify(res));
  t.assert(res.errors.length === 0, 'no exceptions in ' + res.n + ' random operations');
  t.assert(res.synced, 'host document identical to editor text afterwards');
}
