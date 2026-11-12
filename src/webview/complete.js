// Completion inside the visual editor: labels after \ref{, keys after \cite{, environment
// names after \begin{, and the common commands after a backslash.
import { snippetCompletion } from '@codemirror/autocomplete';
import { parseField, externalField } from './decorate.js';

const ENVS = [
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'cases', 'matrix',
  'pmatrix', 'bmatrix', 'figure', 'table', 'tabular', 'threeparttable', 'tablenotes', 'subfigure',
  'itemize', 'enumerate', 'description', 'abstract', 'theorem', 'lemma', 'proposition',
  'corollary', 'definition', 'remark', 'example', 'proof', 'assumption', 'center', 'quote',
  'minipage', 'landscape', 'titlepage', 'verbatim', 'tikzpicture',
];

// [command, snippet tail, detail]: "#" marks a field to fill in.
const COMMANDS = [
  ['section', '{#}', 'heading'], ['subsection', '{#}', 'heading'], ['subsubsection', '{#}', 'heading'],
  ['paragraph', '{#}', 'heading'],
  ['textbf', '{#}', 'bold'], ['textit', '{#}', 'italic'], ['emph', '{#}', 'emphasis'],
  ['underline', '{#}', 'underline'], ['texttt', '{#}', 'monospace'], ['textsc', '{#}', 'small caps'],
  ['footnote', '{#}', 'footnote'], ['label', '{#}', 'label'], ['caption', '{#}', 'caption'],
  ['cite', '{#}', 'citation'], ['citet', '{#}', 'Author (year)'], ['citep', '{#}', '(Author, year)'],
  ['citeauthor', '{#}', 'Author'], ['citeyear', '{#}', 'year'], ['textcite', '{#}', 'Author (year)'],
  ['parencite', '{#}', '(Author, year)'],
  ['ref', '{#}', 'reference'], ['eqref', '{#}', '(equation)'], ['cref', '{#}', 'clever reference'],
  ['Cref', '{#}', 'clever reference'], ['autoref', '{#}', 'reference'],
  ['begin', '{#}', 'environment'], ['item', ' ', 'list item'], ['input', '{#}', 'file'],
  ['includegraphics', '[width=#]{#}', 'figure'], ['bibliography', '{#}', 'references'],
  ['printbibliography', '', 'references'], ['maketitle', '', ''], ['appendix', '', ''],
  ['centering', '', ''], ['clearpage', '', ''], ['newpage', '', ''], ['noindent', '', ''],
  ['toprule', '', 'booktabs'], ['midrule', '', 'booktabs'], ['bottomrule', '', 'booktabs'],
  ['multicolumn', '{#}{#}{#}', 'table cell'], ['multirow', '{#}{*}{#}', 'table cell'],
  ['frac', '{#}{#}', 'fraction'], ['dfrac', '{#}{#}', 'fraction'], ['sqrt', '{#}', 'root'],
  ['sum', '_{#}^{#}', 'sum'], ['prod', '_{#}^{#}', 'product'], ['int', '_{#}^{#}', 'integral'],
  ['lim', '_{#}', 'limit'], ['max', '', ''], ['min', '', ''], ['sup', '', ''], ['inf', '', ''],
  ['left', '', ''], ['right', '', ''], ['hat', '{#}', ''], ['bar', '{#}', ''], ['tilde', '{#}', ''],
  ['vec', '{#}', ''], ['dot', '{#}', ''], ['widehat', '{#}', ''], ['widetilde', '{#}', ''],
  ['overline', '{#}', ''], ['underbrace', '{#}_{#}', ''], ['overbrace', '{#}^{#}', ''],
  ['mathbb', '{#}', ''], ['mathbf', '{#}', ''], ['mathcal', '{#}', ''], ['mathrm', '{#}', ''],
  ['text', '{#}', 'text in math'], ['operatorname', '{#}', ''], ['partial', '', '∂'], ['nabla', '', '∇'],
  ['infty', '', '∞'], ['forall', '', '∀'], ['exists', '', '∃'], ['implies', '', '⟹'], ['iff', '', '⟺'],
  ['quad', '', ''], ['qquad', '', ''], ['cdot', '', '·'], ['cdots', '', '⋯'], ['ldots', '', '…'],
  ['times', '', '×'], ['leq', '', '≤'], ['geq', '', '≥'], ['neq', '', '≠'], ['approx', '', '≈'],
  ['sim', '', '∼'], ['equiv', '', '≡'], ['subset', '', '⊂'], ['subseteq', '', '⊆'], ['in', '', '∈'],
  ['notin', '', '∉'], ['cap', '', '∩'], ['cup', '', '∪'], ['to', '', '→'], ['rightarrow', '', '→'],
  ['leftarrow', '', '←'], ['Rightarrow', '', '⇒'], ['Leftarrow', '', '⇐'], ['mapsto', '', '↦'],
  ['alpha', '', 'α'], ['beta', '', 'β'], ['gamma', '', 'γ'], ['Gamma', '', 'Γ'], ['delta', '', 'δ'],
  ['Delta', '', 'Δ'], ['epsilon', '', 'ϵ'], ['varepsilon', '', 'ε'], ['zeta', '', 'ζ'], ['eta', '', 'η'],
  ['theta', '', 'θ'], ['Theta', '', 'Θ'], ['iota', '', 'ι'], ['kappa', '', 'κ'], ['lambda', '', 'λ'],
  ['Lambda', '', 'Λ'], ['mu', '', 'μ'], ['nu', '', 'ν'], ['xi', '', 'ξ'], ['pi', '', 'π'], ['Pi', '', 'Π'],
  ['rho', '', 'ρ'], ['sigma', '', 'σ'], ['Sigma', '', 'Σ'], ['tau', '', 'τ'], ['upsilon', '', 'υ'],
  ['phi', '', 'ϕ'], ['varphi', '', 'φ'], ['Phi', '', 'Φ'], ['chi', '', 'χ'], ['psi', '', 'ψ'],
  ['Psi', '', 'Ψ'], ['omega', '', 'ω'], ['Omega', '', 'Ω'],
  ['usepackage', '{#}', 'preamble'], ['newcommand', '{\\#}{#}', 'preamble'], ['renewcommand', '{\\#}{#}', 'preamble'],
];
const PACKAGES = [
  'amsmath', 'amssymb', 'amsthm', 'mathtools', 'graphicx', 'booktabs', 'threeparttable', 'multirow',
  'subcaption', 'caption', 'natbib', 'biblatex', 'hyperref', 'cleveref', 'geometry', 'setspace',
  'enumitem', 'xcolor', 'tikz', 'rotating', 'pdflscape', 'longtable', 'tabularx', 'siunitx',
  'microtype', 'fontspec', 'babel', 'inputenc', 'fontenc', 'float', 'placeins', 'appendix',
];
const CLASSES = ['article', 'report', 'book', 'beamer', 'standalone', 'memoir', 'scrartcl', 'IEEEtran'];

