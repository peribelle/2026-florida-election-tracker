#!/usr/bin/env python3
"""Pull live unofficial turnout for all 67 Florida counties from VR Systems TQV."""
import json, os, time, requests, concurrent.futures as cf

BASE = "https://s3.amazonaws.com/turnoutquickview.electionsfl.org/data/FL/{}/{}/data.json"
IDX = "https://s3.amazonaws.com/turnoutquickview.electionsfl.org/data/FL/{}/index.json"
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"}
RAW = os.path.join(os.path.dirname(__file__), "raw", "tqv")
os.makedirs(RAW, exist_ok=True)

COUNTIES = {
 "ALA":"Alachua","BAK":"Baker","BAY":"Bay","BRA":"Bradford","BRE":"Brevard","BRO":"Broward",
 "CAL":"Calhoun","CHA":"Charlotte","CIT":"Citrus","CLA":"Clay","CLL":"Collier","CLM":"Columbia",
 "DES":"DeSoto","DIX":"Dixie","DUV":"Duval","ESC":"Escambia","FLA":"Flagler","FRA":"Franklin",
 "GAD":"Gadsden","GIL":"Gilchrist","GLA":"Glades","GUL":"Gulf","HAM":"Hamilton","HAR":"Hardee",
 "HEN":"Hendry","HER":"Hernando","HIG":"Highlands","HIL":"Hillsborough","HOL":"Holmes",
 "IND":"Indian River","JAC":"Jackson","JEF":"Jefferson","LAF":"Lafayette","LAK":"Lake","LEE":"Lee",
 "LEO":"Leon","LEV":"Levy","LIB":"Liberty","MAD":"Madison","MAN":"Manatee","MRN":"Marion",
 "MRT":"Martin","DAD":"Miami-Dade","MON":"Monroe","NAS":"Nassau","OKA":"Okaloosa",
 "OKE":"Okeechobee","ORA":"Orange","OSC":"Osceola","PAL":"Palm Beach","PAS":"Pasco",
 "PIN":"Pinellas","POL":"Polk","PUT":"Putnam","SAN":"Santa Rosa","SAR":"Sarasota",
 "SEM":"Seminole","STJ":"St. Johns","STL":"St. Lucie","SUM":"Sumter","SUW":"Suwannee",
 "TAY":"Taylor","UNI":"Union","VOL":"Volusia","WAK":"Wakulla","WAL":"Walton","WAS":"Washington",
}

TARGET_DATE = "11/03/2026"

def get(url, tries=3):
    for i in range(tries):
        try:
            r = requests.get(url, headers=H, timeout=40)
            if r.status_code == 200:
                return r
            if r.status_code == 404:
                return r
        except Exception:
            pass
        time.sleep(1.5 * (i + 1))
    return r if 'r' in dir() else None

def collect(code):
    """Return dict with status + chosen election data."""
    out = {"code": code, "county": COUNTIES[code]}
    r = get(IDX.format(code))
    if not r or r.status_code != 200:
        out["status"] = "no_index"
        return out
    nums = json.loads(r.text)
    out["election_numbers"] = nums
    found = None
    for n in nums:
        rr = get(BASE.format(code, n))
        if not rr or rr.status_code != 200:
            continue
        try:
            d = rr.json()
        except Exception:
            continue
        s = d.get("Summary", {})
        if s.get("ElectionDate") == TARGET_DATE:
            found = (n, d)
            break
    if not found:
        out["status"] = "no_2026_general"
        return out
    n, d = found
    out["status"] = "ok"
    out["election_number"] = n
    fn = os.path.join(RAW, f"{code}_{n}.json")
    with open(fn, "w") as f:
        json.dump(d, f)
    out["file"] = fn
    out["summary"] = d.get("Summary", {})
    return out

if __name__ == "__main__":
    results = []
    with cf.ThreadPoolExecutor(6) as ex:
        for res in ex.map(collect, list(COUNTIES)):
            results.append(res)
            s = res["status"]
            nm = res["summary"].get("CountyName", "") if s == "ok" else ""
            print(f'{res["county"]:14s} {s:18s} {nm}', flush=True)
    json.dump(results, open(os.path.join(os.path.dirname(__file__), "raw", "collect_log.json"), "w"), indent=1)
    ok = sum(1 for r in results if r["status"] == "ok")
    print(f"\nOK {ok}/{len(results)}")
