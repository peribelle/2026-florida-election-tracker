# AGENTS.md — Florida 2026 turnout + results tracker

Read this before changing anything. It describes every data source, every schedule slot, every file
and every schema. Several people (and agents) work in this repo.

---

## 1. What this project does

Tracks the **2026 Florida general election** (Tuesday, November 3, 2026) in two phases:

1. **Turnout** — who has voted, by county / party / precinct / ballot type / day / location.
2. **Results** — the votes themselves, from statewide races down to county, municipal and
   precinct level.
3. **Projections** — forecast win probabilities and race calls from DDHQ and two prediction
   markets. Separate from the count, never mixed with it (§7.5).

Output is a workbook, a standalone HTML viewer, per-county precinct spreadsheets, and an
immutable archive of every pull.

---

## 2. Ground rules

| Rule | Why |
|---|---|
| **Never delete or rewrite `runs/`, `results/` or `projections/`** | These are the historical record. Each pull gets its own directory. |
| **Never write a probability into `results/`** | `results/` is counted votes, `projections/` is predicted outcomes. Mixing them corrupts both. See §7.5. |
| **Never edit `election_day.sh` while it is running** | Bash re-reads a running script by byte offset; edits can corrupt execution. Stop it, edit, restart. |
| **`Reports/` is a mirror, not history** | It is overwritten every run on purpose. History lives in `runs/` and `results/`. |
| **Any new ENR URL must pass the election-date check** | Several counties serve the August primary at a lower id than the general. See §9. |
| **Don't rename CSV columns without updating consumers** | `build_workbook.py` and `build_viewer.py` both read `data/*.csv`. |
| **Timestamps are local (America/New_York)** unless the column says `_utc`. | Run ids are local, e.g. `20261102-195829`. |
| **The viewer never writes into `runs/`, `results/` or `projections/`** | It is a reader. `Reports/viewer.html` is a mirror and is overwritten on purpose. |
| **Never hand-edit `docs/`** | `publish.py` regenerates `docs/index.html` (a copy of `Reports/viewer.html`) and `docs/preview.png` on every publish. See §12. |
| **A pull never waits on publishing or validating** | Collectors only *ask* (`after_pull.py`) `publish.py` and `validate.py`, which run detached behind locks. Keep it that way: either may fail, hang or be switched off without touching a pull. |
| **Validators only read** | `validate.py` reads snapshots and writes only `validation/` and `logs/`; the viewer reads `validation/` and never writes it. `validation/alerts.csv` and `runs.csv` are append-only. See §13. |

---

## 3. Data sources

| # | Source | URL pattern | What it gives | Auth |
|---|---|---|---|---|
| 1 | **VR Systems "Turnout Quick View"** | `https://s3.amazonaws.com/turnoutquickview.electionsfl.org/data/FL/<CODE>/index.json` then `.../<election>/data.json` | 66 counties: turnout by date×type, party×type, precinct×type×eligible, location×party, location×day | none |
| 2 | **Broward TED dashboard** | `https://my.browardvotes.gov/TEDElectionLink/api/v1/widgets/chart?tile=<id>&dashboard=<view>` and `.../TurnOutWidget/dashboard/view/<view>` (Blazor HTML tables) | Broward only: KPIs, ballot-type pie, party table, 346 precincts, EV/ED locations | none |
| 3 | **Florida Election Watch** (Division of Elections) | `https://floridaelectionwatch.gov/CountyReportingStatus`, `/ElectionDayTurnout`, `/ContestResultsByCounty/<id>`, office pages under `/StateOffices`, `/FederalOffices`, `/DistrictOffices/*`, `/JudicialOffices/*`, `/Amendments` | Official state feed: county turnout + precincts reporting, and ~172 state/federal/judicial/amendment contests | none |
| 4 | **County Clarity ENR (contests)** | `https://enr.electionsfl.org/<CODE>/<id>/Summary/` (also `results.enr.clarityelections.com/FL/<Name>/<id>/`) | Every contest on that county's ballot, including county commission, sheriff, school board, city races, local charter amendments | none |
| 5 | **County Clarity ENR (precinct CSV)** | `.../<id>/Reports/` → "Candidate Results by Precinct and Party (CSV)" on S3 | Whole precinct-level ballot in one file | none |
| 6 | **County Clarity ENR (precinct pages)** | `.../<id>/Precincts/<contest>/` | Same data for counties that don't publish the CSV export; one request per contest | none |
| 7 | **DDHQ Votes** | `https://votes.decisiondeskhq.com/races/<date>/<slug>/forecast` (send `RSC: 1` to get the ~4x smaller flight stream) | Forecast win probability per candidate **and** the race call (`winner`, `called_at`) for 30 FL races: Governor, US Senate special, all 28 US House | none |
| 8 | **Kalshi** | `https://api.elections.kalshi.com/trade-api/v2/events/<event>?with_nested_markets=true` | Market-priced win probability, bid/ask, volume. FL: Governor, Senate, CFO, 4 House districts | none |
| 9 | **Polymarket** | `https://gamma-api.polymarket.com/events?slug=<slug>` | Market-priced win probability + volume. FL: Governor, Senate | none |

