#!/usr/bin/env python3
"""Print statewide totals and the change since the previous archived run.

Reads the current workbook, and compares against the last row of
runs/INDEX.csv (which archive.py appends to after this script runs).
"""
import csv, os
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, "runs", "INDEX.csv")

wb = openpyxl.load_workbook(os.path.join(HERE, "Reports", "Florida_2026_General_Turnout.xlsx"),
                            data_only=True)
ws = wb["County Summary"]
for r in ws.iter_rows(min_row=5, values_only=True):
    if r[0] == "FLORIDA":
        total, mail, early, ed, prov, elig = r[2], r[4], r[5], r[6], r[7], r[8]
        break
rate = 100 * total / elig

stamp = ""
for row in ws.iter_rows(min_row=5, values_only=True):
    if row[1] and row[0] != "FLORIDA" and row[14]:
        stamp = max(stamp, str(row[14]))

print(f"  ballots   {total:>12,}")
print(f"  eligible  {elig:>12,}")
print(f"  turnout   {rate:>11.2f}%")
print(f"  mail      {mail:>12,}")
print(f"  early     {early:>12,}")
print(f"  election day {ed:>9,}")
print(f"  feed time {stamp}")

prev = None
if os.path.exists(INDEX):
    with open(INDEX) as f:
        rows = list(csv.DictReader(f))
    if rows:
        prev = rows[-1]

if prev:
    d = total - int(prev["ballots"])
    print(f"\n  since run {prev['run_id']} ({prev['feed_time']}): {d:+,} ballots, "
          f"{rate - float(prev['turnout_pct']):+.2f} pts")
else:
    print("\n  (first archived run - no baseline yet)")

print("\n  -> Reports/Florida_2026_General_Turnout.xlsx")
