#!/usr/bin/env python3
"""Parse Broward's early-voting-by-date-and-location PDF (E240, Nov 3 2026)."""
import re, subprocess, csv, os

HERE = os.path.dirname(os.path.abspath(__file__))
txt = subprocess.run(["pdftotext", "-layout", os.path.join(HERE, "raw", "broward_ev.pdf"), "-"],
                     capture_output=True, text=True).stdout

DATES = ["10/19","10/20","10/21","10/22","10/23","10/24","10/25","10/26","10/27","10/28","10/29","10/30","10/31","11/01"]
rows, grand = [], None

for line in txt.splitlines():
    if not line.strip():
        continue
    # a data line has a site code EVxxx
    m = re.search(r"\s(EV[A-Z0-9]{3,6})\s+", line)
    if m:
        pre = line[:m.start()].strip()
        rest = line[m.end():]
        nums = [int(x.replace(",", "")) for x in re.findall(r"[\d,]+", rest)]
        if len(nums) < 15:
            continue
        name = re.sub(r"\s{2,}", " ", pre).strip()
        vals = nums[:14]
        total = nums[14]
        rows.append({
            "county": "BROWARD", "location_id": m.group(1), "kind": "Early Voting",
            "name": name, "address": "",
            **{d: v for d, v in zip(DATES, vals)}, "total": total,
        })
    elif line.strip().upper().startswith("TTLS"):
        nums = [int(x.replace(",", "")) for x in re.findall(r"[\d,]+", line.split("TTLS", 1)[1])]
        grand = nums[:15]

out = os.path.join(HERE, "data", "broward_ev_by_location.csv")
cols = ["county", "location_id", "kind", "name", "address"] + DATES + ["total"]
with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for r in rows:
        w.writerow(r)

print(f"{len(rows)} locations parsed")
print("sum of rows :", sum(r["total"] for r in rows))
print("PDF grand   :", grand)
for r in rows[:3]:
    print(r["location_id"], r["name"], r["total"])