Reference data (downloaded once, kept in `raw/`):

- `raw/1-party-by-county.xlsx` — DOS book closing, active registered voters by county × party
- `raw/4-party-by-precinct-...xlsx` — book closing by precinct × party
- `raw/2-race-by-county.xlsx` — book closing by race
- `raw/sites.json` — official Supervisor of Elections website per county (scraped from dos.elections.myflorida.com)
- `raw/enr_ids.json` — validated county → Clarity `{base, key, id}`
- `raw/projection_map.json` — hand-maintained Kalshi series and Polymarket slugs. DDHQ races are **not** listed here; they are discovered from its forecast index pages.
- `raw/collect_log.json` — which counties the TQV pull succeeded for, and their election number

---

## 4. Schedule

Driven by `election_day.sh`. Started once, runs the whole election, exits at 03:00.

```bash
cd ~/Code/election-tracking && nohup ./election_day.sh > logs/nohup.out 2>&1 &
```

| Phase | When | Cadence | Runs | Count |
|---|---|---|---|---|
| Turnout | 07:00 → 18:00 | hourly on the hour | `./refresh.sh` | 12 |
| Turnout final | **18:59** | once, one minute before close | `./refresh.sh` | 1 |
| Results | 19:00 → 03:00 | every 10 minutes | `results.py` | 49 |
| Precinct (slow counties) | 19:15 → 02:45 | **:15 and :45** | `results_precinct_slow.py` | 16 |
| Projections | 19:20 → 02:50 | **:20 and :50** | `projections.py` | 16 |
| | | | **total** | **94** |

Guards built into the scheduler:

- It is **date-gated to 2026-11-03**. Started earlier, it idles without firing. It will not run
  results on election morning by accident.
- `logs/.election_day_tick` prevents double-firing within the same minute.
- At 19:00 it runs `audit.py` before the first results pull.
- At the top of every results hour it re-runs `discover_links.py` to pick up counties that stand
  up their results pages late.
- Projections fire **inside** the results phase at :20 and :50, backgrounded behind a file lock
  (`logs/.projections.lock`), so a slow or failed projections pull can never delay `results.py`.
- Every collector (`refresh.sh`, `results.py`, `results_precinct_slow.py`, `projections.py`) ends by calling `after_pull.py`,
  which asks `validate.py` (§13) and `publish.py` (§12) for a detached job each. The asks return at once, and they live in the
  collectors, not in `election_day.sh`, so changing them never needs a scheduler restart.
- `./election_day.sh --test` replays `phase_for()` minute by minute — trust that, not a hand-written list.
- `./election_day.sh --status` shows the last tick and both indexes.

