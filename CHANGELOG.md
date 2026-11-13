# Changelog

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
