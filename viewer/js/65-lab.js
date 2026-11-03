/* ---------- the Data lab: any county measure against any other ----------
   A registry of county measures drives every card here, so adding a measure adds it to the scatter, the ranking, the map,
   the histogram and the correlation matrix at once. Every measure is computed from the same tables as the other views. */
const lcache = {};
const siteCount = c => SITES.filter(x => x.c === c.i).length;
const prByCounty = (() => { const m = C.map(() => []); PR.forEach(p => m[p.c].push(p.rate)); return m; })();
const lastDays = (() => { const i = DAY.indexOf(EV_LAST || DAY[DAY.length - 1]); return [i - 2, i - 1, i]; })();
const demGov = () => RACE_BY_ID.get('160000');
const METRICS = [
  { id: 'rate', g: 'Turnout', t: 'Turnout rate', get: c => c.rate, f: v => fPct(v), state: () => ST.rate },
  { id: 'total', g: 'Size', t: 'Ballots cast', get: c => c.total, f: fInt, fa: fComp, log: true },
  { id: 'reg', g: 'Size', t: 'Registered voters', get: c => c.reg, f: fInt, fa: fComp, log: true },
  { id: 'prec', g: 'Size', t: 'Precincts', get: c => c.precincts || 0, f: fInt, fa: fComp, log: true },
  { id: 'perPrec', g: 'Size', t: 'Registered voters per precinct', get: c => c.precincts ? c.reg / c.precincts : 0, f: fInt, fa: fComp },
  { id: 'mail', g: 'How they voted', t: 'Mail share of ballots', get: c => c.mailShare, f: v => fPct(v, 1), state: () => 100 * ST.mail / (ST.mail + ST.early + ST.ed) },
  { id: 'early', g: 'How they voted', t: 'Early in-person share', get: c => 100 * c.early / ((c.mail + c.early + c.ed) || 1), f: v => fPct(v, 1), state: () => 100 * ST.early / (ST.mail + ST.early + ST.ed) },
  ...(HAS_ED ? [{ id: 'ed', g: 'How they voted', t: 'Election Day share', get: c => 100 * c.ed / ((c.mail + c.early + c.ed) || 1), f: v => fPct(v, 1), state: () => 100 * ST.ed / (ST.mail + ST.early + ST.ed) }] : []),
  { id: 'repRate', g: 'Party', t: 'Republican turnout rate', get: c => c.repRate, f: v => fPct(v), state: () => PARTY.REP.rate },
  { id: 'demRate', g: 'Party', t: 'Democratic turnout rate', get: c => c.demRate, f: v => fPct(v), state: () => PARTY.DEM.rate },
  { id: 'npaRate', g: 'Party', t: 'No-party turnout rate', get: c => 100 * c.p.NPA[1] / (c.p.NPA[0] || 1), f: v => fPct(v), state: () => PARTY.NPA.rate },
  { id: 'gap', g: 'Party', t: 'Republican minus Democratic turnout rate', get: c => c.gap, f: v => `${fPts(v)} pts`, fa: v => fPts(v, 0), div: true, state: () => PARTY.REP.rate - PARTY.DEM.rate },
  { id: 'repReg', g: 'Party', t: 'Republicans, share of registered', get: c => 100 * c.p.REP[0] / sum(PARTIES.map(g => c.p[g.k][0])), f: v => fPct(v), state: () => PARTY.REP.shareReg },
  { id: 'demReg', g: 'Party', t: 'Democrats, share of registered', get: c => 100 * c.p.DEM[0] / sum(PARTIES.map(g => c.p[g.k][0])), f: v => fPct(v), state: () => PARTY.DEM.shareReg },
  { id: 'npaReg', g: 'Party', t: 'No-party voters, share of registered', get: c => 100 * c.p.NPA[0] / sum(PARTIES.map(g => c.p[g.k][0])), f: v => fPct(v), state: () => PARTY.NPA.shareReg },
  { id: 'lean', g: 'Party', t: 'Registration lean (Republican minus Democratic share)', get: c => regLean(c), f: v => `${fPts(v)} pts`, fa: v => fPts(v, 0), div: true },
  { id: 'sites', g: 'Places', t: 'Early-voting sites reporting', get: c => siteCount(c), f: fInt },
  { id: 'perSite', g: 'Places', t: 'Early ballots per site', get: c => { const s2 = SITES.filter(x => x.c === c.i); return s2.length ? sum(s2.map(x => x.t)) / s2.length : 0; }, f: fInt, fa: fComp },
  { id: 'prMed', g: 'Places', t: 'Median precinct turnout', get: c => prByCounty[c.i].length ? median(prByCounty[c.i]) : c.rate, f: v => fPct(v), state: () => median(PR.map(p => p.rate)) },
  { id: 'prIqr', g: 'Places', t: 'Spread of precinct turnout (middle half, points)', get: c => prByCounty[c.i].length > 3 ? iqr(prByCounty[c.i]) : 0, f: v => `${v.toFixed(1)} pts` },
  { id: 'peak', g: 'Timing', t: 'Share of ballots on the busiest day', get: c => { const rows = dayRows(c.i).slice(START); return c.total ? 100 * peakOf(rows).total / c.total : 0; }, f: v => fPct(v, 1) },
  { id: 'last3', g: 'Timing', t: 'Share cast in the last 3 days of early voting', get: c => c.total ? 100 * sum(lastDays.map(i => c.day[i] || 0)) / c.total : 0, f: v => fPct(v, 1) },
  { id: 'demGov', g: 'Results (after polls close)', t: 'Democratic share of the governor’s two-party vote', ok: () => anyResults() && !!demGov(), get: c => { const r = demGov(); return r ? (sideShare(r, c.i) ?? NaN) : NaN; }, f: v => fPct(v, 1) },
  { id: 'skipGov', g: 'Results (after polls close)', t: 'Share of ballots that skipped the governor’s race', ok: () => anyResults() && !!demGov(), get: c => { const r = demGov(); return r ? (undervoteOf(r, c.i) ?? NaN) : NaN; }, f: v => fPct(v, 1) },
];
const METRIC_BY_ID = new Map(METRICS.map(m => [m.id, m]));
const metricsNow = () => METRICS.filter(m => !m.ok || m.ok());
const mdef = id => METRIC_BY_ID.get(id) || METRICS[0];
function mvals(id) {                                         // one number per county, NaN where the measure does not apply
  const key = id + (mdef(id).ok ? ':' + RLAST : '');
  return lcache[key] || (lcache[key] = C.map(c => { const v = mdef(id).get(c); return typeof v === 'number' && isFinite(v) ? v : NaN; }));
}
const mclean = id => mvals(id).filter(v => !isNaN(v));
function mstat(id) { const v = mclean(id), m = mean(v), sd = Math.sqrt(sum(v.map(x => (x - m) ** 2)) / Math.max(v.length - 1, 1)); return { n: v.length, mean: m, sd: sd || 1, median: median(v), min: Math.min(...v), max: Math.max(...v) }; }
const mz = (id, ci) => { const v = mvals(id)[ci]; if (isNaN(v)) return null; const t = mdef(id).log ? Math.log10(Math.max(v, 1)) : v; const vs = mclean(id).map(x => mdef(id).log ? Math.log10(Math.max(x, 1)) : x), m = mean(vs), sd = Math.sqrt(sum(vs.map(x => (x - m) ** 2)) / Math.max(vs.length - 1, 1)) || 1; return (t - m) / sd; };
const mrank = (id, ci, desc = true) => { const v = mvals(id), me = v[ci]; return isNaN(me) ? null : 1 + v.filter(x => !isNaN(x) && (desc ? x > me : x < me)).length; };
function mcorr(a, b) {
  const A = mvals(a), B = mvals(b), xs = [], ys = [];
  C.forEach(c => { if (!isNaN(A[c.i]) && !isNaN(B[c.i])) { xs.push(mdef(a).log ? Math.log10(Math.max(A[c.i], 1)) : A[c.i]); ys.push(mdef(b).log ? Math.log10(Math.max(B[c.i], 1)) : B[c.i]); } });
  return xs.length > 3 ? linfit(xs, ys) : null;
}
const LAB = { x: 'reg', y: 'rate', rank: 'rate', rankDir: 'desc', map: 'rate', mapStyle: 'shapes', dist: 'rate', sim: null, precMin: 100, precDir: 'top' };
const labSelect = (label, value, onChange) => h('label', null, label, h('select', { class: 'field', 'aria-label': label, onchange: e => onChange(e.target.value) },
  [...new Set(metricsNow().map(m => m.g))].map(g => h('optgroup', { label: g }, metricsNow().filter(m => m.g === g).map(m => h('option', { value: m.id, ...(m.id === value ? { selected: true } : {}) }, m.t))))));
