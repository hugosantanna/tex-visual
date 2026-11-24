# Changelog

## 0.3.1

- Saving from the visual editor compiles again. LaTeX Workshop builds only while a text editor is
  the active editor, so with the visual editor in front a save compiled nothing. TeX Visual now
  runs the LaTeX Workshop recipe itself in that case, and `Cmd+Alt+B` compiles on demand. The
  tools' output goes to the *TeX Visual* output channel. `texVisual.buildOnSave` turns it off.
- Fixed: folding the preamble again from its chip left the cursor on `\maketitle`, which replaced
  the title block by that command until you clicked elsewhere. Folding now leaves nothing open.
- With the cursor on `\maketitle` the title block stays, drawn under the command, so the title is
  always there to click.
- Colored text is colored. `\textcolor{…}{…}`, `{\color{…} …}`, `\hl{…}` (with `\sethlcolor`) and
  `\colorbox{…}{…}` show their color in text, table cells, captions and math, and so does a macro
  of your own that colors its argument, such as `\newcommand{\edit}[1]{\textcolor{red}{#1}}`.
  Colors are xcolor's names (with `dvipsnames` and `svgnames`), the ones the document sets with
  `\definecolor` and `\colorlet`, and mixes like `red!60!black`. On a dark theme a color keeps its
  hue but is lightened enough to read.
- `\sout{…}` and soul's `\st{…}` are struck through, also inside a macro of your own such as
  `\newcommand{\cut}[1]{\textcolor{red}{\sout{#1}}}`.
- Paragraphs look the same however their source is wrapped. A paragraph written on one long line
  filled the page, while one wrapped at 80 columns or written a sentence per line broke wherever
  the source did. Now a single line break inside a paragraph is drawn as the space TeX makes of
  it, in text, list items, captions, notes, theorems and `thebibliography` entries, and a blank
  line starts a new paragraph. The file is not touched: its line breaks stay where they are, and
  the `</>` button shows them. `\\`, `\item`, headings, displays, tables, comments, lines that
  hold only commands and environments the editor does not know keep their lines.
- The text of a theorem runs on after a `\label` written on the line below its `\begin`, as it
  already did after one written on the same line.
- `\newblock` in a `thebibliography` entry is hidden.

## 0.3.0

- Tables are editable where they are drawn. Click a cell to edit its LaTeX; `Tab`, `Shift+Tab`,
  `Enter` and the arrow keys move between cells, `Cmd+Enter` adds a row. A cell of a table that
  lives in another file (`\input{tables/…}`) is changed in that file.
- A file the document `\input`s is redrawn while it is being edited in another tab, before it is
  saved.
- Fixed: a click on the title block showed `\maketitle`. A click on the title, the authors, the
  date or a `\thanks` note now puts the cursor in `\title{…}`, `\author{…}` or `\date{…}`, and
  shows that command alone while the rest of the preamble stays folded.

## 0.2.0

Brings in what [Basil](https://github.com/hugosantanna/basil) did for applied papers, and makes
the numbering follow real documents.

- Tables kept in their own files are drawn in place of `\input{…}`, and redrawn when the file
  changes on disk. A `tabular` that shares its line with other material (a panel heading) renders
  too. `\multirow`, `\makecell`, `\resizebox{…}{…}{…}` and `\parbox` show their content.
- `threeparttable` notes, `\caption*` notes and long captions are set as note paragraphs;
  subfigures are drawn side by side with lettered captions.
- `\bibliography{…}` / `\printbibliography` show the cited entries of the `.bib` files.
- The title block picks up `\title`, `\author` and `\date` placed after `\begin{document}`, and
  lists `\thanks` notes under it.
- Numbering follows `\appendix`, `\begin{appendices}`, `\setcounter`, `\addtocounter`,
  `\numberwithin`, `\renewcommand{\the…}{…}`, `\captionof`, theorem environments numbered by hand,
  and continues through `\input` files. `\cref` uses `\crefname`.
- Layout commands with arguments (`\vspace{…}`, `\setlength{…}{…}`, `\captionsetup{…}`, …) are
  hidden like `\centering` already was, and a line that shows nothing takes no room.
- Macros of the document's own used in running text show their value.
- Completion for environments, common commands and the document's macros.
- Fixed: `\caption*` took a figure number; a `\label` after `\caption` inside `threeparttable`
  resolved to the section; a label inside an environment kept the number of an earlier section;
  wide tables broke numbers across lines; a commented-out `\nonumber` suppressed an equation number.

## 0.1.0

First release.

- Visual editor for `.tex` files: math (KaTeX), sections, text styles, theorem environments,
  lists, `tabular`, figures (PDF and raster), cross-references and citations render in place.
- Live preview while editing a formula; source is shown only around the cursor.
- Two-way sync with the VS Code document, including undo/redo and external edits.
- Side-by-side mode with scroll sync, raw-source toggle, `\ref{` / `\cite{` completion.
