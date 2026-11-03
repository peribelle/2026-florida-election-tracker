# Florida 2026 General Election — turnout tracker

Pulled 2026-11-01 (the final day of early voting, two days before Election Day) for all 67 counties.

## Deliverables (`Reports/`)

| File | What it is |
|---|---|
| `Florida_2026_General_Turnout.xlsx` | The workbook: 16 tabs, 5,267,952 ballots, 9 native Excel charts |
| `charts_preview.png` | One-image contact sheet of the charts |
| `counties_and_election_sites.md` | All 67 counties with elections website, live turnout link, eligible voters, ballots, turnout % |
| `county_election_sites.csv` | Same data as CSV |

## Workbook tabs

`README` · `County Summary` · `Elections Sites` · `By Party` · `By Ballot Type` · `By Precinct` ·
`Precinct x Type` · `By Date` · `Locations` · `Location x Party` · `Location x Day` ·
`Precinct Registration` · `County Registration` · `Charts` · `Method & Caveats`

## Where the data comes from

- **Turnout**: every Florida county except Broward publishes its unofficial turnout through VR Systems
  *Turnout Quick View* — the widget embedded on the county's own "turnout" page. The widget reads static JSON from
  `turnoutquickview.electionsfl.org/data/FL/<COUNTY>/<election>/data.json`. `collect.py` walks all 67 county
  indexes, picks the record dated 11/03/2026, and stores it.
- **Broward**: its feed is stale (last election March 2025). `parse_broward.py` parses Broward's official daily
  early-voting PDF (30 sites × 14 days = 314,113). Broward mail returns are not published pre-election.
- **Denominators**: FL Division of Elections book-closing report (Oct 5, 2026), active registered voters,
  by county / party / precinct.

## Refresh (one line)

```bash
./refresh.sh
```

That re-pulls all 67 feeds, rebuilds every CSV, the workbook, the county/site lists and the chart preview,
then prints what changed since the previous run. It creates and installs the virtualenv itself on first use.

To make it work from anywhere:

```bash
echo 'alias flturnout="$HOME/Code/election-tracking/refresh.sh"' >> ~/.bashrc
```

Individual steps, in order:

```bash
.venv/bin/python collect.py        # 67 county feeds -> raw/tqv/
.venv/bin/python normalize.py      # tidy tables -> data/*.csv
.venv/bin/python parse_broward.py  # Broward PDF -> data/broward_ev_by_location.csv
.venv/bin/python build_workbook.py # -> Reports/Florida_2026_General_Turnout.xlsx
.venv/bin/python write_lists.py    # -> Reports/counties_and_election_sites.md/.csv
.venv/bin/python make_preview.py   # -> Reports/charts_preview.png
.venv/bin/python report_delta.py   # prints statewide totals + change vs last run
```

## Validation

- County-reported eligible voters vs. DOS book closing: median difference 0.03%.
- Statewide total at pull (5,267,952) vs. the Division of Elections count at 8:09 a.m. the same morning
  (5,159,537) — difference consistent with a full day of early voting still being counted.
- Every county's party totals, precinct totals and type totals reconcile to the same ballot count.
