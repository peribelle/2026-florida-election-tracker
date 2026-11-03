#!/usr/bin/env python3
"""Render a PNG contact sheet of the workbook's charts."""
import json, os, csv
from collections import defaultdict
from datetime import datetime
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
F = json.load(open(os.path.join(DATA, "findings.json")))

rows = []
for r in csv.DictReader(open(os.path.join(DATA, "counties.csv"))):
    pass
# rebuild county summary quickly from CSVs
by_type = defaultdict(lambda: defaultdict(int))
for r in csv.DictReader(open(os.path.join(DATA, "by_type.csv"))):
    by_type[r["county"].upper()][r["ballot_type"]] += int(r["ballots"])
elig = {r["county"].upper(): int(r["eligible_voters"]) for r in csv.DictReader(open(os.path.join(DATA, "counties.csv")))}
disp = {"DESOTO": "DeSoto", "MIAMI-DADE": "Miami-Dade"}
brow = 314113
data = []
for c, d in by_type.items():
    t = sum(d.values()); e = elig[c]
    data.append((disp.get(c, c.title()), t, e, 100 * t / e, d.get("Mail", 0), d.get("EarlyVoting", 0)))
data.append(("Broward", brow, 1103545, 100 * brow / 1103545, 0, brow))
data.sort(key=lambda x: -x[3])

prec = [float(r["turnout_pct"]) for r in csv.DictReader(open(os.path.join(DATA, "by_precinct.csv")))
        if r["turnout_pct"] and int(r["eligible_voters"]) >= 50]
buckets = defaultdict(int)
for v in prec:
    buckets[min(int(v // 10) * 10, 90)] += 1

daily = defaultdict(lambda: defaultdict(int))
for r in csv.DictReader(open(os.path.join(DATA, "by_date.csv"))):
    daily[datetime.strptime(r["date"], "%m/%d/%Y")][r["ballot_type"]] += int(r["ballots"])

loc = list(csv.DictReader(open(os.path.join(DATA, "location_party.csv"))))
names = {(l["county"], l["location_id"]): l["name"] for l in csv.DictReader(open(os.path.join(DATA, "by_location.csv")))}
lt = defaultdict(int)
for r in loc:
    lt[(r["county"], r["location_id"])] += int(r["ballots"])
busiest = sorted(lt.items(), key=lambda kv: -kv[1])[:15]

gap = json.load(open(os.path.join(DATA, "findings.json")))["gap_top"]

plt.rcParams.update({"font.size": 9, "axes.titlesize": 10, "axes.titleweight": "bold",
                     "axes.spines.top": False, "axes.spines.right": False})
fig, ax = plt.subplots(3, 3, figsize=(19, 15))
fig.suptitle("Florida 2026 General Election — pre-Election-Day turnout (unofficial)", fontsize=16, fontweight="bold")

# 1 party rate
party = F["party"][:4]
a = ax[0][0]
short={"Republican":"GOP","Democratic":"Dem","No Party Affiliation":"NPA","Independent Party of Florida":"IND"}
a.bar([short.get(p["party"],p["party"]) for p in party], [p["rate"] for p in party],
      color=["#C00000", "#1F4E79", "#7F7F7F", "#8E7CC3"])
a.yaxis.set_major_formatter(mtick.PercentFormatter())
a.set_title("1. Turnout rate by party (66 counties)")
for i, p in enumerate(party):
    a.text(i, p["rate"] + .6, f'{p["rate"]:.1f}%', ha="center", fontweight="bold")

# 2 top 20
a = ax[0][1]
t = data[:20][::-1]
a.barh([x[0] for x in t], [x[3] for x in t], color="#548235")
a.xaxis.set_major_formatter(mtick.PercentFormatter())
a.set_title("2. Highest-turnout counties")

# 3 bottom 10
a = ax[0][2]
b = data[-10:]
a.barh([x[0] for x in b], [x[3] for x in b], color="#C00000")
a.xaxis.set_major_formatter(mtick.PercentFormatter())
a.set_title("3. Lowest-turnout counties")

# 4 scatter
a = ax[1][0]
a.scatter([x[2] for x in data], [x[3] for x in data], s=28, color="#ED7D31", alpha=.8)
a.set_xscale("log"); a.yaxis.set_major_formatter(mtick.PercentFormatter())
a.xaxis.set_major_formatter(mtick.FuncFormatter(lambda v, p: f"{int(v):,}"))
a.set_title("4. Eligible voters vs turnout (log x)")

# 5 stacked top 15
a = ax[1][1]
t = sorted(data, key=lambda x: -(x[1]))[:15]
a.bar([x[0] for x in t], [x[4] for x in t], label="Mail", color="#4472C4")
a.bar([x[0] for x in t], [x[5] for x in t], bottom=[x[4] for x in t], label="Early vote", color="#ED7D31")
a.yaxis.set_major_formatter(mtick.FuncFormatter(lambda v, p: f"{v/1000:.0f}k"))
a.set_title("5. Biggest 15 counties — mail vs early"); a.legend()
a.tick_params(axis="x", rotation=75)

# 6 daily
a = ax[1][2]
ds = sorted(daily)
a.plot(ds, [daily[d].get("Mail", 0) for d in ds], label="Mail", color="#4472C4", lw=2)
a.plot(ds, [daily[d].get("EarlyVoting", 0) for d in ds], label="Early vote", color="#ED7D31", lw=2)
a.yaxis.set_major_formatter(mtick.FuncFormatter(lambda v, p: f"{v/1000:.0f}k"))
a.set_title("6. Daily ballots processed"); a.legend()
a.tick_params(axis="x", rotation=45)

# 7 gap
a = ax[2][0]
gg = F["gap_top"][:5] + F["gap_bottom"][-5:]
gg = sorted(gg, key=lambda x: x["gap"])
a.barh([f'{g["county"]}' for g in gg], [g["gap"] for g in gg],
       color=["#C00000" if g["gap"] < 0 else "#1F4E79" for g in gg])
a.axvline(0, color="#333", lw=.8)
a.set_title("7. R minus D turnout rate, extreme counties")
lo, hi = a.get_xlim()
a.set_xlim(lo - 3, hi + 3)
for i, g in enumerate(gg):
    a.text(g["gap"] + (.3 if g["gap"] >= 0 else -.3), i, f'{g["gap"]:+.1f}',
           va="center", ha="left" if g["gap"] >= 0 else "right", fontsize=8, fontweight="bold")

# 8 precinct distribution
a = ax[2][1]
ks = sorted(buckets)
a.bar([f"{k}-{k+9}%" for k in ks], [buckets[k] for k in ks], color="#A5A5A5")
a.set_title("8. Precinct turnout distribution"); a.tick_params(axis="x", rotation=45)

# 9 busiest
a = ax[2][2]
bb = busiest[::-1]
labels = []
for (c, lid), v in bb:
    nm = names.get((c, lid)) or (f'Broward site {lid}')
    labels.append(f'{nm[:30]} ({c.title()})')
a.barh(labels, [v for _, v in bb], color="#9E480E")
a.set_title("9. Busiest early-voting sites")

plt.tight_layout(rect=[0, 0, 1, .96])
out = os.path.join(HERE, "Reports", "charts_preview.png")
plt.savefig(out, dpi=110, bbox_inches="tight")
print("WROTE", out)
