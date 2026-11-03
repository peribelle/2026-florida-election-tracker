#!/usr/bin/env python3
"""Fill in Broward's Election Day count from the state's own page while Broward's dashboard is down.

Broward's TED dashboard is a separate site and fails on its own (election morning: "No dashboard loaded"). When it is down,
collect_broward.py keeps Broward's last complete numbers, frozen at the last good collection, so statewide turnout is missing every
Election Day ballot Broward has taken since. The state publishes live Election Day turnout for every county, with a last-reported
time, at https://floridaelectionwatch.gov/ElectionDayTurnout. This reads Broward's figure from there and writes
data/broward/blend.json. It changes no data itself: normalize.py reads blend.json and uses it for exactly two numbers, Broward's
ElectionDay ballots (by_type) and Election Day's daily row (by_date). Party, precinct and location detail stay frozen, because the
state page has only a total, and nothing is estimated or spread across parties.

It only blends while Broward's own collection is stale. When the dashboard is healthy blend.json says active=false and nothing
changes. The figure is the larger of the state's and the frozen dashboard's, so a blend can only ever add Election Day ballots.

This is its own step with its own failure domain: if the state page is down or changes shape, blend.json says active=false with the
error, the run carries Broward over exactly as it did before, and no other county is touched.

Exit status 0 unless the state's page could not be read or parsed.
"""
import csv, json, os, sys, time
from datetime import datetime, timedelta
import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
BRO = os.path.join(HERE, "data", "broward")
URL = "https://floridaelectionwatch.gov/ElectionDayTurnout"
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
     "Accept": "text/html"}
FRESH_MIN = 15            # Broward's own collection counts as healthy if it is at most this many minutes old


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%S")


def load(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def write(obj):
    os.makedirs(BRO, exist_ok=True)
    tmp = os.path.join(BRO, "blend.json.tmp")
    with open(tmp, "w") as fh:
        json.dump(obj, fh, indent=1)
    os.replace(tmp, os.path.join(BRO, "blend.json"))


def dashboard_election_day():
    """Election Day ballots in Broward's own (possibly frozen) numbers."""
    try:
        with open(os.path.join(BRO, "by_type.csv")) as fh:
            for r in csv.DictReader(fh):
                if r["ballot_type"] == "ElectionDay":
                    return int(r["ballots"])
    except (OSError, ValueError, KeyError):
        pass
    return 0


def fetch(tries=2):
    last = None
    for i in range(tries):
        try:
            r = requests.get(URL, headers=H, timeout=25)
            r.raise_for_status()
            return r.text
        except requests.RequestException as e:
            last = e
            time.sleep(2)
    raise last


def parse(html, now):
    """Broward's (turnout, reported_at) from the state's table. Raises if the row is missing, blank or not Eastern time."""
    for tr in BeautifulSoup(html, "lxml").find_all("tr"):
        c = [x.get_text(" ", strip=True) for x in tr.find_all(["td", "th"])]
        if c and c[0].strip().upper() == "BROWARD":
            if len(c) < 4 or not c[1].strip():
                raise ValueError("the state's page has no Election Day turnout for Broward yet")
            if c[3].strip().lower() != "eastern":
                raise ValueError(f"unexpected time zone {c[3]!r} for Broward")
            turnout = int(c[1].replace(",", ""))
            at = datetime.strptime(c[2].strip(), "%I:%M %p")
            reported = datetime.combine(now.date(), at.time())
            if reported > now + timedelta(minutes=5):          # a time that has not happened yet today was last night's
                reported -= timedelta(days=1)
            return turnout, reported
    raise ValueError("no Broward row on the state's Election Day turnout page")


def run(now=None):
    now = now or datetime.now()
    status = load(os.path.join(BRO, "status.json")) or {}
    collected = status.get("data_collected_at")
    if status.get("ok") and collected:
        if (now - datetime.fromisoformat(collected)).total_seconds() / 60 <= FRESH_MIN:
            write({"active": False, "reason": "Broward's dashboard is healthy; nothing to blend", "checked_at": iso(now)})
            print("Broward's dashboard is healthy; nothing to blend")
            return 0
    try:
        turnout, reported = parse(fetch(), now)
    except Exception as e:
        write({"active": False, "error": f"{type(e).__name__}: {str(e)[:200]}", "checked_at": iso(now)})
        print(f"!! the state's page could not supply Broward's Election Day count ({type(e).__name__}: {str(e)[:120]}); Broward is carried over unchanged")
        return 1
    election = os.environ.get("ELECTION_DATE", "2026-11-03")
    frozen = dashboard_election_day()
    if reported.date().isoformat() != election:
        write({"active": False, "reason": f"the state's figure was last reported {reported:%Y-%m-%d %H:%M}, not on Election Day", "checked_at": iso(now)})
        print("the state's Broward figure is not from Election Day; nothing blended")
        return 0
    if turnout <= frozen:
        write({"active": False, "reason": f"the state's figure ({turnout:,}) is no higher than the dashboard's ({frozen:,})", "checked_at": iso(now)})
        print("the state's Broward figure adds nothing to the dashboard's; nothing blended")
        return 0
    write({"active": True, "election_day": turnout, "dashboard_election_day": frozen, "reported_at": iso(reported), "fetched_at": iso(now),
           "date": reported.strftime("%m/%d/%Y"), "source": URL,
           "basis": "county-reported Election Day turnout from the state's page; the party, precinct and location detail are NOT updated"})
    print(f"Broward Election Day ballots: {turnout:,} from the state's page, reported {reported:%H:%M} (dashboard frozen at {frozen:,}); blended in")
    return 0


if __name__ == "__main__":
    sys.exit(run())