const ensureMetric = k => { if (!metricsNow().some(m => m.id === LAB[k])) LAB[k] = 'rate'; };

/* ---- 1. scatter lab ---- */
function drawLabScatter(host, w, api) {
  ['x', 'y'].forEach(ensureMetric);
  const X = mdef(LAB.x), Y = mdef(LAB.y), xs = mvals(LAB.x), ys = mvals(LAB.y);
  const pts = C.filter(c => !isNaN(xs[c.i]) && !isNaN(ys[c.i]) && (!X.log || xs[c.i] > 0) && (!Y.log || ys[c.i] > 0)).map(c => ({ x: xs[c.i], y: ys[c.i], label: c.name, hi: selection.i === c.i, always: selection.i === c.i, r: 5, click: () => selection.set(c.i),
    tip: () => tipContent(c.name, [{ label: X.t, value: X.f(xs[c.i]) }, { label: Y.t, value: Y.f(ys[c.i]) }], pickHint) }));
  if (pts.length < 4) { emptyCard(host, 'Not enough counties have both measures yet. Results-based measures fill in after polls close.'); api.label('No data yet.'); return; }
  const fit = kitScatter(host, w, pts, { xLog: !!X.log, yLog: !!Y.log, xFmt: X.fa || (v => X.f(v)), yFmt: Y.fa || (v => Y.f(v)), xLabel: X.t + (X.log ? ' (log scale)' : ''), yLabel: Y.t, fit: true, labelN: 5 });
  api.label(`Scatter plot of ${Y.t} against ${X.t} for ${pts.length} counties. Correlation ${fit ? fit.r.toFixed(2) : 'n/a'}.`);
}
function labScatterCard() {
  let api;
  const pickers = live(h('div', { class: 'pickers' }), () => h('div', { class: 'pickers', style: { display: 'contents' } }, labSelect('Across (x)', LAB.x, v => { LAB.x = v; api.redraw(); }), labSelect('Up (y)', LAB.y, v => { LAB.y = v; api.redraw(); }),
    h('button', { type: 'button', class: 'btn ghost', onclick: () => { [LAB.x, LAB.y] = [LAB.y, LAB.x]; api.redraw(); host2(); } }, 'Swap')));
  const host2 = () => (viewCache.lab ? viewCache.lab.live : []).forEach(i => i.run());
  api = card({
    id: 'lab-scatter', kicker: 'Scatter plot with trend line', cat: 'pearl', controls: [h('div', { class: 'pickers' }, pickers)],
    title: () => { ['x', 'y'].forEach(ensureMetric); const f = mcorr(LAB.x, LAB.y); return f ? `${mdef(LAB.y).t} against ${mdef(LAB.x).t.toLowerCase()}: r = ${f.r.toFixed(2)}` : 'Pick two measures'; },
    sub: 'One dot per county. Pick any two measures; the line is the best straight-line fit, and the selected county is labeled.',
    draw: drawLabScatter,
    notes: {
      what: 'A scatter plot asks whether two things move together. Here you choose both, from every measure in the lab.',
      how: 'Dots far above the line do better on the vertical measure than the horizontal one predicts; dots far below do worse. r near +1 or −1 means a tight line; near 0 means no straight-line link.',
      shows: () => { ['x', 'y'].forEach(ensureMetric); const f = mcorr(LAB.x, LAB.y); if (!f) return 'Not enough counties yet.'; const X = mvals(LAB.x), Y = mvals(LAB.y), tx = v => mdef(LAB.x).log ? Math.log10(Math.max(v, 1)) : v, ty = v => mdef(LAB.y).log ? Math.log10(Math.max(v, 1)) : v;
        const res = C.filter(c => !isNaN(X[c.i]) && !isNaN(Y[c.i])).map(c => ({ c, e: ty(Y[c.i]) - (f.intercept + f.slope * tx(X[c.i])) })).sort((a, b) => b.e - a.e);
        return `Strength **${Math.abs(f.r) >= .7 ? 'strong' : Math.abs(f.r) >= .4 ? 'moderate' : 'weak'}** (R² = **${f.r2.toFixed(2)}**, so the line explains about **${Math.round(f.r2 * 100)}%** of the differences). Furthest above the line: **${res[0].c.name}**; furthest below: **${res[res.length - 1].c.name}**.`; },
      watch: 'Two measures can move together because a third thing drives both (county size, age, money). A strong line is a lead, not an explanation.',
      nerd: { title: 'why some axes are logarithmic', text: 'Counts like registered voters run from a few thousand to over a million. On a log axis each gridline multiplies the last, so a tiny county and Miami-Dade both fit. The fit line is drawn on the logged values.' },
    },
    table: () => ({ head: ['County', mdef(LAB.x).t, mdef(LAB.y).t], align: ['l', 'n', 'n'], rows: C.map(c => [c.name, isNaN(mvals(LAB.x)[c.i]) ? '—' : mdef(LAB.x).f(mvals(LAB.x)[c.i]), isNaN(mvals(LAB.y)[c.i]) ? '—' : mdef(LAB.y).f(mvals(LAB.y)[c.i])]) }),
  });
  return api;
}

