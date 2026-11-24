#!/bin/bash
# End-to-end test: launches a throwaway VS Code instance with the extension loaded and checks
# that the visual editor and the text document stay in sync (typing, undo, external edits).
#
#   test/e2e/run.sh [file.tex]        default: examples/demo.tex (works on a copy)
#
# macOS only as written; set VSCODE_APP to a different VS Code executable if needed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FILE="${1:-$ROOT/examples/demo.tex}"
SRC="$(cd "$(dirname "$FILE")" && pwd)"; NAME="$(basename "$FILE")"
APP="${VSCODE_APP:-/Applications/Visual Studio Code.app/Contents/MacOS/Electron}"
# VS Code's IPC socket lives under the user-data dir and its path must stay under ~100 chars.
W="$ROOT/.e2e"
rm -rf "$W"; mkdir -p "$W/work" "$W/ud/User" "$W/ext"
# LaTeX Workshop is not installed in the test instance; its settings are, with a recipe that only
# leaves a file behind, so the test can tell that a save from the visual editor ran it.
cat > "$W/ud/User/settings.json" <<'JSON'
{
  "latex-workshop.latex.autoBuild.run": "onSave",
  "latex-workshop.latex.recipes": [{ "name": "stand-in", "tools": ["mark"] }],
  "latex-workshop.latex.tools": [{ "name": "mark", "command": "/bin/sh", "args": ["-c", "echo %DOCFILE% > '%OUTDIR%/tv-built.txt'"] }]
}
JSON
cp "$SRC/$NAME" "$W/work/"; [ -d "$SRC/figures" ] && cp -R "$SRC/figures" "$W/work/"
# When launched from a VS Code terminal, drop its environment so the test instance starts clean.
for v in $(env | grep -oE '^(VSCODE|ELECTRON)_[A-Z_]+'); do unset "$v"; done
export TV_E2E_FILE="$W/work/$NAME" TV_E2E_OUT="$W/result.json"
"$APP" --user-data-dir="$W/ud" --extensions-dir="$W/ext" \
  --extensionDevelopmentPath="$ROOT" --extensionTestsPath="$ROOT/test/e2e/index.js" \
  --disable-workspace-trust --skip-welcome --skip-release-notes --disable-updates \
  "$W/work" > "$W/stdout.log" 2>&1
CODE=$?
if [ -f "$W/result.json" ]; then
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (r.fatal) console.log("fatal: " + r.fatal);
    for (const c of r.results) console.log((c.ok ? "ok   " : "FAIL ") + c.name + (c.ok ? "" : "  " + JSON.stringify(c.detail)));
    console.log(r.results.filter((c) => c.ok).length + "/" + r.results.length + " passed");
  ' "$W/result.json"
else
  echo "no result file; last lines of the VS Code log:"; tail -20 "$W/stdout.log"
fi
rm -rf "$W"
exit $CODE