const plain = (labels, type) => labels.map((label) => ({ label, type }));
const commandOptions = COMMANDS.map(([name, tail, detail]) => {
  const label = '\\' + name;
  if (!tail.includes('#')) return { label, apply: label + tail, detail, type: 'keyword' };
  let n = 0;
  return snippetCompletion(label.replace(/\\/g, '\\\\') + tail.replace(/\\/g, '\\\\').replace(/#/g, () => '${' + (++n) + '}'), { label, detail, type: 'keyword' });
});

export function texComplete(context) {
  const st = context.state;
  let m = context.matchBefore(/\\(?:eq|c|C|auto|page|name|v)?ref\{[^{}]*$/);
  if (m) {
    const { num } = st.field(parseField);
    const aux = st.field(externalField).aux;
    const seen = new Set();
    const options = [];
    for (const [k, v] of num.labels) { seen.add(k); options.push({ label: k, detail: v.text != null ? `${v.name || ''} ${v.text}`.trim() : '', type: 'variable' }); }
    for (const k in aux) if (!seen.has(k)) options.push({ label: k, detail: String(aux[k]), type: 'variable' });
    const from = Math.max(m.text.lastIndexOf('{'), m.text.lastIndexOf(',')) + 1 + m.from;
    return { from, options, validFor: /^[^{},]*$/ };
  }
  m = context.matchBefore(/\\[cC]ite[a-zA-Z]*\*?(?:\[[^\]]*\]){0,2}\{[^{}]*$|\\(?:text|paren|foot|auto)cite\*?(?:\[[^\]]*\]){0,2}\{[^{}]*$/);
  if (m) {
    const { num } = st.field(parseField);
    const bib = st.field(externalField).bib;
    const options = [];
    const seen = new Set();
    for (const k in bib) { seen.add(k); options.push({ label: k, detail: `${bib[k].a} ${bib[k].y}`.replace(/[{}\\~]/g, ' '), type: 'text' }); }
    for (const [k, v] of num.bibitems) if (!seen.has(k)) options.push({ label: k, detail: v || '', type: 'text' });
    const from = Math.max(m.text.lastIndexOf('{'), m.text.lastIndexOf(',')) + 1 + m.from;
    return { from, options, validFor: /^[^{},]*$/ };
  }
  m = context.matchBefore(/\\(?:begin|end)\{[a-zA-Z*]*$/);
  if (m) {
    // the document's own environments (theorem names from the preamble) come first
    const { sc } = st.field(parseField);
    const names = [...new Set([...Object.keys(sc.meta.theorems), ...ENVS])];
    return { from: m.from + m.text.indexOf('{') + 1, options: plain(names, 'type'), validFor: /^[a-zA-Z*]*$/ };
  }
  m = context.matchBefore(/\\usepackage(?:\[[^\]]*\])?\{[^{}]*$/);
  if (m) return { from: Math.max(m.text.lastIndexOf('{'), m.text.lastIndexOf(',')) + 1 + m.from, options: plain(PACKAGES, 'namespace'), validFor: /^[\w-]*$/ };
  m = context.matchBefore(/\\documentclass(?:\[[^\]]*\])?\{[^{}]*$/);
  if (m) return { from: m.from + m.text.lastIndexOf('{') + 1, options: plain(CLASSES, 'namespace'), validFor: /^[\w-]*$/ };
  // commands: once two letters are typed, or on request (Ctrl-Space)
  m = context.matchBefore(/\\[a-zA-Z]*$/);
  if (m && (context.explicit || m.text.length >= 3)) {
    const { sc } = st.field(parseField);
    const own = sc.meta.defs.filter((d) => /^\\[a-zA-Z]+$/.test(d.name)).map((d) => ({ label: d.name, detail: 'macro', type: 'function' }));
    return { from: m.from, options: [...own, ...commandOptions], validFor: /^\\[a-zA-Z]*$/ };
  }
  return null;
}