/* ---- 2. rank lab ---- */
function labRankList(id, desc) {
  const v = mvals(id), order = C.filter(c => !isNaN(v[c.i])).sort((a, b) => desc ? v[b.i] - v[a.i] : v[a.i] - v[b.i]), n = order.length, ci = scopeCi();
  const at = ci == null ? -1 : order.findIndex(c => c.i === ci);
  if (at < 0 || at < 10 || at >= n - 10) return n <= 20 ? order : [...order.slice(0, 10), { sep: n - 20 }, ...order.slice(-10)];
  return [...order.slice(0, 10), ...(at > 10 ? [{ sep: at - 10 }] : []), order[at], ...(at < n - 11 ? [{ sep: n - 11 - at }] : []), ...order.slice(-10)];
}
function drawLabRank(host, w, api) {
  ensureMetric('rank'); const M = mdef(LAB.rank), v = mvals(LAB.rank), desc = LAB.rankDir === 'desc', list = labRankList(LAB.rank, desc), ci = scopeCi();
  const all = C.filter(c => !isNaN(v[c.i])).sort((a, b) => desc ? v[b.i] - v[a.i] : v[a.i] - v[b.i]), rankOf = c => all.indexOf(c) + 1;
  const rowsOut = []; list.forEach(x => { if (x.sep != null) rowsOut.push({ label: `· · ·  ${x.sep} ${x.sep === 1 ? 'county' : 'counties'}  · · ·`, value: 0, color: 'transparent', text: '' }); else rowsOut.push({ label: `${rankOf(x)}. ${x.name}`, hi: x.i === ci, value: M.div ? v[x.i] : Math.abs(v[x.i]), color: M.div ? (v[x.i] >= 0 ? 'var(--rep)' : 'var(--dem)') : 'var(--early)', text: M.f(v[x.i]), click: () => selection.set(x.i), tip: () => tipContent(x.name, [{ label: M.t, value: M.f(v[x.i]) }, { label: 'Rank', value: `#${rankOf(x)} of ${all.length}` }, ...(M.state ? [{ label: 'Florida', value: M.f(M.state()) }] : [])], pickHint) }); });
  kitBars(host, w, rowsOut, { rowH: 26, barH: 14, rightPad: 96, labelW: Math.min(160, w * .3), fmt: M.fa || M.f, ...(M.state && !M.div ? { ref: { value: M.state(), label: `Florida ${M.f(M.state())}` } } : {}) });
  api.label(`Counties ranked by ${M.t}.`);
}
function labRankCard() {
  let api;
  const pick = live(h('div', { class: 'pickers' }), () => h('div', { class: 'pickers', style: { display: 'contents' } }, labSelect('Rank counties by', LAB.rank, v => { LAB.rank = v; api.redraw(); }),
    segmented('Order', [['desc', 'Highest first'], ['asc', 'Lowest first']], LAB.rankDir, v => { LAB.rankDir = v; api.redraw(); })));
  api = card({
    id: 'lab-rank', kicker: 'Ranked bar chart', cat: 'mochi', stack: true, controls: [h('div', { class: 'pickers' }, pick)],
    title: () => { ensureMetric('rank'); const M = mdef(LAB.rank), v = mvals(LAB.rank), best = C.filter(c => !isNaN(v[c.i])).sort((a, b) => v[b.i] - v[a.i]); return best.length ? `${best[0].name} is highest on ${M.t.toLowerCase()} (${M.f(v[best[0].i])}); ${best[best.length - 1].name} is lowest (${M.f(v[best[best.length - 1].i])})` : M.t; },
    sub: () => scopeC() ? `Top 10 and bottom 10, with ${scopeName()} pinned in its place.` : 'Top 10 and bottom 10 counties. Select a county in the menu to pin it.',
    draw: drawLabRank,
    notes: { what: 'A ranking turns any measure into an ordered list, so the extremes and your own county’s place are easy to see.', how: 'Bar length is the value. The vertical line marks the statewide figure where one exists. Click a bar to tailor the page to that county.', shows: () => { ensureMetric('rank'); const v = mvals(LAB.rank), ci = scopeCi(); return ci != null && !isNaN(v[ci]) ? `**${scopeName()}** ranks **#${mrank(LAB.rank, ci)}** of ${mclean(LAB.rank).length} on ${mdef(LAB.rank).t.toLowerCase()} (**${mdef(LAB.rank).f(v[ci])}**).` : `Median county: **${mdef(LAB.rank).f(mstat(LAB.rank).median)}**.`; }, watch: 'Rankings hide the gaps: the top two can be far apart or nearly tied. Check the numbers beside the bars.' },
    table: () => { ensureMetric('rank'); const M = mdef(LAB.rank), v = mvals(LAB.rank); return { head: ['Rank', 'County', M.t], align: ['n', 'l', 'n'], rows: C.filter(c => !isNaN(v[c.i])).sort((a, b) => v[b.i] - v[a.i]).map((c, i) => [String(i + 1), c.name, M.f(v[c.i])]) }; },
  });
  return api;
}

