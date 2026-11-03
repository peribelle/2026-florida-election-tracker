#!/usr/bin/env bash
# Publish the newest viewer to GitHub Pages.
#
# Pages serves docs/ from main, and docs/index.html is a copy of Reports/viewer.html. This copies it,
# commits only that file and pushes. It never stages anything else and never touches runs/, results/
# or projections/, so it is safe to run while election_day.sh is running.
set -euo pipefail
cd "$(dirname "$0")"

SRC=Reports/viewer.html
DEST=docs/index.html

[ -f "$SRC" ] || { echo "no $SRC yet; run .venv/bin/python build_viewer.py first" >&2; exit 1; }

mkdir -p docs
if [ -f "$DEST" ] && cmp -s "$SRC" "$DEST"; then
    echo "$DEST already matches $SRC; nothing to publish"
    exit 0
fi

cp "$SRC" "$DEST"
git add -- "$DEST"
git commit -q -m "Update viewer page ($(date '+%Y-%m-%d %H:%M %Z'))" -- "$DEST"
git push -q origin main
echo "pushed; the page redeploys in a minute or so: https://peribelle.github.io/2026-florida-election-tracker/"