Cron equivalent (each line is independent, so a failure can't kill the schedule):

```cron
0 7-18 * * *       cd $HOME/Code/election-tracking && ./election_day.sh --once
59 18 * * *        cd $HOME/Code/election-tracking && ./election_day.sh --once
*/10 19-23 * * *   cd $HOME/Code/election-tracking && ./election_day.sh --once
*/10 0-2 * * *     cd $HOME/Code/election-tracking && ./election_day.sh --once
0 3 * * *          cd $HOME/Code/election-tracking && ./election_day.sh --once
```

---

## 5. Data flow

```
                        ┌─ collect.py ────────► raw/tqv/<CODE>_<n>.json   (66 counties)
                        ├─ collect_broward.py ► data/broward/*.csv         (Broward)
  every hour / 18:59    └─ parse_broward.py ──► data/broward_ev_by_location.csv (PDF fallback)

          normalize.py ── merges TQV + Broward ──► data/*.csv  (tidy tables)
                     │
                     ├─ build_workbook.py ──► Reports/Florida_2026_General_Turnout.xlsx
                     ├─ write_lists.py ─────► Reports/counties_and_election_sites.{md,csv}
                     ├─ make_preview.py ────► Reports/charts_preview.png
                     ├─ build_viewer.py ────► Reports/viewer.html
                     └─ archive.py ─────────► runs/<local-ts>/ + runs/INDEX.csv

  every 10 min (19:00-03:00)
     results.py ─┬─ Florida Election Watch ──► results/<ts>/{county_status,ed_turnout,contest_votes}.csv
                 ├─ results_county.py ──────► results/<ts>/county_contests.csv + county_enr_status.csv
                 └─ results_precinct.py ────► results/<ts>/precincts/<County>.xlsx + raw/*.csv.gz
     (end of pull) build_viewer.py, detached, 180 s limit ──► Reports/viewer.html   (log: logs/viewer_build.log)

  every :15 and :45
     results_precinct_slow.py ──────────────► results/slow/<ts>/precincts/<County>.xlsx

  every :20 and :50 (backgrounded; never blocks results)
     projections.py ─┬─ projections_ddhq.py ────────► forecast win % + race calls
                     ├─ projections_kalshi.py ──────► market prices per candidate
                     └─ projections_polymarket.py ──► market prices per party
                     ──► projections/<ts>/{predictions,calls,divergence,coverage}.csv
                         each source isolated: its own process, its own timeout

  after every pull above (refresh.sh, results.py, results_precinct_slow.py, projections.py): after_pull.py asks two workers
     validate.py ──► detached worker (lock logs/.validate.lock, log logs/validate.log)
        source check (did it pull?) + data check (do the numbers make sense?) on every new pull
        ──► validation/{alerts.csv,runs.csv,current.json,state.json,<run>/findings.csv}   desktop notification for tier 1-2
     publish.py --queue ──► detached worker (lock logs/.publish.lock, log logs/publish.log)
        waits for quiet files, for the validator to finish, and >= 5 min since the last push, then:
        build_viewer.py ──► Reports/viewer.html ──► docs/index.html + docs/preview.png (headless Chromium)
        git commit  data/ raw/ Reports/ runs/ results/ projections/ validation/ docs/   (never code)
        git push origin main ──► GitHub Pages redeploys docs/
```

`refresh.sh` runs the whole turnout chain in order and is what the scheduler calls.

---

## 6. Directory map

```
.
├── election_day.sh          scheduler (the only long-running process)
├── refresh.sh               turnout pipeline: 9 steps + viewer build
├── results.py               one results snapshot: state + county + precinct CSV
├── projections.py           one projections snapshot: forecasts + calls + markets
├── projections_ddhq.py      DDHQ forecast win % and race calls (30 FL races)
├── projections_kalshi.py    Kalshi market prices per candidate
├── projections_polymarket.py Polymarket market prices per party
├── projection_common.py     shared: map loading, race naming, CSV writing
├── audit.py                 verifies every id and every stored snapshot
├── requirements.txt         Python packages for .venv
│
├── collect.py               66 county TQV feeds
├── collect_broward.py       Broward dashboard API
├── parse_broward.py         Broward early-vote PDF (fallback only)
├── normalize.py             TQV + Broward -> data/*.csv
├── build_workbook.py        the Excel workbook (16 tabs, 9 charts)
├── build_viewer.py          single-file HTML viewer
├── write_lists.py           county/site lists
├── make_preview.py          chart contact sheet PNG
├── report_delta.py          prints change vs last archived run
├── archive.py               immutable snapshot -> runs/
├── discover_enr.py          brute-force id probe (validated)
├── discover_links.py        homepage scrape (validated, runs hourly)
├── results_county.py        county contests from Clarity Summary pages
├── results_precinct.py      precinct CSV -> one xlsx per county
├── results_precinct_slow.py precinct pages for counties without the CSV
├── schedule_check.sh        replays phase_for() over every minute
├── after_pull.py            what every collector calls last: asks validate.py and publish.py for a detached job
├── validate.py              the two validators: engine, alerts, notifications, watchdog, --selftest (§13)
├── validate_checks.py       source checks, metrics, tiers, schedule port
├── validate_data.py         data checks: the generic table comparer and the invariants
├── validate_selftest.py     runs 41 checks on a copy of the real history: the right alert fires, a clean pull stays silent
├── publish.py               after every pull: rebuild viewer, refresh docs/, commit the outputs, push (§12)
├── github_known_hosts       GitHub's published SSH host keys, so unattended pushes never prompt
│
├── raw/                     downloaded source material (see §3)
│   └── tqv/                 latest county feed JSON, overwritten each pull
├── data/                    latest tidy turnout tables (overwritten each pull)
├── data/broward/            Broward's raw-normalized pieces
├── Reports/                 latest deliverables (mirror, overwritten)
├── runs/<ts>/               immutable turnout archive
├── results/<ts>/            immutable results snapshot
├── results/slow/<ts>/       immutable slow precinct snapshot
├── projections/<ts>/        immutable projections snapshot
├── validation/              the validators' output: alerts.csv, runs.csv, current.json, state.json, <run>/findings.csv (§13)
├── logs/                    per-day run logs
├── docs/                    GitHub Pages source, written by publish.py: index.html (copy of the viewer), preview.png (README image)
└── viewer/                  map outlines + template for build_viewer.py
```

---

## 7. Schemas

### 7.1 Turnout — `data/*.csv`

`counties.csv` (67 rows, one per county)

| column | meaning |
|---|---|
| `code` | 3-letter DOS code (`DAD` = Miami-Dade) |
| `county` | upper-case county name as the source reports it |
| `election`, `election_date` | `2026 General Election`, `11/03/2026` |
| `eligible_voters` | county-reported active registered voters (Broward: all-registered, see `eligible_basis`) |
| `last_updated` | source timestamp |
| `tabs` | which TQV tabs were present |
| `precincts`, `locations_ev`, `locations_ed` | counts |
| `eligible_basis` | `active registered` or `all registered` |

`by_type.csv` — `county, ballot_type, ballots` (ballot_type ∈ Mail, EarlyVoting, ElectionDay, Provisional)

`by_party.csv` — `county, party_code, party, mail, earlyvoting, electionday, provisional, total`

`by_precinct.csv` — `county, precinct_key, location, eligible_voters, mail, earlyvoting, electionday, provisional, total, turnout_pct`
Precinct keys with `S##`/`A##` suffixes are split precincts; they roll up to the base number.

`by_location.csv` — `county, location_id, kind, name, address` (kind ∈ Early Voting, Election Day)

`by_date.csv` — `county, date (MM/DD/YYYY), ballot_type, ballots`

`location_party.csv` — `county, location_id, party_code, party, ballots` (early-vote sites; includes provisional)

`location_day.csv` — `county, location_id, date, ballots`

`broward_ev_by_location.csv` — legacy PDF parse, `county, location_id, kind, name, address, <14 date columns>, total`. Superseded by the dashboard; kept as a cross-check.

**Party codes:** `DEM REP NPA IND LPF GRE CPF AMF ASP BPP CPP CSV ECO FFP PSL JEF MGT WTP OTH`.
`IND` is the **Independent Party of Florida** (~660k registrants), not "independent voters" — those are `NPA`.

### 7.2 Results — `results/<ts>/`

`county_status.csv` — Florida Election Watch, per county
`county, voter_turnout, eligible_active, turnout_pct, precincts_reporting_pct, precincts_completed_pct, vbm_completed, early_completed, provisional_completed, overseas_10day`

`ed_turnout.csv` — `county, turnout, last_reported, time_zone`

`contest_votes.csv` — state contests
`contest_id, contest, county, candidate, party, votes` (county `TOTAL` = statewide row)

`county_contests.csv` — every contest in every reachable county
`county_code, contest, candidate, party, election_day, early, mail, provisional, total, pct`

`county_enr_status.csv`
`county_code, registered, ballots_cast, turnout_pct, precincts_reporting, precincts_total, last_updated, election_date, url`

`precincts/<County>.xlsx` — four sheets: `Summary`, `By Precinct`, `By Contest`, `Data`
`Data` columns: `Contest, Candidate, Party, Precinct, Mail, Early, Election Day, Total, %`

`raw/*.html.gz` — every state page as fetched
`raw/precinct_<CODE>.csv.gz` — the county's precinct CSV exactly as downloaded

`summary.json`, `county_enr_summary.json`, `precinct_summary.json` — per-pull counts and failures

### 7.3 Results — `results/slow/<ts>/`

Same per-county workbook format for counties that lack the CSV export, built from precinct pages.
`precincts/<County>.xlsx`, `raw/precinct_<CODE>.csv.gz`, `summary.json`; index at `results/slow/INDEX.csv`.

### 7.4 Archive — `runs/<local-ts>/`

```
data/           copy of data/*.csv at that moment
Reports/        copy of every deliverable
code/           snapshot of the scripts that produced it
raw_feeds.zip   all 67 county JSON feeds + sites.json + collect_log.json
manifest.json   run id, timestamps, feed time, statewide totals, sha256 of every file
```

`runs/INDEX.csv` — append-only, one row per turnout run:
`run_id, created_local, created_utc, feed_time, ballots, mail, early, election_day, provisional, eligible, turnout_pct, note`

`results/INDEX.csv` — append-only, one row per results pull:
`run_id, created_local, created_utc, ballots, eligible, turnout_pct, counties_reporting, contests_with_votes, note, county_enr_ok, precinct_ok, precinct_rows`
(columns were added over time; parse by name, not position)

> `results/INDEX.csv` is rewritten when new columns are added (schema migration), but rows are preserved.
> Everything else is strictly append-only or write-once.

### 7.5 Projections — `projections/<ts>/`

Forecast win probabilities and race calls. **These are not votes** — never write a probability into
`results/`. A probability is a prediction; `results/` is a count.

#### What is pulled

| Source | Emits | One row per | Coverage |
|---|---|---|---|
| `ddhq` | predictions **and** calls | race × candidate | Governor, US Senate special, all 28 US House = **30 races** |
| `kalshi` | predictions | race × candidate | Governor, Senate, CFO, House 1/6/13/23 = **5 with an open market** |
| `polymarket` | predictions | race × **party** | Governor, Senate = **2 races** |

Exact fields per source:

- **DDHQ** — `win_probability` (the last point of the candidate-level timeseries), plus
  `toplineResults[].winner` / `.called_at` for the call. Also carries `precincts_in` /
  `precincts_total` from its own turnout estimate, and `certified`.
- **Kalshi** — `last_price_dollars` (falls back to the bid/ask midpoint), `yes_bid_dollars`,
  `yes_ask_dollars`, `volume_fp`. Party comes from `subtitle` (`":: Democratic"`), **not** the
  ticker suffix — CFO tickers end `-ATAD`/`-BING`, not `-R`/`-D`.
- **Polymarket** — the `Yes` price from `outcomePrices`, plus `volume`. `outcomes` and
  `outcomePrices` arrive as JSON **strings inside** the JSON, so they are re-parsed.

Nothing forecasts AG, Agriculture Commissioner, the legislature, judicial retention or the
amendments. Those races are absent by design.

#### How often

- **:20 and :50**, from 19:20 to 02:50 → **16 pulls**. They ride *inside* the results phase and are
  launched backgrounded behind `logs/.projections.lock`, so they never delay `results.py`.
- Each pull runs the three adapters as separate processes (timeouts 900 s / 240 s / 240 s). One
  failing source records `ok: false` and produces no file; the others are untouched.
- Measured: **~3 seconds** and **~1.5 MB** of archived raw pages per pull (30 gzipped DDHQ pages).
- `--dest DIR` runs are ad-hoc: they write a snapshot but **never** append to `projections/INDEX.csv`.

#### Where it lands

```
projections/
├── INDEX.csv                    append-only; one row per production pull
└── <local-ts>/                  e.g. 20261102-224747; one directory per pull, never rewritten
    ├── predictions.csv          merged: every (source, race, candidate) probability
    ├── calls.csv                merged: DDHQ call state, one row per race × candidate
    ├── divergence.csv           races where sources disagree, widest spread first
    ├── coverage.csv             race_key -> which sources cover it
    ├── summary.json             per-source ok/error + counts; the file to read first
    ├── predictions_<source>.csv raw per-source output, before the merge
    ├── calls_<source>.csv       (ddhq only)
    ├── <source>_summary.json    per-adapter counts and failures
    └── raw/ddhq_<slug>.txt.gz   the flight stream exactly as received, 30 files
```

The per-source files are kept alongside the merged ones on purpose: when a merged row looks wrong,
the per-source file says which adapter produced it, and `raw/` says what it saw.

`predictions.csv` columns: `fetched_utc, source, race_key, race, office, district, candidate,
party, win_probability, price_cents, bid_cents, ask_cents, volume, source_updated_at, source_url`

- `race_key` is `FL-GOV`, `FL-SEN`, `FL-CFO`, `FL-AG`, `FL-AGR`, `FL-H01`…`FL-H28`
- `candidate` is **empty for Polymarket** (party-level market). Group by `party` there.
- `price_cents` / `bid_cents` / `ask_cents` / `volume` are blank for DDHQ
- `source_updated_at` is when the *source* last changed, not when we fetched

`calls.csv` columns: `fetched_utc, source, race_key, race, office, district, candidate, party,
winner, called_at_utc, votes, percent, precincts_in, precincts_total, source_url`

`winner` and `called_at_utc` are **the only two columns in the repo that say a race has been
called.** `precincts_in` / `precincts_total` are DDHQ's estimate and are not a substitute for
`results/`.

`divergence.csv` columns: `race_key, who, sources, min_prob, max_prob, spread, p_ddhq, p_kalshi,
p_polymarket`. A wide `spread` is a signal, not an error — averaging sources would hide it.

`projections/INDEX.csv` columns: `run_id, created_local, created_utc, ddhq_ok, kalshi_ok,
polymarket_ok, races_forecast, prediction_rows, call_rows, called_candidates, max_divergence, note`

#### Reading it

```python
import csv
snap = "projections/20261102-224747"

# what won, once anything is called
calls = [r for r in csv.DictReader(open(f"{snap}/calls.csv")) if r["winner"] == "True"]

# latest probability per race and candidate
for r in csv.DictReader(open(f"{snap}/predictions.csv")):
    if r["race_key"] == "FL-SEN":
        print(r["source"], r["candidate"] or r["party"], r["win_probability"])
```

Before trusting a snapshot, read its `summary.json` — `sources_ok` against `sources_tried` tells you
whether you are looking at three sources or one.

### 7.6 Viewer — `Reports/viewer.html`

One self-contained page (works offline), built by `build_viewer.py` from `viewer/` (`template.html`, `style.css`,
`js/*.js`, `snapshots.py`). It **only reads** `data/*.csv`, `runs/`, `results/` (including `slow/`) and
`projections/`, and never writes into them. It is rebuilt by `refresh.sh` (hourly turnout phase) and at the end of
every `results.py` pull (detached, 180 s limit, output in `logs/viewer_build.log`). A page already open shows
new data after a reload.

Views: Overview, Turnout, Results, Compare, Snapshots, Data lab, Learn. The county menu in the header tailors every
view, and the URL carries the state (`#/compare?cmp=DAD,HIL&race=160000`).

Rules the viewer keeps: projection `GOP` is shown as `REP`; probabilities and calls sit beside the count and are
never added to it; sources are never averaged. Republican marks are red, Democratic blue and Independent (`NPA`,
`IND`) yellow, and those three colors mean nothing else (county colors in Compare are `--c1..--c4`).

---

## 8. Coverage (as of the last pull)

| Layer | Reach | Notes |
|---|---|---|
| Turnout | **67/67 counties** | 66 via TQV, Broward via its dashboard |
| Statewide contests | **172** | all federal, state, judicial, 3 amendments |
| County contests | **46/67 counties**, ~1,000 contests | rest have no 2026 general ENR page yet |
| Precinct CSV | **25/46** | older Clarity builds lack `/Reports/` |
| Precinct page scrape | **13/21** target counties | ~550 requests; more may come up at results time |
| Projections — forecast | **30 FL races** | DDHQ: Governor, US Senate special, all 28 US House |
| Projections — markets | Governor, Senate, CFO, 4 House districts | Kalshi; Polymarket has only Governor + Senate. FL-1 and FL-6 series exist but carry no open market |
| Race calls | **30 FL races** | DDHQ `winner` / `called_at` is the only call authority |

Nobody forecasts AG, Agriculture Commissioner, the legislature, judicial retention or the amendments.
Those races are absent from `projections/` by design — absent beats invented.

Full numbers live in each snapshot's `summary.json` files and in `results/INDEX.csv` /
`projections/INDEX.csv`. Never assume coverage — read the JSON.

---

## 9. Guards and known traps

**Election-date gate.** Every ENR pull checks the page says `11/3/2026`. Counties serve the
**August 18 primary** at a *lower* id than the general (e.g. Volusia 4004 = primary, general is
higher). A primary is recognisable by contest names ending in `(REP)`, `(DEM)` or `(UPC)`.

`./audit.py` checks: every configured id still serves the general, no archived snapshot contains
primary-style contest names, every `county_enr_status.csv` row carries `election_date`, and every
projection race key is a recognised `FL-*` key.

**Do not run a second `results.py` or `projections.py` concurrently** with the scheduler; it will
create a duplicate snapshot and double the request load. `projections.py` guards itself with
`logs/.projections.lock`, `results.py` does not.

**Projections traps.** `polymarket` rows are party-level, so `candidate` is empty — group by
`party`, not `candidate`, or you will silently lose those rows. `FL-H01` and `FL-H06` have Kalshi
series but no open market, so they appear in DDHQ and calls only. A wide `divergence.csv` spread is
the sources genuinely disagreeing, not a bug — do not "fix" it by averaging.

**Broward denominator.** Broward publishes turnout against **all** registered voters (1,366,692);
everyone else uses active registered (1,103,545 for Broward). The workbook maps Broward onto the
active basis so the 67 counties compare like for like. Broward's own headline (33.90%) and ours
(41.99%) differ for that reason, not because of a bug.

**Turnout feeds die at polls close.** County dashboards are switched off at 19:00. That is why the
last turnout pull is 18:59 and results start at 19:00. Do not expect `refresh.sh` to return useful
numbers after close.

**Split precincts** (`101S08`) belong to base precinct `101`. Turnout over 100% happens where a
precinct's eligible count is below ballots cast — a reporting artefact, not a computation error.

---

## 10. Commands

```bash
./refresh.sh                      # full turnout pipeline + archive + viewer
./election_day.sh                 # scheduler (foreground); nohup to background
./election_day.sh --test          # replay every scheduled minute
./election_day.sh --status        # last tick, indexes
./schedule_check.sh               # same replay, standalone
.venv/bin/python results.py       # one results snapshot
.venv/bin/python projections.py   # one projections snapshot (forecasts + calls)
.venv/bin/python projections.py --only ddhq   # a single source, for debugging
.venv/bin/python audit.py         # verify ids + snapshots (exit 1 on failure)
.venv/bin/python discover_links.py# refresh county HE-ENR map from SOE homepages
.venv/bin/python build_viewer.py  # rebuild Reports/viewer.html
.venv/bin/python publish.py       # publish now: viewer, docs/, commit, push (what every pull asks for)
.venv/bin/python validate.py --status    # what the validators have open right now
.venv/bin/python validate.py --replay    # what the saved history would have been flagged (writes nothing)
.venv/bin/python validate.py --selftest  # prove the validators fire (41 checks, touches nothing real)
nohup .venv/bin/python validate.py --watch >> logs/validate_watch.log 2>&1 &   # the watchdog: a scheduled pull that never arrives
.venv/bin/python publish.py --status   # last result, pending request, unpushed commits
```

First-time setup:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

---

## 11. Extending

**Add a county to the Clarity map**

1. Find its results URL (usually linked from the county homepage).
2. Add `{base, key, id}` to `raw/enr_ids.json`.
3. Run `./audit.py` — it must report 46→47 ok and no primary.
4. If it has no `/Reports/` CSV, it is picked up by the slow path automatically.

**Add a non-Clarity platform** (Orange, Pinellas and Palm Beach may need this)

Write a parser that emits the same columns as `county_contests.csv` and
`precincts/<County>.xlsx`, and record the county in `county_enr_summary.json` so coverage stays
honest. Do not silently skip.

**Add a race to the projections pull**

- DDHQ races are discovered automatically; if DDHQ models it, it appears. Nothing to do.
- Markets need an entry in `raw/projection_map.json` (`kalshi.series` or `polymarket.events`).
  Use a race key matching `FL-(GOV|SEN|CFO|AG|AGR|H\d{2})` — `audit.py` rejects anything else,
  which is how a slug silently falling back gets caught.
- Then run `./audit.py`; it must still pass.

**Add a projection source**

Write `projections_<name>.py` that takes the snapshot dir as `argv[1]` and writes
`predictions_<name>.csv` / `calls_<name>.csv` using `PRED_FIELDS` / `CALL_FIELDS` from
`projection_common.py`. Add one tuple to `ADAPTERS` in `projections.py`. Because each adapter is a
separate process with its own timeout, a new source cannot break the existing ones — and its
failure shows up as `ok: false` in `summary.json`.

**Parsing DDHQ, if you ever have to touch it.** The page is a Next.js flight stream, not JSON. Find
a marker and `raw_decode()` the value after it. Never take the first matching key: a forecast page
embeds the whole cycle, so positional parsing will attach another race's numbers to this one — which
is how you get plausible, wrong data that still passes every check. Match on `stateFips == "12"` and
candidate ids, and treat `win_probability` as the last point of the candidate-level timeseries.

**Change a schedule slot**

Edit `phase_for()` in `election_day.sh`, then run `./schedule_check.sh` and confirm the minute-level
replay. Stop the scheduler first.

---

## 12. Git and GitHub

The repo is `peribelle/2026-florida-election-tracker`, branch `main`. GitHub Pages serves `docs/` from `main`, at
`https://peribelle.github.io/2026-florida-election-tracker/`.

**Publishing is automatic.** Every collector ends by asking `publish.py` (via `after_pull.py`) for an update (it only *asks*; see §2). One
publish rebuilds the viewer, refreshes `docs/index.html` and `docs/preview.png`, commits the pipeline's output paths and
pushes `main`.

- **Only outputs are auto-committed:** `data/ raw/ Reports/ runs/ results/ projections/ validation/ docs/`. Code, docs and config
  never are; commit those yourself. The publisher's commits are path-limited, so anything you have staged elsewhere stays
  staged. If you commit by hand at the same moment, one of you sees an `index.lock` error and the publisher retries.
- **Pulls never wait on it.** Asks coalesce behind `logs/.publish.lock`; the worker waits until the files have been
  still for 15 s before it stages them (a snapshot directory takes seconds to write, and projections run beside
  results), and spaces pushes 5 minutes apart because Pages soft-limits builds to 10 an hour. The site therefore trails
  a pull by a minute or a few. A failed push is retried four times and then left for the next pull; local commits are
  never lost and go out with the next push that works.
- **It stays out of the way.** It does nothing unless the repo is on `main` with no rebase or merge in progress.
  `NO_PUBLISH=1` turns the ask off (use it when testing a collector). Check it with `publish.py --status` and
  `logs/publish.log`.
- **`docs/` is generated:** don't hand-edit it. The preview is a headless-Chromium screenshot of the page (Playwright's
  cache or `PUBLISH_BROWSER`), cropped to the header, hero and stat tiles. With no browser the old image stays.