/* ---- 3. map lab ---- */
function drawLabMap(host, w, api) {
  ensureMetric('map'); const M = mdef(LAB.map), v = mvals(LAB.map), vals = C.map(c => isNaN(v[c.i]) ? mstat(LAB.map).median : v[c.i]);
  const sc = mapScale({ label: M.t, val: c => vals[c.i], fmt: M.fa || M.f, kind: M.div ? 'div' : 'seq' }), rank = c => mrank(LAB.map, c.i);
  const bubbles = LAB.mapStyle === 'bubbles';
  kitMap(host, w, { style: bubbles ? 'bubbles' : 'shapes', size: c => c.reg, sizeKey: [1e6, 1e5, 1e4], sizeLabel: 'Circle area = registered voters', color: c => isNaN(v[c.i]) ? null : sc.color(vals[c.i]), legendTitle: M.t, legend: sc.classes,
    tip: c => tipContent(c.name, [{ label: M.t, value: isNaN(v[c.i]) ? '—' : `${M.f(v[c.i])}  (#${rank(c)})` }, { label: 'Registered voters', value: fInt(c.reg) }], pickHint), aria: c => `${c.name}: ${isNaN(v[c.i]) ? 'no data' : M.f(v[c.i])}` });
  api.label(`Map of Florida counties colored by ${M.t}.`);
}
function labMapCard() {
  let api;
  const pick = live(h('div', { class: 'pickers' }), () => h('div', { class: 'pickers', style: { display: 'contents' } }, labSelect('Color counties by', LAB.map, v => { LAB.map = v; api.redraw(); }), segmented('Map style', [['shapes', 'Shapes'], ['bubbles', 'Bubbles']], LAB.mapStyle, v => { LAB.mapStyle = v; api.redraw(); })));
  api = card({
    id: 'lab-map', kicker: 'Choropleth and bubble map', cat: 'mochi', controls: [h('div', { class: 'pickers' }, pick)],
    title: () => { ensureMetric('map'); const M = mdef(LAB.map), v = mvals(LAB.map), s2 = C.filter(c => !isNaN(v[c.i])).sort((a, b) => v[b.i] - v[a.i]); return scopeC() && !isNaN(v[scopeCi()]) ? `${scopeName()} ranks #${mrank(LAB.map, scopeCi())} of ${s2.length} on ${M.t.toLowerCase()}` : s2.length ? `${M.t}: highest in ${s2[0].name}, lowest in ${s2[s2.length - 1].name}` : M.t; },
    sub: () => mdef(LAB.map).div ? 'Red where the measure favors Republicans, blue where it favors Democrats. Stronger color means a bigger gap.' : 'Counties shaded in five groups with about the same number of counties each.',
    draw: drawLabMap,
    notes: { what: 'The same map as the turnout view, but you choose what it shows. Any measure in the lab can color the counties.', how: 'Shapes show land area; bubbles show where the voters are. Hover a county for its value and rank. Click to tailor the page to it.', shows: () => { ensureMetric('map'); const s2 = mstat(LAB.map); return `Counties range from **${mdef(LAB.map).f(s2.min)}** to **${mdef(LAB.map).f(s2.max)}** with a median of **${mdef(LAB.map).f(s2.median)}**.`; }, watch: 'Quantile classes show rank, not size of difference. Two shades can differ by a point or by twenty; the legend gives the boundaries.' },
    table: () => { ensureMetric('map'); const M = mdef(LAB.map), v = mvals(LAB.map); return { head: ['County', M.t, 'Rank'], align: ['l', 'n', 'n'], rows: C.filter(c => !isNaN(v[c.i])).sort((a, b) => v[b.i] - v[a.i]).map((c, i) => [c.name, M.f(v[c.i]), String(i + 1)]) }; },
  });
  return api;
}

