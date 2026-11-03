#!/usr/bin/env python3
"""Find each county's Clarity ENR election id for the 2026 general.

Many Florida counties publish on the shared Clarity host, either
enr.electionsfl.org/<CODE>/<id>/ or results.enr.clarityelections.com/FL/<Name>/<id>/.
The id is not predictable, so this script:

  1. reuses ids already found by scraping county homepages
  2. probes the shared host over a plausible id range for the rest
  3. keeps any county already present in the config unless asked to re-probe

Writes raw/enr_ids.json: {COUNTY_CODE: {"id": "...", "base": "https://..."}}
"""
import json, os, re, sys
import requests
import concurrent.futures as cf

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "raw", "enr_ids.json")
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}
BASE = "https://enr.electionsfl.org"
RANGE = range(int(os.environ.get("ENR_MIN", "4000")),
              int(os.environ.get("ENR_MAX", "4140")) + 1)

CODES = ("ALA BAK BAY BRA BRE BRO CAL CHA CIT CLA CLL CLM DES DIX DUV ESC FLA FRA GAD GIL "
         "GLA GUL HAM HAR HEN HER HIG HIL HOL IND JAC JEF LAF LAK LEE LEO LEV LIB MAD MAN "
         "MRN MRT DAD MON NAS OKA OKE ORA OSC PAL PAS PIN POL PUT SAN SAR SEM STJ STL SUM "
         "SUW TAY UNI VOL WAK WAL WAS").split()


def load():
    if os.path.exists(CFG):
        raw = json.load(open(CFG))
        out = {}
        for k, v in raw.items():
            out[k] = v if isinstance(v, dict) else {"id": str(v), "base": BASE}
        return out
    return {}


def probe(args):
    code, i = args
    try:
        r = requests.get(f"{BASE}/{code}/{i}/Summary/", headers=H, timeout=15,
                         allow_redirects=False)
        if r.status_code == 200 and "Election Night Reporting" in r.text:
            # must be the general, not the primary or a municipal election
            if "11/3/2026" in r.text or "11/03/2026" in r.text:
                return code, i
    except Exception:
        return None
    return None


def main():
    have = load()
    # validate anything already configured
    bad = []
    for c in list(have):
        cfg = have[c]
        base = cfg.get("base", BASE).rstrip("/")
        try:
            r = requests.get(f"{base}/{c}/{cfg['id']}/Summary/", headers=H, timeout=15)
            ok = r.status_code == 200 and ("11/3/2026" in r.text or "11/03/2026" in r.text)
        except Exception:
            ok = False
        if not ok:
            bad.append(c)
            have.pop(c)
    if bad:
        print(f"dropped {len(bad)} stale/non-general ids: {', '.join(bad)}")
    missing = [c for c in CODES if c not in have]
    print(f"known: {len(have)}  missing: {len(missing)}")
    if missing:
        jobs = [(c, i) for c in missing for i in RANGE]
        print(f"probing {len(jobs):,} urls...")
        found = {}
        with cf.ThreadPoolExecutor(24) as ex:
            for res in ex.map(probe, jobs):
                if res and res[0] not in found:
                    found[res[0]] = res[1]
                    print(f"  {res[0]} -> {res[1]}", flush=True)
        for c, i in found.items():
            have[c] = {"id": str(i), "base": BASE}

    json.dump(have, open(CFG, "w"), indent=1, sort_keys=True)
    print(f"\n{len(have)}/67 counties configured")
    left = [c for c in CODES if c not in have]
    if left:
        print("not on the shared Clarity host:", ", ".join(left))


if __name__ == "__main__":
    main()
