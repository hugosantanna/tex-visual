# The release notes of one version: its section of CHANGELOG.md, each paragraph and list item on
# one line. GitHub draws a line break for every line break in release notes, so text wrapped at
# a fixed width in the changelog would come out ragged there.
#
#   awk -v v=0.3.1 -f scripts/release-notes.awk CHANGELOG.md
function flush() { if (have) print buf; have = 0 }
$0 == "## " v { on = 1; next }
/^## / { on = 0 }
!on { next }
/^```/ { flush(); print; fence = !fence; next }
fence { print; next }
/^[ \t]*$/ { flush(); print; next }
!have || /^[ \t]*([-*+]|[0-9]+[.)])[ \t]/ || /^[#>|]/ { flush(); buf = $0; have = 1; next }
{ sub(/^[ \t]+/, ""); buf = buf " " $0 }
END { flush() }