/* ---- 4. distribution lab ---- */
function drawLabDist(host, w, api) {
  ensureMetric('dist'); const M = mdef(LAB.dist), v = mvals(LAB.dist), ci = scopeCi(), lg = !!M.log;
  const items = C.filter(c => !isNaN(v[c.i]) && (!lg || v[c.i] > 0)).map(c => ({ v: lg ? Math.log10(v[c.i]) : v[c.i], name: c.name, ci: c.i }));
  if (items.length < 5) { emptyCard(host, 'Not enough counties yet.'); api.label('No data yet.'); return; }
  const lo = Math.min(...items.map(i => i.v)), hi = Math.max(...items.map(i => i.v)), raw = (hi - lo) / 16, pow = 10 ** Math.floor(Math.log10(raw || 1)), bin = [1, 2, 2.5, 5, 10].map(m => m * pow).find(b => b >= raw) || raw;
  const med = median(items.map(i => i.v)), tx = x => lg ? Math.log10(x) : x, me = ci != null ? items.find(i => i.ci === ci) : null, st = M.state && !lg ? M.state() : null;
  const fx = x => lg ? fComp(10 ** x) : (M.fa || M.f)(x);
  kitHist(host, w, items, { bin, lo: Math.floor(lo / bin) * bin, hi: Math.ceil((hi + 1e-9) / bin) * bin, fmtX: fx, unit: 'Counties', names: i => i.name, color: 'var(--early)', mark: me ? { v: me.v, label: scopeName() } : null,
    refs: [{ v: med, label: `Median ${fx(med)}` }, ...(st != null && isFinite(st) ? [{ v: st, label: `Florida ${M.f(st)}` }] : [])], xLabel: M.t + (lg ? ' (log scale)' : '') });
  api.label(`Histogram of ${M.t} across counties.`);
}
function labDistCard() {
  let api;
  const pick = live(h('div', { class: 'pickers' }), () => h('div', { class: 'pickers', style: { display: 'contents' } }, labSelect('Measure', LAB.dist, v => { LAB.dist = v; api.redraw(); })));
  api = card({
    id: 'lab-dist', kicker: 'Histogram', cat: 'pearl', stack: true, controls: [h('div', { class: 'pickers' }, pick)],
    title: () => { ensureMetric('dist'); const s2 = mstat(LAB.dist), M = mdef(LAB.dist); return `${M.t} across counties: median ${M.f(s2.median)}, from ${M.f(s2.min)} to ${M.f(s2.max)}`; },
    sub: () => scopeC() ? `How many counties fall in each band. The triangle marks ${scopeName()}.` : 'How many counties fall in each band of the measure.',
    draw: drawLabDist,
    notes: { what: 'A histogram shows the shape of a measure across all 67 counties: bunched together, spread out, or lopsided.', how: 'Each bar counts counties in a band. Vertical lines mark the median county and, where it exists, the statewide figure.', shows: () => { ensureMetric('dist'); const v = mclean(LAB.dist), M = mdef(LAB.dist), s2 = sorted(v); return `Middle half of counties: **${M.f(quantile(s2, .25))}** to **${M.f(quantile(s2, .75))}**. Mean **${M.f(mean(v))}**, median **${M.f(median(v))}**.`; }, watch: 'A long right tail pulls the mean above the median. For sizes and counts the median is the honest "typical county".' },
    table: () => { ensureMetric('dist'); const M = mdef(LAB.dist), v = mvals(LAB.dist); return { head: ['County', M.t], align: ['l', 'n'], rows: C.filter(c => !isNaN(v[c.i])).sort((a, b) => v[b.i] - v[a.i]).map(c => [c.name, M.f(v[c.i])]) }; },
  });
  return api;
}

/* ---- 5. correlation matrix ---- */
const CORR_IDS = ['rate', 'reg', 'mail', 'repRate', 'demRate', 'gap', 'lean', 'npaReg', 'perSite', 'prMed', 'prIqr', 'peak', 'last3'];
function drawCorr(host, w, api) {
  const ids = CORR_IDS.filter(id => metricsNow().some(m => m.id === id)), n = ids.length, labW = Math.min(210, w * .32), cw = Math.min(46, (w - labW - 8) / n), H = 30 + n * cw + 24;
  const svg = svgBox(w, H); host.append(svg);
  const col = r => mix(css('--surface'), css(r >= 0 ? '--early' : '--ed'), Math.min(Math.abs(r), 1) * .92);
  ids.forEach((id, j) => svg.append(s('text', { class: 't-axis', x: labW + j * cw + cw / 2, y: 18, 'text-anchor': 'middle' }, String(j + 1))));
  ids.forEach((a, i) => {
    const y = 30 + i * cw;
    svg.append(s('text', { class: 't-lab', x: labW - 8, y: y + cw / 2 + 4, 'text-anchor': 'end', style: { fontSize: '12px' } }, fitText(`${i + 1}. ${mdef(a).t}`, 12, 700, labW - 14)));
    ids.forEach((b, j) => {
      const f = a === b ? { r: 1 } : mcorr(a, b), r = f ? f.r : 0, fill = col(r), cell = s('rect', { class: 'cell clickable', x: labW + j * cw + 1, y: y + 1, width: cw - 2, height: cw - 2, rx: 4, fill, tabindex: 0, role: 'button', 'aria-label': `${mdef(a).t} and ${mdef(b).t}: correlation ${r.toFixed(2)}` });
      hover(cell, () => tipContent(`${mdef(a).t} and ${mdef(b).t}`, [{ label: 'Correlation (r)', value: r.toFixed(2) }, { label: 'R²', value: (r * r).toFixed(2) }], a === b ? 'Same measure' : 'Click to plot this pair'));
      const go2 = () => { if (a === b) return; LAB.x = a; LAB.y = b; (viewCache.lab ? viewCache.lab.live : []).forEach(x => x.run()); redrawView('lab'); scrollToId('lab-scatter'); };
      cell.addEventListener('click', go2); cell.addEventListener('keydown', e => { if (e.key === 'Enter') go2(); });
      svg.append(cell);
      if (cw >= 34) svg.append(s('text', { x: labW + j * cw + cw / 2, y: y + cw / 2 + 4, 'text-anchor': 'middle', 'pointer-events': 'none', style: { font: '700 11px Nunito, sans-serif', fill: Math.abs(r) > .55 ? '#fff' : 'var(--ink-2)' } }, a === b ? '' : r.toFixed(2).replace('0.', '.').replace('-0.', '−.')));
    });
  });
  api.label(`Correlation matrix of ${n} county measures.`);
}
function corrCard() {
  return card({
    id: 'lab-corr', kicker: 'Heatmap (correlation matrix)', cat: 'pearl', stack: true,
    title: () => { const ids = CORR_IDS.filter(id => metricsNow().some(m => m.id === id)), pairs = []; ids.forEach((a, i) => ids.slice(i + 1).forEach(b => { const f = mcorr(a, b); if (f) pairs.push({ a, b, r: f.r }); })); pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r)); return pairs.length ? `The strongest link is ${mdef(pairs[0].a).t.toLowerCase()} with ${mdef(pairs[0].b).t.toLowerCase()} (r = ${pairs[0].r.toFixed(2)})` : 'How county measures move together'; },
    sub: 'Every pair of measures at once. Purple means they rise together, orange means one rises as the other falls. Click a cell to plot that pair.',
    legend: () => [{ color: 'var(--early)', label: 'Rise together' }, { color: 'var(--ed)', label: 'One rises as the other falls' }, { color: 'var(--surface)', label: 'No link', border: true }],
    draw: drawCorr,
    notes: { what: 'A correlation matrix lays out the correlation of every measure with every other, so you can scan for strong links instead of testing pairs one by one.', how: 'Rows and columns use the same order (numbers on top match the rows). Color depth is the strength; the number is r. The diagonal is each measure with itself.', shows: () => 'Size measures (registered voters, sites, spread) tend to travel together, and so do the party-turnout measures.', watch: 'A matrix of 100+ pairs will always show some strong-looking links by luck. Treat the strongest as leads to check.' },
    table: () => { const ids = CORR_IDS.filter(id => metricsNow().some(m => m.id === id)); return { head: ['Measure', ...ids.map((_, i) => String(i + 1))], align: ['l', ...ids.map(() => 'n')], rows: ids.map((a, i) => [`${i + 1}. ${mdef(a).t}`, ...ids.map(b => a === b ? '1' : (mcorr(a, b) || { r: 0 }).r.toFixed(2))]) }; },
  });
}