- **Pushes never prompt.** They use `github_known_hosts` (GitHub's host keys from `gh api meta`) through
  `GIT_SSH_COMMAND`, so no `~/.ssh/known_hosts` is needed. If GitHub rotates its keys:
  `gh api meta --jq '.ssh_keys[]' | sed 's/^/github.com /' > github_known_hosts`.
- `.gitignore` keeps out `.venv/`, `logs/`, `runs/latest` (an absolute symlink) and verbatim third-party captures
  (`projections/*/raw/`, `senate_rsc.txt`, `raw/TQV.js`). They stay on disk. Don't force-add them: they are DDHQ's and the
  vendor's pages and code, and the repo is meant to be public.
- Your own `git push` also goes over SSH. `Host key verification failed` there means this machine has never trusted
  GitHub's host key: `gh api meta --jq '.ssh_keys[]' | sed 's/^/github.com /' >> ~/.ssh/known_hosts`.
- Size: a full results pull is ~5 MB, so election night adds a few hundred MB of archives to the repo.

---

## 13. Validators

Two validators check every pull: the **source validator** (*did it pull?*) and the **data validator** (*do the numbers make
sense?*). `after_pull.py` starts them after each pull, detached behind `logs/.validate.lock` (so a pull never waits, §2), and
the publisher waits for them so an alert lands in the same commit as the data it is about. Code: `validate.py` (engine,
alerts, watchdog), `validate_checks.py` (source checks, metrics, schedule), `validate_data.py` (data checks).

**Tiers.** 1 CRITICAL look now, 2 WARNING look soon, 3 NOTICE good to know. Size sets the tier, never whether it is flagged:
a count that went down is flagged at any size.

| Count that fell by d (from p) | Tier |
|---|---|
| votes: d >= 500, or d >= 50 and 2% of p | 1 |
| votes: d >= 10 | 2 |
| votes: smaller | 3 |
| ballots (hourly turnout totals): d >= 2000, or d >= 200 and 2% of p / d >= 50 / smaller | 1 / 2 / 3 |

The thresholds are `vote_tier` and `ballot_tier` in `validate_checks.py`. A pile of 10+ small drops in one place is raised to 2;
a statewide total is at least 2. Tune them there and re-run `--selftest`.

**What is compared.** Everything the pipeline saves, with one generic comparer (`table_events`): the state feed's per-county
votes, every county contest, county status and turnout, every precinct file (fast and slow), the turnout tables, and the
forecasts and calls. Findings are grouped (per race and county; per county for precincts and turnout), and a table that
produces more than 25 groups collapses to one alert per source. **Nothing is dropped:** every row behind an alert is in
`validation/<run>/findings.csv`.

| Check | Fires on | Tier |
|---|---|---|
| `votes_down` / `ballots_down` | a count fell between two pulls | by size |
| `parts_down` | a part (early, mail, ...) fell while its total held | 3 |
| `value_blanked` | a number became blank | 2 |
| `rows_missing` | rows vanished; tier by the votes they carried | 2 or by size |
| `shape_changed` | half a table vanished in one pull | 1 |
| `rows_rekeyed` | keys changed but the numbers carried over (Broward's location ids did this) | 3 |
| `rows_new` | new rows, one notice per table (counties coming online) | 3 |
| `negative_value`, `exceeds_ballots`, `total_mismatch`, `parts_mismatch`, `pct_mismatch` | within one pull: negative, more votes than ballots, statewide != county sum, total != parts, percent wrong | 1 / 1-2 / 2 / 3 / 3 |
| `precincts_regressed`, `count_changed` | precincts reporting went backwards; a denominator moved | 1-2 / 2-3 |
| `prob_out_of_range`, `prob_sum_off`, `prob_jump`, `two_winners`, `call_made`, `call_retracted` | forecasts and calls | 1, 2, 2-3, 1, 3, 1 |
| source: `table_missing`, `table_short`, `contests_short` | a state-site table is missing, empty or short | 1 / 2 |
| source: `county_site_failed`, `county_sites_failed` | a county results site failed; 10 or 25% at once | 2 / 1 |
| source: `precinct_file_lost`, `precinct_file_short`, `precinct_file_corrupt` | a county that had a precinct file lost, truncated or broke it | 2 |
| source: `wrong_election` | an election date that is not 11/3/2026, or primary contests | 1 |
| source: `source_down`, `race_pages_failed`, `markets_short` | DDHQ down (1: it is the only call authority); Kalshi/Polymarket down (2) | 1 / 2 |
| source: `county_feeds_failed`, `counties_short`, `feed_stale`, `counties_stale` | turnout feeds; staleness is measured from poll open | 1-3 |
| source: `county_stalled` | a county that had started reporting has not moved for 3 pulls (T3) or 6 (T2) | 3 / 2 |
| source: `pull_gap`, `pull_missing`, `pull_stuck`, `site_stale` | a scheduled pull never ran; never arrived; never finished; the site is 20+ min behind | 1-2 |
| `validator_error` | a validator crashed. It says so and the other still runs | 2 |

**Baselines are the pipeline's own high-water marks**, kept in `validation/state.json`, so a count that only ever grows (county
sites that come online) is never an alarm for growing, and a county that never had a precinct file is not an alarm for lacking
one. On the first run the validators learn the history and judge only the latest pull.

**Two kinds of alert.** An *event* is a change between two pulls (`votes_down`); it is raised once. A *condition* stays true
until fixed (`county_site_failed`); it is raised once, escalated one tier after 3 pulls, and cleared when it goes. Alerts
`raised`, `escalated` and `cleared` are rows in `validation/alerts.csv`.

**Files** (all under `validation/`; none of it touches `runs/`, `results/` or `projections/`, and the viewer only reads it):

| File | What |
|---|---|
| `alerts.csv` | append-only: `alert_id,event,raised_local,raised_utc,tier,validator,kind,source,scope,headline,detail,prev,curr,delta,count,snapshot,prev_snapshot,fingerprint,first_seen` |
| `<run>/findings.csv` | write-once: `fingerprint,tier,validator,kind,scope,snapshot,key,column,prev,curr,delta` for every row behind an alert |
| `runs.csv` | append-only: one row per validator run |
| `current.json` | overwritten mirror: open conditions plus events from the last 3 hours, counts by tier, `status` (clear / notice / warning / critical) |
| `state.json` | overwritten: the validators' memory (high-water marks, open alerts, last validated pull per kind) |

A snapshot is only validated once it is in its `INDEX.csv` (the collectors append that last), so a half-written pull is never read.

**Notifications.** A new tier 1 or 2 alert pops one desktop notification per run (`notify-send`). `touch logs/.validate_quiet` mutes it
with nothing to restart (`rm` to unmute); `VALIDATE_NOTIFY=0` mutes a single command. Muting only silences the popup: the alert is still
logged and still on the site.

**The watchdog** (`validate.py --watch`, a loop; start it with `nohup`; only one runs at a time, and it retires itself 40 minutes
after the last scheduled pull, so it is never left running for days) is the only thing that can see a pull that never
happened: it raises `pull_missing` for a scheduled slot with no pull (the schedule is ported from `phase_for()` and
`--selftest` diffs it against `election_day.sh` for every minute), `pull_stuck` for a pull that started and never finished,
and `site_stale`. It is silent outside the election window. It also validates any pull whose after-pull ask never came.

**The site.** `build_viewer.py` reads `validation/current.json` and `alerts.csv` through `snapshots.load_checks()` (which returns
`None`, never raises) into `payload["checks"]`. The viewer shows a *Data checks* card first in Snapshots → Pipeline health and
a chip in the Overview status strip. Tiers use text labels and border weight as well as color, never the party colors (§7.6).

**Rules.** Validators read snapshots and write only `validation/` and `logs/`. A validator that cannot run must never delay or
fail a pull. After changing any `validate*.py`, run `validate.py --selftest` (it runs 41 checks on a copy of the real history
and checks the right alert fires, a clean pull stays silent, and the schedule matches). To add a check: write it as a function that
returns findings, call it from `source_checks` or `data_checks`, and add a scenario to `validate_selftest.py`.
