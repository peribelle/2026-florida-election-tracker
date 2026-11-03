/* ---------- results: precinct detail for the counties that publish it (statewide races and amendments) ---------- */
const PRC = { cand: -1, rid: null, ci: null };
const precCounties = () => (RS && RS.prec ? RS.prec.counties : []);
const precFor = ci => precCounties().find(x => x.ci === ci) || null;
function precContext() {
  const hd = currentContest(), r = hd && hd.type === 'ew' ? hd.r : null;
  const ci = scopeCi() != null ? scopeCi() : (PRC.ci != null ? PRC.ci : (precCounties()[0] || {}).ci ?? null);
  const data = ci != null ? precFor(ci) : null;
  return { hd, r, ci, data, arr: data && r ? data.races[String(r.i)] : null };
}
function precRows(ctx) {
  const { r, data, arr } = ctx, nc = r.nc, out = [];
  data.precincts.forEach((name, i) => { const v = arr.slice(i * nc, (i + 1) * nc), sm = summarize(v, r.cands); if (sm.total > 0) out.push({ name, sm, i }); });
  return out;
}
function precMessage(ctx) {
  if (!HAS_RESULTS || !RS.prec) return 'Precinct results are not available yet. They come from county election sites that publish a precinct export, and none has been pulled.';
  if (!ctx.hd) return 'Pick a race first.';
  if (!ctx.r) return `${ctx.hd.name} is a local race. Precinct detail here covers the statewide-feed races (governor, Senate, Cabinet, amendments).`;
  if (!ctx.data) return `${ctx.ci != null ? C[ctx.ci].name : 'This county'} has no precinct results yet. ${precCounties().length} counties do: ${precCounties().slice(0, 6).map(x => C[x.ci].name).join(', ')}${precCounties().length > 6 ? ', …' : ''}.`;
  if (!ctx.arr) return `${C[ctx.ci].name}’s precinct export does not include ${ctx.r.name}. Try governor or Senate.`;
  return null;
}
const countyPickerForPrecincts = () => live(h('div'), () => scopeC() ? null : selectOf('County with precinct data', precCounties().map(x => [x.ci, C[x.ci].name]), PRC.ci ?? (precCounties()[0] || {}).ci, v => { PRC.ci = +v; redrawView('results'); }));
const precCandPicker = api => live(h('div'), () => { const ctx = precContext(); return ctx.r ? selectOf('Candidate', ctx.r.cands.map((c, k) => [k, `${candShort(c)} (${c[1] || 'NP'})`]), PRC.cand, v => { PRC.cand = +v; api.redraw(); }) : null; });
function precCandIndex(ctx) {
  if (PRC.rid !== ctx.r.id || PRC.cand < 0 || PRC.cand >= ctx.r.nc) { const st = raceSum(ctx.r, -1); PRC.rid = ctx.r.id; PRC.cand = st && st.lead >= 0 ? st.lead : 0; }
  return PRC.cand;
}
function drawPrecCharts(host, w, api) {
  const ctx = precContext(), msg = precMessage(ctx); if (msg) { emptyCard(host, msg); api.label('No data.'); return; }
  const rows = precRows(ctx); if (rows.length < 3) { emptyCard(host, `Not enough precincts have counted votes in ${C[ctx.ci].name} yet.`); api.label('No data yet.'); return; }
  const k = precCandIndex(ctx), cands = ctx.r.cands, two = w >= 760, cw = two ? Math.floor((w - 20) / 2) : w;
  const wrap = h('div', { style: { display: 'grid', gap: '20px', gridTemplateColumns: two ? '1fr 1fr' : '1fr' } }), a = h('div'), b = h('div');
  wrap.append(h('div', null, h('h4', { style: { font: '600 .95rem var(--font-display)', margin: '0 0 6px' } }, `Share for ${candShort(cands[k])}, precinct by precinct`), a),
    h('div', null, h('h4', { style: { font: '600 .95rem var(--font-display)', margin: '0 0 6px' } }, 'Does precinct size matter?'), b)); host.append(wrap);
  const items = rows.map(x => ({ v: x.sm.shares[k], name: x.name })), med = median(items.map(i => i.v));
  kitHist(a, cw, items, { bin: 5, lo: 0, hi: 100, unit: 'Precincts', names: i => i.name, color: candColor(cands, k), refs: [{ v: med, label: `Median ${fPct(med)}`, anchor: 'start' }], height: 260 });
  const pts = rows.map(x => ({ x: Math.max(x.sm.total, 1), y: x.sm.shares[k], label: x.name, color: candColor(cands, k), r: 4, tip: () => tipContent(`Precinct ${x.name}`, [{ label: candShort(cands[k]), value: fPct(x.sm.shares[k]) }, { label: 'Votes in this race', value: fInt(x.sm.total) }, { label: 'Leader', value: x.sm.lead >= 0 ? candShort(cands[x.sm.lead]) : 'Tied' }]) }));
  kitScatter(b, cw, pts, { xLog: true, xFmt: fComp, yFmt: v => v + '%', xLabel: 'Votes counted in the precinct (log scale)', yLabel: `${candShort(cands[k])}’s share`, fit: true, labelN: 2, height: 260 });
  api.label(`Precinct results in ${C[ctx.ci].name} for ${ctx.r.name}.`);
}
function precChartsCard() {
  let api;
  api = card({
    id: 'r-prec', kicker: 'Histogram and scatter', cat: 'pearl', stack: true, controls: [countyPickerForPrecincts(), contestPicker(), precCandPicker({ redraw: () => api.redraw() })],
    title: () => { const ctx = precContext(); return ctx.data && ctx.r ? `${C[ctx.ci].name} precincts: how ${candShort(ctx.r.cands[Math.max(0, PRC.cand)] || ctx.r.cands[0])}’s share varies from neighborhood to neighborhood` : 'Precinct results'; },
    sub: () => `${precCounties().length} counties publish precinct-level results. Each dot or bar counts precincts, the smallest voting districts.`,
    draw: drawPrecCharts,
    notes: {
      what: 'Precincts are the smallest places votes are counted, so they show how much a county varies inside itself. The histogram counts precincts by share; the scatter asks whether bigger precincts vote differently.',
      how: 'Left: each bar is a band of vote share, its height the number of precincts. Right: each dot is a precinct, with votes counted across (log scale) and the candidate’s share up.',
      shows: () => { const ctx = precContext(); if (precMessage(ctx)) return 'Pick a county with precinct data and a statewide race.'; const rows = precRows(ctx); if (rows.length < 3) return 'Precincts appear as soon as they report.'; const k = precCandIndex(ctx), sh = rows.map(x => x.sm.shares[k]); return `Across **${fInt(rows.length)}** precincts in ${C[ctx.ci].name}, ${candShort(ctx.r.cands[k])}’s share runs from **${fPct(Math.min(...sh))}** to **${fPct(Math.max(...sh))}** (median **${fPct(median(sh))}**).`; },
      watch: 'Split precincts may appear as separate rows, and very small precincts swing wildly. Read the extremes with care.',
    },
  });
  return api;
}
const precTableState = { key: 'margin', dir: -1 };
function drawPrecTable(host) {
  const ctx = precContext(), msg = precMessage(ctx); if (msg) { emptyCard(host, msg); return; }
  const rows = precRows(ctx); if (!rows.length) { emptyCard(host, 'No precinct has counted votes yet.'); return; }
  const cands = ctx.r.cands, st = raceSum(ctx.r, ctx.ci) || raceSum(ctx.r, -1), top = (st ? st.order : cands.map((_, i) => i)).slice(0, 3);
  const cols = [{ k: 'name', t: 'Precinct', get: x => x.name, cls: 'name' }, { k: 'votes', t: 'Votes', n: true, get: x => x.sm.total, fmt: fInt },
    { k: 'lead', t: 'Leading', get: x => x.sm.lead >= 0 ? x.sm.shares[x.sm.lead] : -1, node: x => x.sm.lead >= 0 ? h('span', { style: { whiteSpace: 'nowrap' } }, partyChip(cands[x.sm.lead][1]), ' ', candShort(cands[x.sm.lead])) : 'Tied' },
    ...top.map(k => ({ k: 'c' + k, t: candShort(cands[k]), n: true, get: x => x.sm.shares[k], fmt: v => fPct(v) })), { k: 'margin', t: 'Margin (pts)', n: true, get: x => x.sm.marginPct, fmt: v => fPct(v) }];
  host.append(kitTable(cols, rows, precTableState, () => drawPrecTable(clear(host)), { maxH: '480px', minW: '640px', label: 'Precinct results' }));
}
function precTableCard() {
  return card({
    id: 'r-prectable', kicker: 'Table', cat: 'mochi', stack: true, noTable: true,
    title: () => { const ctx = precContext(); return ctx.data && ctx.r ? `Every ${C[ctx.ci].name} precinct for ${ctx.r.name}` : 'Precinct table'; },
    sub: 'Sort by margin to find the most lopsided precincts, or by votes to find the biggest.',
    draw: host => drawPrecTable(host),
    notes: {
      what: 'The precinct table lists every precinct with votes counted. It is the raw material for the two charts above.',
      how: 'Click a column to sort. "Margin" is the gap between the top two candidates in the county.',
      shows: () => { const ctx = precContext(); if (precMessage(ctx)) return ''; const rows = precRows(ctx); return rows.length ? `**${fInt(rows.length)}** precincts have votes. The biggest is **${[...rows].sort((a, b) => b.sm.total - a.sm.total)[0].name}** with **${fInt([...rows].sort((a, b) => b.sm.total - a.sm.total)[0].sm.total)}** votes.` : ''; },
      watch: 'Precinct numbers are not comparable across counties; each county names and splits them its own way.',
    },
  });
}
