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

# Broward is collected on its own, in parallel with the other 66 counties and entirely separately from them: its own process and its own
# time limit. It is a different site that fails on its own (election morning: "No dashboard loaded"), and whatever it does (404, hang,
# garbage) cannot slow, fail or alter any other county: step 1 never waits on it, and step 3 reads whatever it left behind inside a guard.
# On failure the collector keeps Broward's last complete numbers and flags them in data/broward/status.json (the archive note and the
# validators raise it); blend_broward.py then fills in Broward's Election Day count from the state's page. See AGENTS.md section 9.
bro_log=$(mktemp)
trap 'rm -f "$bro_log"' EXIT
# (set -e is inherited by a subshell: each command needs its own || so the blend still runs after a failed collection.)
( timeout 75 $PY collect_broward.py || echo "!! Broward's collector failed (exit $?)"
  timeout 45 $PY blend_broward.py || echo "!! Broward's blend failed (exit $?)" ) > "$bro_log" 2>&1 &
bro_pid=$!

step "1/9 collecting 67 shared county feeds"
$PY collect.py | tail -3

step "2/9 Broward (own dashboard, collected in parallel and separately)"
wait "$bro_pid" || true
cat "$bro_log"

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

# Validate and publish: validate.py checks this run for failed sources and abnormal numbers, publish.py commits it and
# pushes the site. Each hands off to a detached worker and returns at once, so neither can delay or fail a refresh.
# NO_VALIDATE=1 / NO_PUBLISH=1 skip them.
step "validate + publish: asking for the checks and the GitHub update"
$PY after_pull.py || echo "!! after_pull failed; the refresh above is unaffected"

step "done"
