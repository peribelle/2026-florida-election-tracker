# Florida 2026 General Election — turnout tracker

Pulled live from all 67 counties. Election Day is Tuesday, November 3, 2026.

## Refresh (one line)

```bash
./refresh.sh
```

Re-pulls every feed, rebuilds the CSV tables, workbook, county/site lists and chart preview,
prints the change since the last archived run, then archives the run.

Optional alias:

```bash
echo 'alias flturnout="$HOME/Code/election-tracking/refresh.sh"' >> ~/.bashrc
```

## Deliverables

| Path | What it is |
|---|---|
| `Reports/Florida_2026_General_Turnout.xlsx` | Latest workbook: 16 tabs, 9 native charts |
| `Reports/charts_preview.png` | Chart contact sheet |
| `Reports/counties_and_election_sites.md` | All 67 counties: website, turnout link, eligible voters, ballots, % |
| `Reports/county_election_sites.csv` | Same, as data |
| `runs/<timestamp>/` | **Immutable archive of every run** |
| `runs/INDEX.csv` | **Append-only run log** (one row per run) |
| `runs/latest` | Symlink to the newest run |

`Reports/` is a convenience mirror of the newest run and is rewritten each time.
`runs/` is never rewritten — each run gets its own directory containing the raw feeds
(`raw_feeds.zip`), the tidy CSVs, the workbook, the chart preview, and a `manifest.json`
with a SHA-256 for every file.

## Where the data comes from

- **66 counties**: every county except Broward publishes unofficial turnout through VR Systems
  *Turnout Quick View* — the widget on the county's own turnout page. `collect.py` reads
  `turnoutquickview.electionsfl.org/data/FL/<COUNTY>/<election>/data.json` and stores the whole record:
  date × type, party × type, precinct × type × eligible voters, location × party, location × day.
- **Broward**: its own dashboard at `my.browardvotes.gov/TEDElectionLink`, backed by a JSON/HTML API.
  `collect_broward.py` pulls the summary KPIs, the ballot-type mix, the party table, all 346 precincts
  and the 281 Election Day locations. Broward publishes turnout against *all* registered voters;
  the workbook maps it onto active registered so the 67 counties compare like for like.
- **Denominators**: FL Division of Elections book-closing report (Oct 5, 2026), active registered
  voters by county / party / precinct.

## Tabs

`README` · `County Summary` · `Elections Sites` · `By Party` · `By Ballot Type` · `By Precinct` ·
`Precinct x Type` · `By Date` · `Locations` · `Location x Party` · `Location x Day` ·
`Precinct Registration` · `County Registration` · `Charts` · `Method & Caveats`

## Election-night cadence

Florida rule, per the Division of Elections timeline:

- **7:30 PM local** — preliminary returns due: all early voting and all vote-by-mail tabulated
  through the end of early voting.
- **Every 45 minutes after** — precinct-level Election Day results, until complete.
- **8:00 PM Eastern** — first statewide release (Florida spans two time zones).
- **~99% reported by midnight** in 2016 and 2020.
- **Noon, Sat Nov 7** — unofficial returns due (4th day after the election).

Note: county turnout dashboards, including the shared feed, are typically switched off at 7 PM
on Election Day and replaced by election-results pages. Tracking after that means watching
Florida Election Watch (`floridaelectionwatch.gov`) and each county's Clarity/ENR results site,
not the turnout feed.

## Individual steps

```bash
.venv/bin/python collect.py         # 67 shared feeds -> raw/tqv/
.venv/bin/python collect_broward.py # Broward dashboard -> data/broward/
.venv/bin/python normalize.py       # tidy tables -> data/*.csv
.venv/bin/python build_workbook.py  # -> Reports/Florida_2026_General_Turnout.xlsx
.venv/bin/python write_lists.py     # -> Reports/counties_and_election_sites.md/.csv
.venv/bin/python make_preview.py    # -> Reports/charts_preview.png
.venv/bin/python report_delta.py    # prints totals + change vs last archived run
.venv/bin/python archive.py         # -> runs/<timestamp>/ + runs/INDEX.csv
```

## Validation

- County-reported eligible voters vs. DOS book closing: median difference 0.03%.
- Each county's party totals, precinct totals and ballot-type totals reconcile to the same count.
- The two pre-archive runs are logged in `runs/INDEX.csv` and flagged `RECONSTRUCTED` —
  their raw feeds were overwritten before archiving existed.
