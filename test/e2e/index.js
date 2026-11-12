// Runs inside a throwaway VS Code instance (see run.sh). Exercises the custom editor end to end.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbg = (payload) => vscode.commands.executeCommand('texVisual._debug', payload);

async function run() {
  const out = process.env.TV_E2E_OUT;
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };
  let fatal = null;
  try {
    const file = process.env.TV_E2E_FILE;
    const uri = vscode.Uri.file(file);
    const original = fs.readFileSync(file, 'utf8');
    const pkg = require('../../package.json');
    const ext = vscode.extensions.getExtension(`${pkg.publisher}.${pkg.name}`);
    check('extension found', !!ext);
    await ext.activate();
    await vscode.commands.executeCommand('vscode.openWith', uri, 'texVisual.editor');
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
    check('document opened', !!doc);

    let st = null;
    for (let i = 0; i < 60 && !(st && st.math > 0); i++) { await sleep(500); st = await dbg({ op: 'state' }); }
    check('webview ready and math rendered', st && st.math > 0, st && { math: st.math, katex: st.katex, mathErrors: st.mathErrors, fonts: st.fontsLoaded, errors: st.errors });
    check('KaTeX fonts loaded', st && st.fontsLoaded > 0, st && st.fontsLoaded);
    check('no script errors', st && st.errors.length === 0, st && st.errors);
    check('webview text equals document', st && st.text === doc.getText());

    // figure (PDF through pdf.js inside the real webview sandbox)
    const figAt = original.indexOf('\\includegraphics');
    if (figAt >= 0) {
      const near = original.lastIndexOf('\n\n', figAt);
      await dbg({ op: 'select', at: near });
      let fs2 = null;
      for (let i = 0; i < 30; i++) { await sleep(500); fs2 = await dbg({ op: 'state' }); if (fs2 && (fs2.figures > 0 || fs2.figureErrors.length)) break; }
      check('PDF figure rendered', fs2 && fs2.figures > 0, fs2 && { figures: fs2.figures, figureErrors: fs2.figureErrors, stats: fs2.figureStats, errors: fs2.errors });
    }

    // typing in the visual editor reaches the document
    const at = original.indexOf('There are $n');
    st = await dbg({ op: 'type', at, text: 'ZZZ ', flush: true, wait: 400 });
    check('typed text reaches document', doc.getText().slice(at, at + 4) === 'ZZZ ' && doc.getText().length === original.length + 4);
    check('document is dirty after edit', doc.isDirty);
    check('webview in sync after typing', st && !st.pending && st.text === doc.getText());

    // undo goes through VS Code's undo stack and comes back to the webview
    await vscode.commands.executeCommand('undo');
    await sleep(400);
    st = await dbg({ op: 'state' });
    check('undo restores document', doc.getText() === original, { len: doc.getText().length, want: original.length });
    check('webview follows undo', st && st.text === original);
    await vscode.commands.executeCommand('redo');
    await sleep(400);
    st = await dbg({ op: 'state' });
    check('redo reapplies', doc.getText().slice(at, at + 4) === 'ZZZ ' && st && st.text === doc.getText());
    await vscode.commands.executeCommand('undo');
    await sleep(300);

    // an edit made elsewhere (text editor, Claude, git) shows up in the visual editor
    const e1 = new vscode.WorkspaceEdit();
    e1.insert(uri, doc.positionAt(at), 'REMOTE ');
    await vscode.workspace.applyEdit(e1);
    await sleep(400);
    st = await dbg({ op: 'state' });
    check('remote edit reaches webview', st && st.text === doc.getText() && st.text.includes('REMOTE There are $n'));

    // concurrent: unsent local typing + a remote edit elsewhere; both must land exactly once
    const tailAt = doc.getText().indexOf('\\section{What to try in the editor}');
    dbg({ op: 'type', at: tailAt, text: 'LOCAL' }); // not flushed: sits in the 250 ms batch window
    await sleep(30);
    const e2 = new vscode.WorkspaceEdit();
    e2.insert(uri, doc.positionAt(10), 'XY');
    await vscode.workspace.applyEdit(e2);
    await sleep(1500);
    st = await dbg({ op: 'state' });
    const t = doc.getText();
    const count = (s, n) => s.split(n).length - 1;
    check('concurrent edits merge exactly once', count(t, 'LOCAL') === 1 && count(t, 'XY') >= 1 && t.slice(10, 12) === 'XY' && t.includes('LOCAL\\section{What to try in the editor}'),
      { local: count(t, 'LOCAL'), at10: t.slice(10, 12) });
    check('webview in sync after concurrent edits', st && !st.pending && st.text === t);

    // rapid typing: many small edits in a row, then compare
    const base = doc.getText().indexOf('LOCAL') + 5;
    for (let i = 0; i < 25; i++) { dbg({ op: 'type', text: String(i % 10), at: base + i }); await sleep(15); }
    await sleep(1200);
    st = await dbg({ op: 'state' });
    check('rapid typing arrives intact', doc.getText().includes('LOCAL0123456789012345678901234\\section'), doc.getText().slice(base - 5, base + 40));
    check('webview in sync after rapid typing', st && !st.pending && st.text === doc.getText());

    // source-mode toggle
    await vscode.commands.executeCommand('texVisual.toggleSource');
    await sleep(300);
    st = await dbg({ op: 'state' });
    check('source mode hides widgets', st && st.source === true && st.math === 0);
    await vscode.commands.executeCommand('texVisual.toggleSource');

    // revert: file on disk must be untouched by all of the above
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await sleep(500);
    st = await dbg({ op: 'state' });
    check('revert restores original', doc.getText() === original && !doc.isDirty);
    check('webview follows revert', st && st.text === original);
    check('file on disk unchanged', fs.readFileSync(file, 'utf8') === original);

    // a sub-file gets macros from its root's preamble, labels from the .aux, citations from the .bib
    const dir = path.dirname(file);
    fs.writeFileSync(path.join(dir, 'root.tex'), '\\documentclass{article}\n\\newcommand{\\foo}{\\alpha^{2}}\n\\begin{document}\n\\input{sub}\n\\bibliography{refs}\n\\end{document}\n');
    fs.writeFileSync(path.join(dir, 'root.aux'), '\\relax\n\\newlabel{eq:elsewhere}{{7}{1}{}{equation.7}{}}\n');
    fs.writeFileSync(path.join(dir, 'refs.bib'), '@book{knuth1984,\n  author = {Knuth, Donald E.},\n  title = {The {\\TeX}book},\n  year = 1984\n}\n@article{ab2020, author = "Ann Able and Bo von Baker and Cy Chan", year = {2020}}\n');
    const sub = path.join(dir, 'sub.tex');
    fs.writeFileSync(sub, 'A formula $\\foo + 1$, a reference \\eqref{eq:elsewhere}, and \\citet{knuth1984} with \\citep{ab2020}.\n');
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(sub), 'texVisual.editor');
    let ss = null;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      ss = await dbg({ op: 'state' });
      if (ss && ss.text.startsWith('A formula') && ss.math === 1 && ss.mathErrors === 0 && ss.refs[0] === '(7)' && ss.cites.length === 2 && !ss.cites.includes('knuth1984')) break;
    }
    check('sub-file: macro from the root preamble', ss && ss.math === 1 && ss.mathErrors === 0, ss && { math: ss.math, mathErrors: ss.mathErrors });
    check('sub-file: label resolved from .aux', ss && ss.refs[0] === '(7)', ss && ss.refs);
    check('sub-file: citations resolved from .bib', ss && ss.cites[0] === 'Knuth (1984)' && ss.cites[1] === '(Able et al., 2020)', ss && ss.cites);

    // a table kept in its own file is drawn in place, numbered, and redrawn when the file changes;
    // \\bibliography lists the cited entries
    fs.mkdirSync(path.join(dir, 'tables'), { recursive: true });
    const tbl = path.join(dir, 'tables', 'one.tex');
    fs.writeFileSync(tbl, '\\begin{tabular}{lc}\n\\toprule\nA & B \\\\\n\\midrule\n1 & 2 \\\\\n\\bottomrule\n\\end{tabular}\n');
    const host = path.join(dir, 'host.tex');
    fs.writeFileSync(host, '\\documentclass{article}\n\\begin{document}\nSee \\citet{knuth1984}.\n\\appendix\n\\renewcommand{\\thetable}{A\\arabic{table}}\n\\begin{table}\n\\caption{One}\n\\input{tables/one}\n\\end{table}\n\n\\bibliography{refs}\n\\end{document}\n');
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(host), 'texVisual.editor');
    let hs = null;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      hs = await dbg({ op: 'state' });
      if (hs && hs.text.startsWith('\\documentclass') && hs.text.includes('tables/one') && hs.inputTables === 1 && hs.references === 1) break;
    }
    check('\\input table drawn in place', hs && hs.inputTables === 1, hs && { inputTables: hs.inputTables, errors: hs.errors });
    check('caption follows \\appendix and \\thetable', hs && hs.captions[0] === 'Table A1:', hs && hs.captions);
    check('reference list from the .bib file', hs && hs.references === 1, hs && hs.references);
    fs.writeFileSync(tbl, '\\begin{tabular}{lc}\nA & B \\\\\n1 & 2 \\\\\n3 & 4 \\\\\n\\end{tabular}\n');
    let rows = 0;
    for (let i = 0; i < 30 && rows !== 3; i++) {
      await sleep(400);
      rows = (await vscode.commands.executeCommand('texVisual._debug', { op: 'state' }) || {}).inputRows || 0;
    }
    check('table redrawn when its file changes on disk', rows === 3, rows);
  } catch (e) {
    fatal = String(e && e.stack || e);
  }
  fs.writeFileSync(out, JSON.stringify({ fatal, results }, null, 2));
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  if (fatal || results.some((r) => !r.ok)) throw new Error('e2e failed');
}

module.exports = { run };
