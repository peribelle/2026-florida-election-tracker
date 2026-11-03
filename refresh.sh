#!/usr/bin/env bash
# Refresh the Florida turnout workbook from the live county feeds.
# Every run is archived immutably under runs/<timestamp>/ and logged in runs/INDEX.csv.
#
# Usage: ./refresh.sh
set -euo pipefail

cd "$(dirname "$0")"

PY=".venv/bin/python"
if [ ! -x "$PY" ]; then
  echo ">> creating virtualenv"
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet requests beautifulsoup4 lxml openpyxl xlsxwriter matplotlib
fi

step() { printf '\n\033[1;34m>> %s\033[0m\n' "$1"; }

step "1/9 collecting 67 shared county feeds"
$PY collect.py | tail -3

step "2/9 collecting Broward (own dashboard)"
$PY collect_broward.py

step "3/9 normalizing (merges Broward)"
$PY normalize.py

step "4/9 parsing Broward PDF (fallback check)"
$PY parse_broward.py | head -2 || true

step "5/9 building workbook"
$PY build_workbook.py

step "6/9 writing county/site lists"
$PY write_lists.py

step "7/9 rendering chart preview"
$PY make_preview.py

step "8/9 reporting change"
$PY report_delta.py

step "9/9 archiving this run"
$PY archive.py

# Extra, after the archive and guarded: a viewer problem must never fail a refresh.
step "viewer: building Reports/viewer.html"
$PY build_viewer.py || echo "!! viewer build failed; the workbook and the archive above are unaffected"

step "done"
