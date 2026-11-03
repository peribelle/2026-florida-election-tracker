/* ---------- derived data: pure computation, no DOM ---------- */
const C = D.counties, N = C.length;
const ELECTION = D.meta.election;

/* statewide totals */
const ST = { reg: 0, total: 0, mail: 0, early: 0, ed: 0, prov: 0 };
for (const c of C) for (const k in ST) ST[k] += c[k];
ST.rate = 100 * ST.total / ST.reg;
const HAS_ED = ST.ed > 0;

/* tiers by county size (active registered voters) */
const TIERS = [
  { label: 'Small', range: 'under 30K', max: 30000 },
  { label: 'Medium', range: '30K–150K', max: 150000 },
  { label: 'Large', range: '150K–500K', max: 500000 },
  { label: 'Giant', range: '500K+', max: Infinity },
];
const tierOf = reg => TIERS.findIndex(t => reg < t.max);

/* parties: three named groups + everyone else (minor parties, unknown) */
const PARTIES = [
  { k: 'REP', name: 'Republican', who: 'Republicans', short: 'Rep', color: 'var(--rep)' },
  { k: 'DEM', name: 'Democratic', who: 'Democrats', short: 'Dem', color: 'var(--dem)' },
  { k: 'NPA', name: 'No party (independent)', who: 'No-party voters', short: 'NPA', color: 'var(--npa)' },
  { k: 'OTH', name: 'Minor parties', who: 'Minor-party voters', short: 'Minor', color: 'var(--oth)' },
];
for (const g of PARTIES) {
  g.reg = sum(C.map(c => c.p[g.k][0])); g.bal = sum(C.map(c => c.p[g.k][1]));
  g.mail = sum(C.map(c => c.p[g.k][2])); g.early = sum(C.map(c => c.p[g.k][3])); g.ed = sum(C.map(c => c.p[g.k][4]));
  g.rate = 100 * g.bal / g.reg;
}
const PREG = sum(PARTIES.map(g => g.reg)), PBAL = sum(PARTIES.map(g => g.bal));
for (const g of PARTIES) { g.shareReg = 100 * g.reg / PREG; g.shareBal = 100 * g.bal / PBAL; }
const PARTY = Object.fromEntries(PARTIES.map(g => [g.k, g]));

/* counties: rates, gaps, ranks */
C.forEach((c, i) => {
  c.i = i; c.rate = 100 * c.total / c.reg; c.tier = tierOf(c.reg);
  const inPerson = c.mail + c.early + c.ed;
  c.mailShare = inPerson ? 100 * c.mail / inPerson : 0;
  c.repRate = 100 * c.p.REP[1] / c.p.REP[0]; c.demRate = 100 * c.p.DEM[1] / c.p.DEM[0];
  c.gap = c.repRate - c.demRate;
});
const BY_RATE = [...C].sort((a, b) => b.rate - a.rate);
BY_RATE.forEach((c, i) => { c.rank = i + 1; });
const BY_FIPS = Object.fromEntries(C.map(c => [c.fips, c]));
const COUNTY_RATES = C.map(c => c.rate);

/* a continuous day axis (the feeds skip days with no ballots) */
const DAYS = [];
for (let d = D.dates[0]; d <= D.dates[D.dates.length - 1]; d = addDays(d, 1)) DAYS.push(d);
const dataIdx = new Map(D.dates.map((d, i) => [d, i]));
const ZERO4 = [0, 0, 0, 0];
const CDAY = C.map((_, ci) => DAYS.map(d => { const i = dataIdx.get(d); return i == null ? ZERO4 : D.daily[ci][i]; }));
const DAY = DAYS.map((iso, k) => {
  let m = 0, e = 0, x = 0, p = 0;
  for (const cd of CDAY) { const v = cd[k]; m += v[0]; e += v[1]; x += v[2]; p += v[3]; }
  return { ...dinfo(iso), mail: m, early: e, ed: x, prov: p, total: m + e + x + p };
});
const START = Math.max(0, DAY.findIndex(d => d.total >= 1000));       // charts start once voting is under way
const CUM = { mail: [], early: [], ed: [], total: [] };
{ let a = 0, b = 0, c = 0, t = 0; for (const d of DAY) { a += d.mail; b += d.early; c += d.ed; t += d.total; CUM.mail.push(a); CUM.early.push(b); CUM.ed.push(c); CUM.total.push(t); } }
const PEAK = DAY.reduce((best, d) => d.total > best.total ? d : best, DAY[0]);
const EV_OPEN = DAY.find(d => d.early >= 1000);
const EV_LAST = [...DAY].reverse().find(d => d.early > 0);
CDAY.forEach((cd, i) => { C[i].day = cd.map(v => v[0] + v[1] + v[2] + v[3]); });
/* busiest and quietest weekday, judged over the early-voting window so each weekday appears equally often */
const WDSTAT = (() => {
  const acc = Array.from({ length: 7 }, () => ({ n: 0, t: 0 }));
  for (const d of DAY) if (EV_OPEN && EV_LAST && d.iso >= EV_OPEN.iso && d.iso <= EV_LAST.iso) { acc[d.dow].n++; acc[d.dow].t += d.total; }
  const avg = acc.map(a => a.n ? a.t / a.n : null), ok = avg.map((v, i) => i).filter(i => avg[i] != null);
  const best = ok.reduce((b, i) => avg[i] > avg[b] ? i : b, ok[0]), worst = ok.reduce((b, i) => avg[i] < avg[b] ? i : b, ok[0]);
  return { avg, best, worst };
})();