/* ---- 6. counties most like this one ---- */
const SIM_IDS = ['rate', 'mail', 'early', 'repRate', 'demRate', 'lean', 'reg', 'prMed', 'peak', 'last3'];
function simRows(ci) {
  const ids = SIM_IDS.filter(id => metricsNow().some(m => m.id === id)), z = C.map(c => ids.map(id => mz(id, c.i)));
  return C.filter(c => c.i !== ci).map(c => { const d2 = ids.map((_, k) => (z[c.i][k] ?? 0) - (z[ci][k] ?? 0)), d = Math.sqrt(sum(d2.map(x => x * x)) / ids.length), worst = d2.map((x, k) => ({ k, x: Math.abs(x) })).sort((a, b) => b.x - a.x)[0], best = d2.map((x, k) => ({ k, x: Math.abs(x) })).sort((a, b) => a.x - b.x)[0]; return { c, d, far: mdef(ids[worst.k]).t, near: mdef(ids[best.k]).t }; }).sort((a, b) => a.d - b.d);
}
const simCounty = () => scopeCi() != null ? scopeCi() : (LAB.sim != null ? LAB.sim : TOP15[0].i);
function drawLabSim(host, w, api) {
  const ci = simCounty(), rows = simRows(ci), top = rows.slice(0, 8), dmax = Math.max(...rows.map(r => r.d));
  kitBars(host, w, top.map(r => ({ label: r.c.name, sub: `closest on ${r.near.toLowerCase()}`.slice(0, 40), value: 100 * (1 - r.d / dmax), color: 'var(--early)', text: `${(100 * (1 - r.d / dmax)).toFixed(0)}% alike`, click: () => selection.set(r.c.i),
    tip: () => tipContent(r.c.name, [{ label: 'Typical difference', value: `${r.d.toFixed(2)} standard deviations` }, { label: 'Most alike on', value: r.near }, { label: 'Most different on', value: r.far }], pickHint) })), { rowH: 40, barH: 16, max: 100, rightPad: 100, labelW: Math.min(210, w * .36), fmt: v => v + '%' });
  api.label(`Counties most like ${C[ci].name}.`);
}
function labSimCard() {
  let api;
  const pick = live(h('div', { class: 'pickers' }), () => scopeC() ? null : selectOf('Find counties like', [...C].sort((a, b) => a.name.localeCompare(b.name)).map(c => [c.i, c.name]), simCounty(), v => { LAB.sim = +v; api.redraw(); }));
  api = card({
    id: 'lab-sim', kicker: 'Ranked bar chart (similarity)', cat: 'mochi', stack: true, controls: [h('div', { class: 'pickers' }, pick)],
    title: () => { const ci = simCounty(), r = simRows(ci); return `${C[ci].name} behaves most like ${r[0].c.name}, ${r[1].c.name} and ${r[2].c.name}`; },
    sub: 'Similarity across ten behavior measures (turnout, how people voted, party lean, precinct spread, timing), each put on a common scale first.',
    draw: drawLabSim,
    notes: { what: 'Similar counties are found by comparing how a county looks on many measures at once, after rescaling each measure so none dominates.', how: 'Each measure becomes a z-score (how many standard deviations from the typical county). The score is the average gap across measures; bar length is how close that is, relative to the least similar county.', shows: () => { const ci = simCounty(), r = simRows(ci); return `Least like **${C[ci].name}**: **${r[r.length - 1].c.name}**, **${r[r.length - 2].c.name}**.`; }, watch: 'Which measures you include decides who counts as similar. This set describes behavior, not geography: neighbors are not necessarily alike.' },
    table: () => { const ci = simCounty(); return { head: ['County', 'Difference (std. devs)', 'Closest on', 'Furthest on'], align: ['l', 'n', 'l', 'l'], rows: simRows(ci).map(r => [r.c.name, r.d.toFixed(2), r.near, r.far]) }; },
  });
  return api;
}

