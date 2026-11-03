/* ---------- projections: forecasts, market prices and race calls ----------
   Predictions, not votes. Nothing here is ever added to a vote count; the page keeps the two side by side.
   Sources: DDHQ (a forecast model plus the official race call), Kalshi and Polymarket (prediction markets). */
const PJ = D.projections || null;
const HAS_PROJ = !!(PJ && PJ.races.length && PJ.snaps.length);
const PSNAPS = PJ ? PJ.snaps : [], PLAST = PSNAPS.length - 1;
const PJR = PJ ? PJ.races : [];
const PSRC_NAME = ['DDHQ forecast', 'Kalshi market', 'Polymarket market'], PSRC_SHORT = ['DDHQ', 'Kalshi', 'Polymarket'], PSRC_KIND = ['model', 'market', 'market'];
const PJ_BY_RID = new Map();
PJR.forEach((r, i) => { r.i = i; if (r.rid) PJ_BY_RID.set(r.rid, i); });
const pjIndexOf = race => race ? (PJ_BY_RID.get(race.id) ?? null) : null;           // a results race -> its forecast, if any
const hasForecast = race => pjIndexOf(race) != null;
const pjSurname = n => { const t = String(n || '').replace(/\s+/g, ' ').trim().split(' '); return t.length ? t[t.length - 1] : ''; };
const sideName = side => side.n ? pjSurname(side.n) : (side.p === 'REP' ? 'Republican' : side.p === 'DEM' ? 'Democratic' : side.p || 'Other');

/* probability[source][side] for one forecast race in one pull; null where a source does not cover it */
const pjCache = new Map();
function pjProbs(pi, s = PLAST) {
  const key = pi * 1000 + s; if (pjCache.has(key)) return pjCache.get(key);
  const R = PJR[pi], out = PJ.src.map(() => R.sides.map(() => null));
  for (const [ri, si, src, p] of (PJ.pred[s] || [])) if (ri === pi) out[src][si] = p;
  pjCache.set(key, out); return out;
}
const pjSources = (pi, s = PLAST) => pjProbs(pi, s).map((arr, src) => ({ src, arr })).filter(x => x.arr.some(v => v != null));
/* the headline forecast: DDHQ's model when it has the race, otherwise whichever market does */
function pjFavorite(pi, s = PLAST, only = null) {
  const have = pjSources(pi, s).filter(x => only == null || x.src === only); if (!have.length) return null;
  const h0 = have[0], P = h0.arr; let side = -1;
  P.forEach((v, i) => { if (v != null && (side < 0 || v > P[side])) side = i; });
  return { src: h0.src, side, p: P[side], sideObj: PJR[pi].sides[side], tag: pjTag(P[side]) };
}
/* Solid / Likely / Lean / Toss-up: common forecasting words, so the percentage has a plain-English handle */
const pjTag = p => p >= .95 ? 'Safe' : p >= .8 ? 'Likely' : p >= .6 ? 'Leans' : 'Toss-up';
/* widest gap, in points, between sources for the favorite's side */
function pjSpread(pi, s = PLAST) {
  const f = pjFavorite(pi, s); if (!f) return null;
  const vals = pjProbs(pi, s).map(a => a[f.side]).filter(v => v != null); return vals.length > 1 ? 100 * (Math.max(...vals) - Math.min(...vals)) : null;
}
/* DDHQ's call. at is when it called the race, in UTC. */
function pjCall(pi, s = PLAST) {
  const c = (PJ.calls[s] || []).find(x => x[0] === pi); if (!c) return null;
  return { side: c[1], at: c[2], name: c[3], party: c[4] };
}
const pjDetail = pi => (PJ.latest ? PJ.latest.rows : []).filter(r => r[0] === pi);        // [race, side, src, prob, price, bid, ask, volume, updated]
const pjTally = pi => PJ.latest && PJ.latest.dd ? PJ.latest.dd[pi] || null : null;       // DDHQ's own precincts in / total, not our count
const pjUpdated = (pi, src) => { const r = pjDetail(pi).find(x => x[2] === src && x[8]); return r ? r[8] : ''; };
const pjVolume = (pi, src) => { const v = pjDetail(pi).filter(x => x[2] === src && x[7] != null).map(x => x[7]); return v.length ? Math.max(...v) : null; };
const fMoney = n => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${Math.round(n)}`;
const fProb = p => p >= .995 ? '>99%' : p <= .005 ? '<1%' : `${(100 * p).toFixed(p < .1 || p > .9 ? 1 : 0).replace(/\.0$/, '')}%`;
const pjParty = side => PARTY_COLOR[side.p] || 'var(--oth)';
const pjSideColor = side => side.p ? (PARTY_COLOR[side.p] || 'var(--oth)') : 'var(--oth)';
const callTime = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : fmtDayClock(d.toISOString()) + ' ET'; };
/* how the count so far compares with the forecast favorite: the one place the two meet */
function pjVsCount(pi, s = RLAST) {
  const R = PJR[pi]; if (!R.rid || !HAS_RESULTS) return null;
  const race = RACE_BY_ID.get(R.rid), f = pjFavorite(pi); if (!race || !f) return null;
  const sm = raceSum(race, -1, s); if (!sm || !sm.total) return { state: 'waiting', race };
  const k = f.sideObj.k; if (k < 0) return { state: 'unknown', race, sm };
  return { state: sm.lead === k ? 'agrees' : sm.lead < 0 ? 'tied' : 'disagrees', race, sm, k };
}