/* precincts. The 50-voter floor keeps one-family precincts from dominating rates. */
const PC = D.precincts;
const PR = [], PRF = [];
let over100 = 0;
for (let i = 0; i < PC.r.length; i++) {
  const r = PC.r[i], rate = r ? 100 * PC.t[i] / r : NaN;
  const row = { c: PC.c[i], k: PC.k[i], r, t: PC.t[i], m: PC.m[i], e: PC.e[i], rate };
  if (r >= 50) PR.push(row);
  if (r >= 10) { if (rate <= 100) PRF.push(row); else over100++; }
}

/* early-voting sites */
const SITES = D.sites.filter(x => x.t > 0).map(x => ({ ...x, name: niceName(x.n), county: C[x.c].name, lib: /\blib/i.test(x.n) }));

/* time of the snapshot, in Eastern time */
const ET = { timeZone: 'America/New_York' };
const stampET = iso => iso ? new Intl.DateTimeFormat('en-US', { ...ET, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) + ' ET' : '';
function etDate(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { ...ET, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const SNAP = D.meta.feedLatest || D.meta.generated;
const SNAP_DAY = etDate(SNAP);
const DAYS_TO_GO = Math.round((dinfo(ELECTION).ms - dinfo(SNAP_DAY).ms) / 864e5);
const electionPhase = DAYS_TO_GO > 1 ? `Election Day is in ${DAYS_TO_GO} days` : DAYS_TO_GO === 1 ? 'Election Day is tomorrow'
  : DAYS_TO_GO === 0 ? 'Election Day is today' : 'Election Day has passed';

/* the county everyone is looking at */
const selection = {
  i: null, subs: [],
  set(i) { if (i === this.i) return; this.i = i; this.subs.forEach(f => f(i)); },
  on(f) { this.subs.push(f); },
};

/* small shared tooltip helpers */
const typeRows = (m, e, x) => [
  { color: 'var(--mail)', label: 'Mail', value: fInt(m) },
  { color: 'var(--early)', label: 'Early voting', value: fInt(e) },
  ...(HAS_ED || x ? [{ color: 'var(--ed)', label: 'Election Day', value: fInt(x) }] : []),
];
const typeLegend = () => [
  { color: 'var(--mail)', label: 'Mail' }, { color: 'var(--early)', label: 'Early voting' },
  ...(HAS_ED ? [{ color: 'var(--ed)', label: 'Election Day' }] : []),
];


/* ---------- scope helpers: every turnout chart can answer for Florida or for one county ---------- */
const scopeCi = () => selection.i;
function totalsFor(ci) {                              // {reg, total, mail, early, ed, prov, rate}
  if (ci == null) return ST;
  const c = C[ci]; return { reg: c.reg, total: c.total, mail: c.mail, early: c.early, ed: c.ed, prov: c.prov, rate: c.rate };
}
function partyStatsFor(ci) {                          // the PARTIES shape, for one county (or the state)
  if (ci == null) return PARTIES;
  const c = C[ci], regT = sum(PARTIES.map(g => c.p[g.k][0])), balT = sum(PARTIES.map(g => c.p[g.k][1]));
  return PARTIES.map(g => { const [reg, bal, mail, early, ed] = c.p[g.k]; return { ...g, reg, bal, mail, early, ed, rate: reg ? 100 * bal / reg : 0, shareReg: regT ? 100 * reg / regT : 0, shareBal: balT ? 100 * bal / balT : 0 }; });
}
function peakOf(rows) { return rows.reduce((b, d) => d.total > b.total ? d : b, rows[0]); }
function weekdayStats(rows) {                         // judged over the early-voting window so each weekday appears equally often
  const acc = Array.from({ length: 7 }, () => ({ n: 0, t: 0 }));
  for (const d of rows) if (EV_OPEN && EV_LAST && d.iso >= EV_OPEN.iso && d.iso <= EV_LAST.iso) { acc[d.dow].n++; acc[d.dow].t += d.total; }
  const avg = acc.map(a => a.n ? a.t / a.n : null), ok = avg.map((v, i) => i).filter(i => avg[i] != null);
  if (!ok.length) return { avg, best: 0, worst: 0 };
  return { avg, best: ok.reduce((b, i) => avg[i] > avg[b] ? i : b, ok[0]), worst: ok.reduce((b, i) => avg[i] < avg[b] ? i : b, ok[0]) };
}
const cumulativeOf = rows => { const o = { mail: [], early: [], ed: [], total: [] }; let a = 0, b = 0, c = 0, t = 0; for (const d of rows) { a += d.mail; b += d.early; c += d.ed; t += d.total; o.mail.push(a); o.early.push(b); o.ed.push(c); o.total.push(t); } return o; };
/* counties most like this one in size, for "peers" views */
const peersOf = (ci, k = 11) => [...C].filter(c => c.i !== ci).sort((a, b) => Math.abs(Math.log(a.reg / C[ci].reg)) - Math.abs(Math.log(b.reg / C[ci].reg))).slice(0, k);
const rankOfMetric = (ci, get, desc = true) => 1 + C.filter(c => desc ? get(c) > get(C[ci]) : get(c) < get(C[ci])).length;