/* ---- 7. what stands out ---- */
const outState = { key: 'z', dir: -1 };
function outlierRows() {
  const ci = scopeCi(), ids = metricsNow().map(m => m.id).filter(id => !['total', 'prec'].includes(id)), rows = [];
  C.forEach(c => { if (ci != null && c.i !== ci) return; ids.forEach(id => { const z = mz(id, c.i); if (z != null && Math.abs(z) >= (ci != null ? 1.2 : 2.4)) rows.push({ c, id, z, v: mvals(id)[c.i] }); }); });
  return rows.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 60);
}
function drawOutliers(host) {
  const rows = outlierRows();
  const cols = [
    { k: 'c', t: 'County', get: x => x.c.name, cls: 'name' }, { k: 'm', t: 'Measure', get: x => mdef(x.id).t, cls: 'wrapcell namecell' },
    { k: 'v', t: 'Value', n: true, get: x => x.v, fmt: (v, x) => mdef(x.id).f(v) }, { k: 'med', t: 'Typical county', n: true, cls: 'hide-sm', get: x => mstat(x.id).median, fmt: (v, x) => mdef(x.id).f(v) },
    { k: 'z', t: 'Std. devs from typical', n: true, get: x => Math.abs(x.z), fmt: (v, x) => `${x.z >= 0 ? '+' : '−'}${v.toFixed(1)}` },
  ];
  host.append(kitTable(cols, rows, outState, () => drawOutliers(clear(host)), { onRow: x => selection.set(x.c.i), rowClass: x => selection.i === x.c.i ? 'sel' : '', maxH: '440px', minW: '640px', empty: 'Nothing stands out by this yardstick.', label: 'Counties that stand out' }));
}
function outliersCard() {
  return card({
    id: 'lab-outliers', kicker: 'Table (outlier detector)', cat: 'pearl', stack: true, noTable: true,
    title: () => scopeC() ? `What stands out about ${scopeName()}` : 'Counties that stand out on a measure',
    sub: () => scopeC() ? `Every measure where ${scopeName()} sits at least 1.2 standard deviations from the typical county.` : 'Every county-and-measure pair at least 2.4 standard deviations from the typical county. Click a row to tailor the page to that county.',
    draw: host => drawOutliers(host),
    notes: { what: 'An outlier is a value far from the rest. Scanning for them across every measure is a fast way to find what is unusual about a place.', how: 'The last column is the z-score: how many standard deviations the value is from the average county. Plus is above, minus is below; 2 or more is unusual, 3 or more is rare.', shows: () => { const r = outlierRows(); return r.length ? `Biggest: **${r[0].c.name}** on ${mdef(r[0].id).t.toLowerCase()} (**${r[0].z >= 0 ? '+' : '−'}${Math.abs(r[0].z).toFixed(1)}** std. devs).` : 'Nothing crosses the line yet.'; }, watch: 'Many measures reflect size, so tiny and giant counties dominate the list. An outlier is a reason to look closer, not an error.' },
  });
}

/* ---- 8. concentration: how many counties make up half the ballots ---- */
function drawLorenz(host, w, api) {
  const ci = scopeCi(), order = [...C].sort((a, b) => b.total - a.total), tot = ST.total || 1; let acc = 0;
  const cum = order.map(c => { acc += c.total; return 100 * acc / tot; }), xs = [0, ...order.map((_, i) => i + 1)], ys = [0, ...cum];
  const half = cum.findIndex(v => v >= 50) + 1, rank = ci == null ? null : order.findIndex(c => c.i === ci) + 1;
  kitLines(host, w, xs, [{ name: 'Ballots', color: 'var(--early)', ys, width: 2.5 }, { name: 'Equal share', color: 'var(--ink-3)', dash: '5 4', width: 1.5, ys: xs.map(x => 100 * x / N) }],
    { yFmt: v => v + '%', endFmt: v => fPct(v, 0), yMax: 100, yMin: 0, xFmt: x => fPct(100 * x / N, 0), tipHead: i => i ? `The ${i} biggest ${i === 1 ? 'county' : 'counties'}` : 'No counties', tipFmt: v => fPct(v, 1), height: clamp(Math.round(w * .34), 260, 340),
      vlines: [{ x: half, label: `${half} counties = half the ballots` }] });
  if (rank) host.append(h('p', { class: 'mini-note', style: { marginTop: '6px' } }, `${scopeName()} is the ${rank}${rank % 10 === 1 && rank !== 11 ? 'st' : rank % 10 === 2 && rank !== 12 ? 'nd' : rank % 10 === 3 && rank !== 13 ? 'rd' : 'th'} biggest county by ballots cast; the ${rank} biggest counties together hold ${fPct(cum[rank - 1], 0)} of all ballots.`));
  api.label(`Cumulative share of ballots from the biggest counties. ${half} counties cast half.`);
}
function lorenzCard() {
  return card({
    id: 'lab-lorenz', kicker: 'Concentration curve', cat: 'mochi', stack: true,
    title: () => { const o = [...C].sort((a, b) => b.total - a.total); let a = 0; const k = o.findIndex(c => (a += c.total) >= ST.total / 2) + 1; return `${k} of ${N} counties cast half of Florida’s ballots`; },
    sub: 'Counties from biggest to smallest across, cumulative share of all ballots up. The dashed line is what an even spread would look like.',
    draw: drawLorenz,
    notes: { what: 'A concentration (Lorenz) curve shows how unevenly something is spread. The further the curve bows above the diagonal, the more a few places dominate.', how: 'Left to right the biggest counties are added one at a time. The height is the share of all ballots they hold together.', shows: () => { const o = [...C].sort((a, b) => b.total - a.total), top3 = sum(o.slice(0, 3).map(c => c.total)); return `The three biggest counties hold **${fPct(100 * top3 / ST.total, 0)}** of ballots, **${o.slice(0, 3).map(c => c.name).join(', ')}**.`; }, watch: 'This is why county averages mislead: the typical county has far fewer voters than the typical voter’s county.' },
    table: () => { const o = [...C].sort((a, b) => b.total - a.total); let a = 0; return { head: ['Counties included', 'Largest added', 'Cumulative share of ballots'], align: ['n', 'l', 'n'], rows: o.map((c, i) => { a += c.total; return [String(i + 1), c.name, fPct(100 * a / ST.total, 1)]; }) }; },
  });
}

/* ---- 9. precinct leaderboard ---- */
const precState = { key: 'rate', dir: -1 };
function drawPrecBoard(host) {
  const ci = scopeCi(), min = LAB.precMin, rows = PR.filter(p => p.r >= min && (ci == null || p.c === ci)).sort((a, b) => LAB.precDir === 'top' ? b.rate - a.rate : a.rate - b.rate).slice(0, 200).map((p, i) => ({ ...p, i: i + 1 }));
  const cols = [
    { k: 'i', t: '#', n: true, nosort: true, get: x => x.i, fmt: v => String(v) }, { k: 'c', t: 'County', get: x => C[x.c].name, cls: 'name' }, { k: 'k', t: 'Precinct', get: x => String(x.k) },
    { k: 'r', t: 'Registered', n: true, get: x => x.r, fmt: fInt }, { k: 't', t: 'Ballots', n: true, get: x => x.t, fmt: fInt }, { k: 'rate', t: 'Turnout', n: true, get: x => x.rate, fmt: v => fPct(v, 1) },
    { k: 'mail', t: 'By mail', n: true, cls: 'hide-sm', get: x => x.t ? 100 * x.m / x.t : 0, fmt: v => fPct(v, 0) }, { k: 'early', t: 'Early in person', n: true, cls: 'hide-sm', get: x => x.t ? 100 * x.e / x.t : 0, fmt: v => fPct(v, 0) },
  ];
  host.append(kitTable(cols, rows, precState, () => drawPrecBoard(clear(host)), { onRow: x => selection.set(x.c), rowClass: x => selection.i === x.c ? 'sel' : '', maxH: '460px', minW: '640px', empty: `No precincts with ${min}+ registered voters${ci != null ? ' in ' + scopeName() : ''}.`, label: 'Precinct leaderboard' }));
}
function precBoardCard() {
  let api;
  const minSel = selectOf('Smallest precinct to include', [[50, '50+ registered voters'], [100, '100+'], [250, '250+'], [500, '500+'], [1000, '1,000+']], LAB.precMin, v => { LAB.precMin = +v; api.redraw(); });
  const dir = segmented('Show', [['top', 'Highest turnout'], ['bottom', 'Lowest turnout']], LAB.precDir, v => { LAB.precDir = v; api.redraw(); });
  api = card({
    id: 'lab-prec', kicker: 'Table (leaderboard)', cat: 'pearl', stack: true, noTable: true, controls: [h('div', { class: 'pickers' }, minSel, dir)],
    title: () => scopeC() ? `${scopeName()}’s precincts, ${LAB.precDir === 'top' ? 'highest' : 'lowest'} turnout first` : `Florida’s precincts with the ${LAB.precDir === 'top' ? 'highest' : 'lowest'} turnout`,
    sub: () => `Precincts with at least ${fInt(LAB.precMin)} registered voters, so tiny precincts do not top the list by luck. The first 200 are shown; click a column to re-sort them.`,
    draw: host => drawPrecBoard(host),
    notes: { what: 'A leaderboard ranks individual precincts, the smallest voting districts in the data.', how: 'Turn the minimum size up to filter out small precincts, where one family can swing the rate. Click a row to tailor the page to that county.', shows: () => { const ci = scopeCi(), rows = PR.filter(p => p.r >= LAB.precMin && (ci == null || p.c === ci)); return rows.length ? `**${fInt(rows.length)}** precincts qualify. Median turnout **${fPct(median(rows.map(p => p.rate)))}**.` : 'No precincts qualify.'; }, watch: 'Turnout over 100% usually means voters registered after the Oct 5 book closing, not an error in the count.' },
  });
  return api;
}

/* ---- the view ---- */
VIEWS.lab = {
  build() {
    const CH = [
      { id: 'lab-explore', nav: 'Explore a measure', title: 'Pick any measure, see it every way', lead: () => `${metricsNow().length} county measures, each as a scatter, a ranking, a map and a histogram.${scopeC() ? ` ${scopeName()} is marked everywhere.` : ''}`, cards: () => [labScatterCard().el, labRankCard().el, labMapCard().el, labDistCard().el] },
      { id: 'lab-relate', nav: 'How things relate', title: 'How measures move together, and who is alike', lead: 'A whole matrix of links at once, the counties most like the one you chose, and the places that stand out.', cards: () => [corrCard().el, labSimCard().el, outliersCard().el] },
      { id: 'lab-shape', nav: 'Concentration and precincts', title: 'Where the voters are', lead: 'How few counties make up half the vote, and a leaderboard of precincts.', cards: () => [lorenzCard().el, precBoardCard().el] },
    ];
    const sub = CH.map(c => ({ id: c.id, label: c.nav }));
    const root = h('div', null, viewHead('Data lab', () => `For the data curious: choose any measure, compare it with any other, and see who is unusual${scopeC() ? ` (${scopeName()} is highlighted)` : ''}. Everything is computed from the same county tables as the rest of the page.`), inlineSubnav(sub),
      ...CH.map((ch, i) => chapter(ch.id, String(i + 1), ch.title, ch.lead, ch.cards())));
    return { root, sub };
  },
};
