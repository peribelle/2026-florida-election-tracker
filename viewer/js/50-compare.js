/* ---------- the Compare view: one to four counties side by side, for a race and for turnout ----------
   County identity is a small set of colors (--c1..--c4) that never overlap the party colors (red, blue, yellow).
   State lives in the URL: #/compare?cmp=DAD,HIL,ORA&race=160000 */
const CMP = { slots: [], florida: true, cand: -1, pace: 'cum', party: 'ballots' };
const slotColor = k => `var(--c${k + 1})`;
const FL_ENT = { ci: -1, k: -1, name: 'Florida', color: 'var(--ink-3)' };
const cmpEnts = (withFl = CMP.florida) => [...CMP.slots.map((ci, k) => ({ ci, k, name: C[ci].name, color: slotColor(k) })), ...(withFl ? [FL_ENT] : [])];
const cmpNames = () => { const n = CMP.slots.map(ci => C[ci].name); return n.length < 3 ? n.join(' and ') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`; };
const regLean = c => { const t = sum(PARTIES.map(g => c.p[g.k][0])); return t ? 100 * (c.p.REP[0] - c.p.DEM[0]) / t : 0; };   // + means more Republicans registered

/* the races any chosen county can be compared on, and the one in view */
const cmpRaces = () => RACES.filter(r => CMP.slots.some(ci => r.rowIdx.has(ci)));
function cmpRace() {
  const list = cmpRaces(), cur = RES.key && RES.key[0] !== 'L' ? RACE_BY_ID.get(RES.key) : null;
  return cur && list.includes(cur) ? cur : list.find(r => r.id === '160000') || list[0] || null;
}
const isStatewideRace = r => ['exec', 'senate', 'amend'].includes(r.kind) || r.rows.filter(c => c >= 0).length === N;
function cmpRaceRows(r, s = RLAST) {
  return cmpEnts().map(e => ({ ...e, name: e.ci === -1 && !isStatewideRace(r) ? 'District total' : e.name, sm: e.ci === -1 ? raceSum(r, -1, s) : r.rowIdx.has(e.ci) ? raceSum(r, e.ci, s) : null }));
}

/* ---- state changes ---- */
const PRESETS = [
  { k: 'big', t: 'Four biggest', get: () => [...C].sort((a, b) => b.reg - a.reg) }, { k: 'small', t: 'Four smallest', get: () => [...C].sort((a, b) => a.reg - b.reg) },
  { k: 'peers', t: 'Closest in size to county 1', get: () => [C[CMP.slots[0]], ...peersOf(CMP.slots[0], 3)] },
  { k: 'turnHi', t: 'Highest turnout', get: () => BY_RATE }, { k: 'turnLo', t: 'Lowest turnout', get: () => [...BY_RATE].reverse() },
  { k: 'mail', t: 'Most mail voting', get: () => [...C].sort((a, b) => b.mailShare - a.mailShare) },
  { k: 'rep', t: 'Most Republican registration', get: () => [...C].sort((a, b) => regLean(b) - regLean(a)) }, { k: 'dem', t: 'Most Democratic registration', get: () => [...C].sort((a, b) => regLean(a) - regLean(b)) },
];
function cmpChanged() {
  setParam('cmp', CMP.slots.map(ci => C[ci].id).join(','));
  const r = cmpRace(); if (r) setParam('race', r.id);
  const v = viewCache.compare; if (v) { v.picker.render(); v.live.forEach(i => i.run()); }
  redrawView('compare');
}
const cmpSet = (k, ci) => { CMP.slots[k] = ci; cmpChanged(); };
const cmpRemove = k => { if (CMP.slots.length > 1) { CMP.slots.splice(k, 1); cmpChanged(); } };
function cmpAdd() { const free = [...peersOf(CMP.slots[0], 12), ...TOP15].find(c => !CMP.slots.includes(c.i)); if (free) { CMP.slots.push(free.i); cmpChanged(); } }
function cmpPreset(k) { const p = PRESETS.find(x => x.k === k), list = p.get().map(c => c.i); CMP.slots = [...new Set(list)].slice(0, 4); cmpChanged(); }
function cmpSetRace(id) { RES.key = id; if (viewCache.results) viewCache.results.stale = true; cmpChanged(); }
function seedCompare() {
  const fromUrl = (param('cmp') || '').split(',').map(id => C.findIndex(c => c.id === id)).filter((i, k, a) => i >= 0 && a.indexOf(i) === k).slice(0, 4);
  if (fromUrl.length) CMP.slots = fromUrl;
  else if (!CMP.slots.length) CMP.slots = selection.i != null ? [selection.i, ...peersOf(selection.i, 2).map(c => c.i)] : TOP15.slice(0, 3).map(c => c.i);
  if (param('race') && RACE_BY_ID.has(param('race'))) RES.key = param('race');
}
function adoptScope() {                          // the county menu in the header becomes county 1
  if (selection.i == null) return;
  const at = CMP.slots.indexOf(selection.i);
  if (at < 0) CMP.slots[0] = selection.i; else if (at > 0) [CMP.slots[0], CMP.slots[at]] = [CMP.slots[at], CMP.slots[0]];
}

/* ---- the picker: counties, race and quick sets ---- */
function cmpPicker() {
  const box = h('section', { class: 'card plain', id: 'cmp-pick', 'aria-label': 'Choose counties and a race', style: { gap: '14px' } });
  const render = () => {
    const taken = new Set(CMP.slots), byName = [...C].sort((a, b) => a.name.localeCompare(b.name)), races = cmpRaces(), cur = cmpRace();
    clear(box).append(
      h('div', { class: 'slots', role: 'group', 'aria-label': 'Counties to compare' },
        ...CMP.slots.map((ci, k) => h('div', { class: 'slot', style: { borderLeftColor: slotColor(k) } },
          h('label', { for: `cmp-s${k}` }, h('span', null, `County ${k + 1}`), CMP.slots.length > 1 ? h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${C[ci].name} from the comparison`, onclick: () => cmpRemove(k) }, '✕') : null),
          h('select', { id: `cmp-s${k}`, class: 'field', onchange: e => cmpSet(k, +e.target.value) }, byName.map(c => h('option', { value: c.i, ...(c.i === ci ? { selected: true } : {}), ...(taken.has(c.i) && c.i !== ci ? { disabled: true } : {}) }, c.name))))),
        CMP.slots.length < 4 ? h('button', { type: 'button', class: 'addslot', onclick: cmpAdd }, '+ Add a county') : null),
      h('div', { class: 'pickers' },
        HAS_RESULTS ? h('label', { class: 'grow' }, 'RACE', h('select', { class: 'field', 'aria-label': 'Race to compare', onchange: e => cmpSetRace(e.target.value) },
          FAMILIES.map(f => h('optgroup', { label: f.label }, races.filter(r => familyOf(r) === f).map(r => h('option', { value: r.id, ...(cur && cur.id === r.id ? { selected: true } : {}) }, r.name)))))) : null,
        h('label', { class: 'mini-note', style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', ...(CMP.florida ? { checked: true } : {}), onchange: e => { CMP.florida = e.target.checked; cmpChanged(); } }), 'Show Florida as a reference')),
      h('div', null, h('div', { class: 'mini-note', style: { marginBottom: '6px', fontWeight: 800 } }, 'Quick sets'), h('div', { class: 'chips' }, PRESETS.map(p => h('button', { type: 'button', class: 'chipbtn', onclick: () => cmpPreset(p.k) }, p.t)))));
  };
  render(); return { el: box, render };
}

/* ---- the race ---- */
function cmpForecastStrip() {
  return live(h('div', { id: 'cmp-fc' }), () => {
    const r = cmpRace(), pi = HAS_PROJ && r ? pjIndexOf(r) : null; if (pi == null) return null;
    const f = pjFavorite(pi), c = pjCall(pi), pr = pjProbs(pi), side = f.side, parts = pjSources(pi).map(x => `${fProb(pr[x.src][side])} ${PSRC_SHORT[x.src]}`);
    return h('div', { class: 'callout' }, h('b', null, 'Forecast: '), partyChip(f.sideObj.p), ' ', `${sideName(f.sideObj)} ${parts.join(' · ')}. `, c ? h('span', { class: 'spill ok' }, `Called for ${pjSurname(c.name)}`) : 'Not called yet. ',
      ' Forecasts cover the whole race, not single counties, so the cards below show the count. ', h('a', { href: `#/results?race=${r.id}&s=r-forecast` }, 'See the full forecast'));
  });
}
function cmpShareParts(r, sm, order) {
  const other = sm.total - sum(order.map(k => sm.v[k]));
  return [...order.map(k => ({ label: candShort(r.cands[k]), color: candColor(r.cands, k), value: sm.v[k] })), ...(other > 0 ? [{ label: 'Others', color: 'var(--oth)', value: other }] : [])];
}
function drawCmpShare(host, w, api) {
  const r = cmpRace(); if (!r) { emptyCard(host, 'No race covers these counties.'); return; }
  const st = raceSum(r, -1), rows = cmpRaceRows(r);
  if (!st || !st.total) {                                   // before the count: show what is known, the registered voters
    host.append(h('p', { class: 'mini-note', style: { margin: '0 0 8px' } }, `No votes are counted in ${r.name} yet. For context, here is how each county’s registered voters split by party. The vote shares replace this once counting starts.`));
    kitStack(host, w, cmpEnts().map(e => { const g = partyStatsFor(e.ci === -1 ? null : e.ci); return { label: e.name, dot: e.color, parts: g.map(p => ({ label: p.name, color: p.color, value: p.reg })), text: fComp(sum(g.map(p => p.reg))), tip: () => tipContent(e.name, g.map(p => ({ color: p.color, label: p.name, value: `${fInt(p.reg)}  (${fPct(p.shareReg)})` })), 'Registered voters') }; }), { mode: 'share', rowH: 46, barH: 24, rightPad: 70, labelW: Math.min(150, w * .28) });
    api.label('Registered voters by party in the chosen counties, as context before votes are counted.'); return;
  }
  const order = st.order.slice(0, 4);
  kitStack(host, w, rows.map(e => { const sm = e.sm;
    if (!sm) return { label: e.name, dot: e.color, parts: [], text: 'not in this race' };
    if (!sm.total) return { label: e.name, dot: e.color, parts: [], text: 'no votes yet' };
    return { label: e.name, sub: `${fInt(sm.total)} votes`, dot: e.color, parts: cmpShareParts(r, sm, order), text: sm.lead >= 0 ? `${candShort(r.cands[sm.lead])} ${fPct(sm.shares[sm.lead], 0)}` : 'tied',
      tip: () => tipContent(e.name, sm.order.slice(0, 5).map(k => ({ color: candColor(r.cands, k), label: candShort(r.cands[k]), value: `${fInt(sm.v[k])}  (${fPct(sm.shares[k])})` })), `${fInt(sm.total)} votes counted`) }; }),
    { mode: 'share', rowH: 52, barH: 26, rightPad: Math.min(160, w * .3), labelW: Math.min(150, w * .28) });
  api.label(`Vote share in ${r.name} for ${cmpNames()}.`);
}
function drawCmpMargin(host, w, api) {
  const r = cmpRace(); if (!r) return;
  const rows = cmpRaceRows(r), any = rows.some(e => e.sm && e.sm.total);
  if (!any) { emptyCard(host, 'No votes are counted yet. When they are, each county gets a bar showing who leads and by how many points.'); api.label('No data yet.'); return; }
  kitBars(host, w, rows.map(e => { const sm = e.sm;
    if (!sm || !sm.total) return { label: e.name, dot: e.color, value: 0, color: 'var(--oth)', text: sm ? 'no votes yet' : 'not in this race' };
    return { label: e.name, dot: e.color, sub: `${fInt(sm.margin)} votes`, value: sm.marginPct, color: sm.lead >= 0 ? candColor(r.cands, sm.lead) : 'var(--oth)', text: sm.lead >= 0 ? `${candShort(r.cands[sm.lead])} +${fPct(sm.marginPct)}` : 'tied',
      tip: () => tipContent(e.name, [{ color: sm.lead >= 0 ? candColor(r.cands, sm.lead) : null, label: sm.lead >= 0 ? `${candShort(r.cands[sm.lead])} leads` : 'Tied', value: `${fPct(sm.marginPct)} · ${fInt(sm.margin)} votes` }]) }; }),
    { rowH: 46, rightPad: Math.min(170, w * .32), labelW: Math.min(150, w * .28), fmt: v => fPct(v), axisFmt: v => v + '%' });
  api.label(`Winning margin in ${r.name} for ${cmpNames()}.`);
}
function drawCmpCount(host, w, api) {
  const r = cmpRace(); if (!r) return;
  const rows = cmpRaceRows(r);
  kitBars(host, w, rows.map(e => { const pct = e.ci === -1 ? stateReporting().precinctPct : countyReportingPct(e.ci), sm = e.sm, bc = e.ci === -1 ? null : ballotsCast(RLAST, e.ci), skip = sm && sm.total && bc ? 100 * (1 - sm.total / bc) : null;
    return { label: e.name, dot: e.color, sub: sm ? `${fInt(sm.total)} votes${skip != null ? ` · ${fPct(skip)} skipped` : ''}` : 'not in this race', value: pct == null ? 0 : pct, color: 'var(--early)', text: pct == null ? 'not reporting' : fPct(pct, 0),
      tip: () => tipContent(e.name, [{ label: 'Precincts reporting', value: pct == null ? '—' : fPct(pct, 0) }, { label: 'Votes in this race', value: sm ? fInt(sm.total) : '—' }, ...(bc ? [{ label: 'Ballots cast', value: fInt(bc) }] : []), ...(skip != null ? [{ label: 'Skipped this race', value: fPct(skip) }] : [])]) }; }),
    { rowH: 46, max: 100, rightPad: 100, labelW: Math.min(170, w * .3), axisFmt: v => v + '%' });
  api.label(`How much of the count is in for ${cmpNames()}.`);
}
function drawCmpMethod(host, w, api) {
  const r = cmpRace(); if (!r) return;
  const hd = contestHandle(r.id), P = [['Election Day', 'var(--ed)', 0], ['Early voting', 'var(--early)', 1], ['Mail', 'var(--mail)', 2]];
  const rows = cmpEnts().map(e => { const mt = methodTotals(hd, e.ci === -1 ? null : e.ci), parts = P.map(([l, c, i]) => ({ label: l, color: c, value: sum(mt.rows.map(x => x.parts[i])) })), tot = sum(parts.map(p => p.value));
    return { label: e.ci === -1 ? 'Florida (sample)' : e.name, dot: e.color, sub: tot ? `${fInt(tot)} votes` : '', parts, text: tot ? fComp(tot) : mt.coverage ? 'no votes yet' : 'no split reported',
      tip: () => tipContent(e.name, parts.map(p => ({ color: p.color, label: p.label, value: `${fInt(p.value)}  (${fPct(tot ? 100 * p.value / tot : 0)})` })), e.ci === -1 ? `${mt.coverage} counties report the split` : 'From the county election site') }; });
  if (!rows.some(x => x.parts.some(p => p.value > 0))) { emptyCard(host, 'No voting-method split yet. It appears once a county’s election site reports votes by Election Day, early voting and mail.'); api.label('No data yet.'); return; }
  kitStack(host, w, rows, { mode: 'share', rowH: 50, barH: 24, rightPad: 90, labelW: Math.min(160, w * .3) });
  api.label(`How the votes in ${r.name} were cast, by county.`);
}
function drawCmpTime(host, w, api) {
  const r = cmpRace(); if (!r) return;
  const st = raceSum(r, -1); if (!st || !st.total) { emptyCard(host, 'No votes are counted yet. Once they are, this follows each county’s count through the night.'); api.label('No data yet.'); return; }
  if (CMP.cand < 0 || CMP.cand >= r.cands.length || CMP.candRace !== r.id) { CMP.cand = st.lead >= 0 ? st.lead : 0; CMP.candRace = r.id; }
  const k = CMP.cand, xs = RSNAPS.map(x => new Date(x.t).getTime());
  const series = cmpEnts().map(e => ({ name: e.name, color: e.color, dash: e.ci === -1 ? '5 4' : null, width: e.ci === -1 ? 1.5 : 2.5,
    ys: RSNAPS.map((_, s) => { const sm = e.ci === -1 ? raceSum(r, -1, s) : r.rowIdx.has(e.ci) ? raceSum(r, e.ci, s) : null; return sm && sm.total ? sm.shares[k] : null; }), tip: i => { const sm = e.ci === -1 ? raceSum(r, -1, i) : r.rowIdx.has(e.ci) ? raceSum(r, e.ci, i) : null; return sm && sm.total ? `${fPct(sm.shares[k])}  (${fInt(sm.v[k])} votes)` : '—'; } }));
  kitLines(host, w, xs, series, { yFmt: v => v + '%', endFmt: v => fPct(v), yMin: 0, xFmt: (m, i) => fmtClock(RSNAPS[i].t), tipHead: i => `${snapLabel(i)} ET`, height: clamp(Math.round(w * .3), 260, 340) });
  api.label(`${candShort(r.cands[k])}'s share of the vote in each county over the saved snapshots.`);
}

/* ---- turnout side by side ---- */
function cmpTiles() {
  return live(h('div', { id: 'cmp-tiles' }), () => h('div', { class: 'cmp-tiles' }, cmpEnts().map(e => { const T = totalsFor(e.ci === -1 ? null : e.ci), c = e.ci === -1 ? null : C[e.ci], pct = x => 100 * x / T.reg;
    return h('div', { class: 'cmp-tile', style: { borderTopColor: e.color } }, h('div', { class: 'nm' }, h('i', { style: { background: e.color } }), e.name), h('div', { class: 'big' }, fPct(T.rate)),
      h('div', { class: 's' }, `${fInt(T.total)} of ${fInt(T.reg)} registered`), h('div', { class: 's' }, c ? `#${c.rank} of ${N} · ${fPts(T.rate - ST.rate)} vs Florida` : 'the statewide rate'),
      h('div', { class: 'meter', role: 'img', 'aria-label': `${e.name}: mail ${fPct(pct(T.mail), 1)}, early ${fPct(pct(T.early), 1)}${HAS_ED ? `, Election Day ${fPct(pct(T.ed), 1)}` : ''} of registered voters` },
        h('i', { style: { width: pct(T.mail) + '%', background: 'var(--mail)' } }), h('i', { style: { width: pct(T.early) + '%', background: 'var(--early)' } }), HAS_ED ? h('i', { style: { width: pct(T.ed) + '%', background: 'var(--ed)' } }) : null));
  })));
}
function drawCmpPace(host, w, api) {
  const rows = DAY.slice(START), xs = rows.map(d => d.ms), daily = CMP.pace === 'day';
  const series = cmpEnts().map(e => { const cum = e.ci === -1 ? CUM : cumulativeOf(dayRows(e.ci)), reg = e.ci === -1 ? ST.reg : C[e.ci].reg, dr = e.ci === -1 ? DAY : dayRows(e.ci);
    return { name: e.name, color: e.color, dash: e.ci === -1 ? '5 4' : null, width: e.ci === -1 ? 1.5 : 2.5, ys: rows.map((_, i) => daily ? 100 * dr[START + i].total / reg : 100 * cum.total[START + i] / reg), tip: i => daily ? `${fPct(100 * dr[START + i].total / reg, 2)}  (${fInt(dr[START + i].total)} ballots)` : `${fPct(100 * cum.total[START + i] / reg)}  (${fInt(cum.total[START + i])} ballots)` }; });
  kitLines(host, w, xs, series, { yFmt: v => v + '%', endFmt: v => fPct(v, daily ? 2 : 1), xFmt: (m, i) => rows[i].short, tipHead: i => rows[i].long, height: clamp(Math.round(w * .3), 280, 360) });
  api.label(`${daily ? 'Ballots each day' : 'Cumulative ballots'} as a share of registered voters for ${cmpNames()}.`);
}
function drawCmpType(host, w, api) {
  kitStack(host, w, cmpEnts().map(e => { const T = totalsFor(e.ci === -1 ? null : e.ci), tot = T.mail + T.early + T.ed;
    return { label: e.name, dot: e.color, sub: `${fInt(T.total)} ballots`, parts: [{ label: 'Mail', color: 'var(--mail)', value: T.mail }, { label: 'Early voting', color: 'var(--early)', value: T.early }, ...(HAS_ED ? [{ label: 'Election Day', color: 'var(--ed)', value: T.ed }] : [])], text: fComp(T.total),
      tip: () => tipContent(e.name, typeRows(T.mail, T.early, T.ed).map(r => ({ ...r, value: `${r.value}  (${fPct(100 * parseInt(r.value.replace(/,/g, ''), 10) / (tot || 1))})` }))) }; }),
    { mode: 'share', rowH: 50, barH: 24, rightPad: 70, labelW: Math.min(160, w * .3) });
  api.label(`Mail, early and Election Day share of ballots for ${cmpNames()}.`);
}
function drawCmpParty(host, w, api) {
  const mode = CMP.party;
  if (mode === 'rate') {
    const rows = PARTIES.map(g => ({ label: g.k === 'NPA' ? 'No party' : g.name, sub: 'turnout rate', dots: cmpEnts().map(e => { const s2 = partyStatsFor(e.ci === -1 ? null : e.ci).find(x => x.k === g.k); return { v: s2 && s2.reg ? s2.rate : null, color: e.color, name: e.name }; }) }));
    kitDots(host, w, rows, { min: 0, fmt: v => fPct(v), axisFmt: v => v + '%', rowH: 54 });
    api.label(`Turnout rate by party group for ${cmpNames()}.`); return;
  }
  kitStack(host, w, cmpEnts().map(e => { const g = partyStatsFor(e.ci === -1 ? null : e.ci), key = mode === 'ballots' ? 'bal' : 'reg', tot = sum(g.map(p => p[key]));
    return { label: e.name, dot: e.color, sub: `${fInt(tot)} ${mode === 'ballots' ? 'ballots' : 'registered'}`, parts: g.map(p => ({ label: p.name, color: p.color, value: p[key] })), text: fComp(tot),
      tip: () => tipContent(e.name, g.map(p => ({ color: p.color, label: p.name, value: `${fInt(p[key])}  (${fPct(tot ? 100 * p[key] / tot : 0)})` })), mode === 'ballots' ? 'Share of ballots cast so far' : 'Share of registered voters') }; }),
    { mode: 'share', rowH: 50, barH: 24, rightPad: 70, labelW: Math.min(160, w * .3) });
  api.label(`${mode === 'ballots' ? 'Share of ballots' : 'Share of registered voters'} by party for ${cmpNames()}.`);
}
function drawCmpSpread(host, w, api) {
  const rows = cmpEnts().map(e => { const v = (e.ci === -1 ? PR : PR.filter(p => p.c === e.ci)).map(p => p.rate); return v.length >= 5 ? { label: e.name, sub: `${fInt(v.length)} precincts`, color: e.color, dot: e.color, st: boxStats(v) } : null; }).filter(Boolean);
  if (!rows.length) { emptyCard(host, 'Too few precincts with 50 or more registered voters.'); return; }
  kitBoxes(host, w, rows);
  api.label(`Box plots of precinct turnout for ${cmpNames()}.`);
}
function drawCmpSites(host, w, api) {
  const rows = cmpEnts().map(e => { const s2 = e.ci === -1 ? SITES : SITES.filter(x => x.c === e.ci), n = s2.length, tot = sum(s2.map(x => x.t));
    return { label: e.name, dot: e.color, sub: n ? `${n} sites · busiest ${fComp(Math.max(...s2.map(x => x.t)))}` : 'no site totals', value: n ? tot / n : 0, color: e.color, text: n ? fInt(tot / n) : '—',
      tip: () => tipContent(e.name, [{ label: 'Early-voting sites', value: fInt(n) }, { label: 'Ballots at sites', value: fInt(tot) }, { label: 'Average per site', value: n ? fInt(tot / n) : '—' }, ...(n ? [{ label: 'Median site', value: fInt(median(s2.map(x => x.t))) }] : [])]) }; });
  kitBars(host, w, rows, { rowH: 46, rightPad: 80, labelW: Math.min(190, w * .34), fmt: fComp });
  api.label(`Average early-voting ballots per site for ${cmpNames()}.`);
}
function drawCmpWeek(host, w, api) {
  const order = [1, 2, 3, 4, 5, 6, 0], avgs = cmpEnts().map(e => ({ e, avg: weekdayStats(e.ci === -1 ? DAY : dayRows(e.ci)).avg }));
  const rows = order.map(d => ({ label: WDNAME[d], dots: avgs.map(({ e, avg }) => { const t = sum(avg.map(v => v || 0)); return { v: avg[d] != null && t ? 100 * avg[d] / t : null, color: e.color, name: e.name }; }) }));
  kitDots(host, w, rows, { min: 0, fmt: v => fPct(v, 0), axisFmt: v => v + '%', rowH: 40 });
  api.label(`Share of early-voting-window ballots on each weekday for ${cmpNames()}.`);
}
function drawCmpBallot(host, w, api) {
  if (!HAS_RESULTS) { emptyCard(host, 'County ballots come from the county election sites, which have no results page yet.'); return; }
  const kinds = [...LOCAL_KINDS.map(([k]) => k), 'Other local'], ents = cmpEnts(false);
  const counts = ents.map(e => { const b = countyBallot(e.ci); return { e, label: e.name, n: b.length, byKind: kinds.map(k => b.filter(l => l.sw < 0 && localKind(l.name) === k).length), statewide: b.filter(l => l.sw >= 0).length }; });
  if (!counts.some(x => x.n)) { emptyCard(host, 'None of these counties has published a 2026 general-election results page yet, so their local ballots are not available.'); api.label('No data yet.'); return; }
  kitHeat(host, w, counts, [...kinds.map(k => ({ label: k.split(' ')[0], top: '' })), { label: 'Statewide', top: '' }], (i, j) => j < kinds.length ? counts[i].byKind[j] : counts[i].statewide,
    { rowH: 34, labelW: Math.min(150, w * .26), legendHi: mx => `${mx} contests`, legendLo: '0', click: null,
      tip: (i, j, v) => tipContent(counts[i].e.name, [{ label: j < kinds.length ? kinds[j] : 'Statewide races on this ballot', value: fInt(v || 0) }, { label: 'All contests on the county ballot', value: fInt(counts[i].n) }]) });
  api.label('How many contests of each kind are on each county’s ballot.');
}
function cmpTableRows() {
  const ents = cmpEnts(), g = (fn, fl) => ents.map(e => e.ci === -1 ? fl() : fn(C[e.ci])), sec = t => ({ sec: t });
  const T = k => totalsFor(null)[k];
  const rows = [sec('Size and turnout'),
    { l: 'Registered voters', v: g(c => fInt(c.reg), () => fInt(ST.reg)) }, { l: 'Ballots cast', v: g(c => fInt(c.total), () => fInt(ST.total)) }, { l: 'Turnout', v: g(c => fPct(c.rate, 2), () => fPct(ST.rate, 2)) },
    { l: 'Turnout rank', v: g(c => `#${c.rank} of ${N}`, () => '—') }, { l: 'Precincts', v: g(c => fInt(c.precincts || 0), () => fInt(sum(C.map(c => c.precincts || 0)))) },
    { l: 'Early-voting sites reporting', v: g(c => fInt(SITES.filter(x => x.c === c.i).length), () => fInt(SITES.length)) },
    sec('How they voted'),
    { l: 'By mail', v: g(c => fPct(100 * c.mail / (c.total || 1)), () => fPct(100 * ST.mail / ST.total)) }, { l: 'Early in person', v: g(c => fPct(100 * c.early / (c.total || 1)), () => fPct(100 * ST.early / ST.total)) },
    ...(HAS_ED ? [{ l: 'Election Day', v: g(c => fPct(100 * c.ed / (c.total || 1)), () => fPct(100 * ST.ed / ST.total)) }] : []),
    { l: 'Peak day', v: g(c => { const p = peakOf(dayRows(c.i).slice(START)); return `${p.short} (${fComp(p.total)})`; }, () => `${PEAK.short} (${fComp(PEAK.total)})`) },
    sec('Party'),
    ...PARTIES.slice(0, 3).flatMap(p => [{ l: `${p.who}, share of registered`, v: g(c => fPct(partyStatsFor(c.i).find(x => x.k === p.k).shareReg), () => fPct(p.shareReg)) }, { l: `${p.who}, turnout`, v: g(c => fPct(partyStatsFor(c.i).find(x => x.k === p.k).rate), () => fPct(p.rate)) }]),
    { l: 'Republican minus Democratic turnout', v: g(c => `${fPts(c.gap)} pts`, () => `${fPts(PARTY.REP.rate - PARTY.DEM.rate)} pts`) }];
  const r = HAS_RESULTS ? cmpRace() : null;
  if (r && anyResults()) rows.push(sec(r.name), { l: 'Votes counted', v: ents.map(e => { const sm = e.ci === -1 ? raceSum(r, -1) : r.rowIdx.has(e.ci) ? raceSum(r, e.ci) : null; return sm ? fInt(sm.total) : '—'; }) },
    { l: 'Leading', v: ents.map(e => { const sm = e.ci === -1 ? raceSum(r, -1) : r.rowIdx.has(e.ci) ? raceSum(r, e.ci) : null; return sm && sm.total && sm.lead >= 0 ? `${candShort(r.cands[sm.lead])} ${fPct(sm.shares[sm.lead])}` : '—'; }) },
    { l: 'Margin', v: ents.map(e => { const sm = e.ci === -1 ? raceSum(r, -1) : r.rowIdx.has(e.ci) ? raceSum(r, e.ci) : null; return sm && sm.total ? `${fPct(sm.marginPct)} (${fInt(sm.margin)})` : '—'; }) },
    { l: 'Precincts reporting', v: ents.map(e => { const p = e.ci === -1 ? stateReporting().precinctPct : countyReportingPct(e.ci); return p == null ? '—' : fPct(p, 0); }) });
  return { ents, rows };
}
function drawCmpTable(host) {
  const { ents, rows } = cmpTableRows();
  host.append(h('div', { class: 'dtable-wrap', tabindex: 0, role: 'region', 'aria-label': 'County comparison table' }, h('table', { class: 'dtable cmp-table' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Measure'), ents.map(e => h('th', { scope: 'col' }, h('i', { style: { background: e.color } }), e.name)))),
    h('tbody', null, rows.map(r => r.sec ? h('tr', { class: 'grp' }, h('th', { scope: 'rowgroup', colspan: ents.length + 1 }, r.sec)) : h('tr', null, h('th', { scope: 'row' }, r.l), r.v.map(x => h('td', null, x))))))));
}

/* ---- cards ---- */
const cmpTitleRace = pre => { const r = cmpRace(); return r ? pre(r) : 'Compare a race'; };
function cmpShareCard() {
  return card({
    id: 'cmp-share', kicker: '100% stacked bar chart', cat: 'mochi', stack: true,
    title: () => cmpTitleRace(r => { const rows = cmpRaceRows(r).filter(e => e.ci !== -1 && e.sm && e.sm.total && e.sm.lead >= 0); if (!anyResults() || !rows.length) return `${r.name}: how ${cmpNames()} are set up`; const leads = new Set(rows.map(e => candShort(r.cands[e.sm.lead]))); return leads.size === 1 ? `${[...leads][0]} leads in all ${rows.length === 1 ? 'of it' : plural(rows.length, 'county', 'counties')}` : `${r.name}: ${plural(leads.size, 'candidate')} lead across these counties`; }),
    sub: () => cmpTitleRace(r => `${r.name}. One bar per county; the bar is split by each candidate’s share of the votes counted there.`),
    legend: () => { const r = cmpRace(), st = r && raceSum(r, -1); if (!r) return []; if (!st || !st.total) return PARTIES.map(p => ({ color: p.color, label: p.name })); return [...st.order.slice(0, 4).map(k => ({ color: candColor(r.cands, k), label: candShort(r.cands[k]) })), { color: 'var(--oth)', label: 'Others' }]; },
    draw: drawCmpShare,
    notes: {
      what: 'A 100% stacked bar gives each county a bar of the same length, so you compare the mix of votes instead of the county sizes.',
      how: 'Colors are the candidates (red Republican, blue Democratic, yellow independent). Hover a bar for the votes behind each slice. The dot beside a county name is that county’s color in the line charts below.',
      shows: () => { const r = cmpRace(); if (!r || !anyResults()) return 'Before votes are counted this shows registered voters by party, as context.'; const rows = cmpRaceRows(r).filter(e => e.ci !== -1 && e.sm && e.sm.total && e.sm.lead >= 0).sort((a, b) => b.sm.marginPct - a.sm.marginPct); return rows.length ? `Biggest margin: **${rows[0].name}** (**${fPct(rows[0].sm.marginPct)}**). Closest: **${rows[rows.length - 1].name}** (**${fPct(rows[rows.length - 1].sm.marginPct)}**).` : 'No county in this set has counted votes in this race yet.'; },
      watch: 'Shares are of votes counted so far. A county that has counted only its early ballots can look very different from its final result.',
    },
    table: () => { const r = cmpRace(); if (!r) return { head: ['County'], rows: [] }; const st = raceSum(r, -1), order = st && st.total ? st.order.slice(0, 4) : r.cands.map((_, i) => i).slice(0, 4); return { head: ['County', ...order.map(k => candShort(r.cands[k])), 'Votes'], align: ['l', ...order.map(() => 'n'), 'n'], rows: cmpRaceRows(r).map(e => [e.name, ...order.map(k => e.sm && e.sm.total ? fPct(e.sm.shares[k], 1) : '—'), e.sm ? fInt(e.sm.total) : '—']) }; },
  });
}
function cmpMarginCard() {
  return card({
    id: 'cmp-margin', kicker: 'Ranked bar chart', cat: 'pearl', stack: true,
    title: () => cmpTitleRace(r => `Winning margin in ${r.name}`), sub: 'Leader’s lead over second place, in points of the votes counted. The bar takes the leader’s color.',
    draw: drawCmpMargin,
    notes: {
      what: 'A margin is the gap between the top two candidates. Points of share let a small county and a huge one share one axis.',
      how: 'Bar length is the margin in percentage points; color is the leader. Under each name is the margin in raw votes.',
      shows: () => { const r = cmpRace(); if (!r || !anyResults()) return 'Margins appear once votes are counted.'; const rows = cmpRaceRows(r).filter(e => e.ci !== -1 && e.sm && e.sm.total); return rows.length ? `${rows.map(e => `**${e.name}**: ${fPct(e.sm.marginPct)}`).join(', ')}.` : 'Nothing counted yet in these counties.'; },
      watch: 'A big margin in votes is not a big margin in points, and vice versa. A county that has counted little can swing a lot.',
    },
    table: () => { const r = cmpRace(); if (!r) return { head: ['County'], rows: [] }; return { head: ['County', 'Leader', 'Margin (pts)', 'Margin (votes)'], align: ['l', 'l', 'n', 'n'], rows: cmpRaceRows(r).map(e => [e.name, e.sm && e.sm.lead >= 0 ? candShort(r.cands[e.sm.lead]) : '—', e.sm && e.sm.total ? fPct(e.sm.marginPct, 2) : '—', e.sm && e.sm.total ? fInt(e.sm.margin) : '—']) }; },
  });
}
function cmpCountCard() {
  return card({
    id: 'cmp-count', kicker: 'Bar chart', cat: 'mochi', stack: true,
    title: () => cmpTitleRace(r => `How much of the count is in, for ${r.name}`), sub: 'Share of precincts reporting in each county (Florida Election Watch). Under each name: votes in this race and the share of ballots that skipped it.',
    draw: drawCmpCount,
    notes: {
      what: 'Reporting progress tells you how far to trust a lead. A county at 20% of precincts can still change a lot.',
      how: 'Bar length is the share of precincts that have posted results. "Skipped" is the gap between ballots cast and votes in this race.',
      shows: () => { const r = cmpRace(); if (!r) return ''; const rows = cmpEnts(false).map(e => ({ e, p: countyReportingPct(e.ci) })).filter(x => x.p != null); return rows.length ? rows.map(x => `**${x.e.name}** ${fPct(x.p, 0)}`).join(', ') + ' of precincts reporting.' : 'No county in this set has started reporting.'; },
      watch: 'A precinct counts as "reporting" once it posts anything, so 100% does not mean every ballot is counted.',
    },
    table: () => { const r = cmpRace(); if (!r) return { head: ['County'], rows: [] }; return { head: ['County', 'Precincts reporting', 'Votes in race', 'Ballots cast'], align: ['l', 'n', 'n', 'n'], rows: cmpRaceRows(r).map(e => { const p = e.ci === -1 ? stateReporting().precinctPct : countyReportingPct(e.ci); return [e.name, p == null ? '—' : fPct(p, 1), e.sm ? fInt(e.sm.total) : '—', e.ci === -1 ? '—' : fInt(ballotsCast(RLAST, e.ci))]; }) }; },
  });
}
function cmpMethodCard() {
  return card({
    id: 'cmp-method', kicker: '100% stacked bar chart', cat: 'pearl', stack: true,
    title: () => cmpTitleRace(r => `How ${r.name} votes were cast, county by county`), sub: 'Election Day, early voting and mail, from each county’s own election site.',
    legend: () => [{ color: 'var(--ed)', label: 'Election Day' }, { color: 'var(--early)', label: 'Early voting' }, { color: 'var(--mail)', label: 'Mail' }],
    draw: drawCmpMethod,
    notes: {
      what: 'Votes arrive by different routes, and each route can lean differently. This shows the mix for each county.',
      how: 'Every bar is full length. The Florida bar covers only counties whose sites publish the split, so it is a sample.',
      shows: () => 'Counties that count mail first look different early in the night than they do later.',
      watch: 'Counties that do not publish the split show "no split reported". That is a gap in the data, not a county with no mail votes.',
    },
    table: () => { const r = cmpRace(); if (!r) return { head: ['County'], rows: [] }; const hd = contestHandle(r.id); return { head: ['County', 'Election Day', 'Early', 'Mail'], align: ['l', 'n', 'n', 'n'], rows: cmpEnts().map(e => { const mt = methodTotals(hd, e.ci === -1 ? null : e.ci); return [e.name, ...[0, 1, 2].map(i => fInt(sum(mt.rows.map(x => x.parts[i]))))]; }) }; },
  });
}
function cmpTimeCard() {
  let api;
  const pick = live(h('div'), () => { const r = cmpRace(); return r ? selectOf('Candidate', r.cands.map((c, k) => [k, `${candShort(c)} (${c[1] || 'NP'})`]), CMP.cand, v => { CMP.cand = +v; api.redraw(); }) : null; });
  api = card({
    id: 'cmp-time', kicker: 'Line chart', cat: 'pearl', stack: true, controls: [pick],
    title: () => cmpTitleRace(r => `How one candidate’s share moved in each county: ${r.name}`), sub: () => `${RSNAPS.length} saved snapshot${RSNAPS.length === 1 ? '' : 's'}. One line per county; Florida is the dashed line.`,
    draw: drawCmpTime,
    notes: {
      what: 'Each line is one county’s share for the chosen candidate at every saved pull. Lines that drift apart show counties moving in different directions.',
      how: 'Pick a candidate above. Colors match the dots beside county names. Hover for the votes behind each point.',
      shows: () => 'A county line that jumps tells you a big batch of ballots landed in that pull.',
      watch: 'Early points rest on few votes and move a lot. Judge a line by where it settles.',
    },
    table: () => { const r = cmpRace(); if (!r || CMP.cand < 0) return { head: ['Snapshot'], rows: [] }; const ents = cmpEnts(); return { head: ['Snapshot', ...ents.map(e => e.name)], align: ['l', ...ents.map(() => 'n')], rows: RSNAPS.map((x, s) => [snapLabel(s), ...ents.map(e => { const sm = e.ci === -1 ? raceSum(r, -1, s) : r.rowIdx.has(e.ci) ? raceSum(r, e.ci, s) : null; return sm && sm.total ? fPct(sm.shares[CMP.cand], 1) : '—'; })]) }; },
  });
  return api;
}
function cmpPaceCard() {
  let api;
  const seg = segmented('Show', [['cum', 'Running total'], ['day', 'Each day']], CMP.pace, v => { CMP.pace = v; api.redraw(); });
  api = card({
    id: 'cmp-pace', kicker: 'Line chart', cat: 'mochi', stack: true, controls: [seg],
    title: () => CMP.pace === 'cum' ? `How fast ${cmpNames()} voted` : 'Ballots each day, as a share of registered voters', sub: () => CMP.pace === 'cum' ? 'Cumulative ballots as a percent of each county’s registered voters. Florida is the dashed line.' : 'Each point is one day’s ballots divided by registered voters.',
    draw: drawCmpPace,
    notes: {
      what: 'Dividing by registered voters puts a giant county and a tiny one on the same scale, so the lines show habits instead of size.',
      how: 'Running total: each line climbs toward the county’s final turnout. Each day: the line shows the daily pulse, so you can see which county rushes early and which waits.',
      shows: () => { const rows = cmpEnts(false).map(e => ({ e, r: C[e.ci].rate })).sort((a, b) => b.r - a.r); return rows.length > 1 ? `**${rows[0].e.name}** is highest at **${fPct(rows[0].r)}**; **${rows[rows.length - 1].e.name}** lowest at **${fPct(rows[rows.length - 1].r)}**.` : `**${rows[0].e.name}** is at **${fPct(rows[0].r)}** turnout.`; },
      watch: 'Two counties can end at the same turnout by very different routes. The shape matters as much as the finish.',
    },
    table: () => { const rows = DAY.slice(START), ents = cmpEnts(); return { head: ['Day', ...ents.map(e => e.name)], align: ['l', ...ents.map(() => 'n')], rows: rows.map((d, i) => [d.short, ...ents.map(e => { const cum = e.ci === -1 ? CUM : cumulativeOf(dayRows(e.ci)); return fPct(100 * cum.total[START + i] / (e.ci === -1 ? ST.reg : C[e.ci].reg), 2); })]) }; },
  });
  return api;
}
function cmpTypeCard() {
  return card({
    id: 'cmp-type', kicker: '100% stacked bar chart', cat: 'mochi', stack: true,
    title: () => `Mail, early and Election Day: how ${cmpNames()} chose to vote`, sub: 'Share of each county’s ballots by how they were cast.', legend: typeLegend, draw: drawCmpType,
    notes: {
      what: 'The same 100% stacked bar as before, one row per county, so the mix of voting routes is easy to compare.',
      how: 'Green is mail, purple early voting' + (HAS_ED ? ', brown Election Day.' : '.') + ' The number at the end is the county’s total ballots.',
      shows: () => { const rows = cmpEnts(false).map(e => ({ e, m: C[e.ci].mailShare })).sort((a, b) => b.m - a.m); return `**${rows[0].e.name}** leans on mail most (**${fPct(rows[0].m, 0)}**)${rows.length > 1 ? `; **${rows[rows.length - 1].e.name}** least (**${fPct(rows[rows.length - 1].m, 0)}**)` : ''}.`; },
      watch: 'Counties differ in what they offer: how many early sites, how easy mail is. Habits reflect options as much as preferences.',
    },
    table: () => ({ head: ['County', 'Mail', 'Early voting', ...(HAS_ED ? ['Election Day'] : []), 'Total'], align: ['l', 'n', 'n', ...(HAS_ED ? ['n'] : []), 'n'], rows: cmpEnts().map(e => { const T = totalsFor(e.ci === -1 ? null : e.ci); return [e.name, fInt(T.mail), fInt(T.early), ...(HAS_ED ? [fInt(T.ed)] : []), fInt(T.total)]; }) }),
  });
}
function cmpPartyCard() {
  let api;
  const seg = segmented('Show', [['ballots', 'Share of ballots'], ['registered', 'Share of registered'], ['rate', 'Turnout rate']], CMP.party, v => { CMP.party = v; api.redraw(); });
  api = card({
    id: 'cmp-party', kicker: '100% stacked bar chart and dot plot', cat: 'pearl', stack: true, controls: [seg],
    title: () => CMP.party === 'rate' ? `Which party’s voters turn out most in ${cmpNames()}` : CMP.party === 'ballots' ? 'Who has cast the ballots, by party registration' : 'How each county’s registered voters split by party',
    sub: () => CMP.party === 'rate' ? 'One dot per county on each row. Dots take the county colors.' : 'Red Republican, blue Democratic, yellow no party (independent), gray minor parties.',
    legend: () => CMP.party === 'rate' ? cmpEnts().map(e => ({ type: 'dot', color: e.color, label: e.name })) : PARTIES.map(p => ({ color: p.color, label: p.name })), draw: drawCmpParty,
    notes: {
      what: 'Party here is how a voter registered. Switch views to compare who is registered, who has voted, and how likely each group is to vote.',
      how: 'Bars are shares of one county’s total. In the turnout-rate view each row is a party group and each dot a county, so you can see which county’s Democrats (or Republicans) vote more.',
      shows: () => { const es = cmpEnts(false), d = es.map(e => ({ e, g: partyStatsFor(e.ci) })); const top = d.map(x => ({ n: x.e.name, r: x.g.find(p => p.k === 'REP').rate, dm: x.g.find(p => p.k === 'DEM').rate })); return top.map(x => `**${x.n}**: Republicans ${fPct(x.r)}, Democrats ${fPct(x.dm)}`).join('; ') + ' turnout.'; },
      watch: 'Registration is not a vote. The data does not record how anyone voted.',
    },
    table: () => ({ head: ['County', ...PARTIES.map(p => p.name + (CMP.party === 'rate' ? ' turnout' : ''))], align: ['l', ...PARTIES.map(() => 'n')], rows: cmpEnts().map(e => { const g = partyStatsFor(e.ci === -1 ? null : e.ci), key = CMP.party === 'ballots' ? 'bal' : 'reg'; return [e.name, ...g.map(p => CMP.party === 'rate' ? fPct(p.rate) : fInt(p[key]))]; }) }),
  });
  return api;
}
function cmpSpreadCard() {
  return card({
    id: 'cmp-spread', kicker: 'Box plot', cat: 'pearl', stack: true,
    title: () => `How uneven is turnout inside ${cmpNames()}?`, sub: 'Turnout of every precinct with at least 50 registered voters. Box: middle half; line: median.', draw: drawCmpSpread,
    notes: {
      what: 'A box plot squeezes all the precincts of a county into five numbers, so you can compare how spread out turnout is.',
      how: 'The box is the middle half of precincts, the white notch the median, the whiskers the typical range and dots the outliers.',
      shows: () => { const rows = cmpEnts(false).map(e => { const v = PR.filter(p => p.c === e.ci).map(p => p.rate); return v.length >= 5 ? { n: e.name, iqr: iqr(v) } : null; }).filter(Boolean).sort((a, b) => b.iqr - a.iqr); return rows.length ? `Most uneven: **${rows[0].n}** (middle half spans **${rows[0].iqr.toFixed(1)}** points).` : 'Too few precincts to compare.'; },
      watch: 'A wide box can mean real differences between neighborhoods, or just many tiny precincts that swing by chance.',
    },
    table: () => ({ head: ['County', 'Precincts', 'Median', 'Q1', 'Q3'], align: ['l', 'n', 'n', 'n', 'n'], rows: cmpEnts().map(e => { const v = (e.ci === -1 ? PR : PR.filter(p => p.c === e.ci)).map(p => p.rate); if (v.length < 5) return [e.name, fInt(v.length), '—', '—', '—']; const b = boxStats(v); return [e.name, fInt(v.length), fPct(b.med), fPct(b.q1), fPct(b.q3)]; }) }),
  });
}
function cmpSitesCard() {
  return card({
    id: 'cmp-sites', kicker: 'Bar chart', cat: 'mochi', stack: true,
    title: () => 'How busy was the average early-voting site?', sub: 'Early-voting ballots divided by the number of sites that reported. Under each name: number of sites and the busiest one.', draw: drawCmpSites,
    notes: { what: 'Ballots per site tells you how crowded voting was, which counts alone cannot.', how: 'Bar length is the average ballots at a site. A county with few sites and many voters gets a long bar.', shows: () => { const rows = cmpEnts(false).map(e => { const s2 = SITES.filter(x => x.c === e.ci); return s2.length ? { n: e.name, a: sum(s2.map(x => x.t)) / s2.length } : null; }).filter(Boolean).sort((a, b) => b.a - a.a); return rows.length ? `**${rows[0].n}** averages **${fInt(rows[0].a)}** ballots per site.` : 'No site totals for these counties.'; }, watch: 'Counties differ in how many days sites were open and whether they report every site.' },
    table: () => ({ head: ['County', 'Sites', 'Ballots at sites', 'Average per site'], align: ['l', 'n', 'n', 'n'], rows: cmpEnts().map(e => { const s2 = e.ci === -1 ? SITES : SITES.filter(x => x.c === e.ci), t = sum(s2.map(x => x.t)); return [e.name, fInt(s2.length), fInt(t), s2.length ? fInt(t / s2.length) : '—']; }) }),
  });
}
function cmpWeekCard() {
  return card({
    id: 'cmp-week', kicker: 'Dot plot', cat: 'pearl', stack: true,
    title: () => 'Which weekday does each county vote on?', sub: 'Average ballots per weekday during early voting, as a share of the week. One dot per county on each row.',
    legend: () => cmpEnts().map(e => ({ type: 'dot', color: e.color, label: e.name })), draw: drawCmpWeek,
    notes: { what: 'A dot plot puts one dot per group on a shared scale, so you see the spread and the gaps between groups on each row.', how: 'Right means a bigger share of the week’s early ballots arrived that weekday. If every dot sat at 14% the week would be perfectly even.', shows: () => { const es = cmpEnts(false), best = es.map(e => ({ n: e.name, d: WDNAME[weekdayStats(dayRows(e.ci)).best] })); return best.map(x => `**${x.n}**: busiest on ${x.d}s`).join('; ') + '.'; }, watch: 'Early voting does not run on the same days everywhere, so a weekday with no sites open looks quiet.' },
    table: () => { const order = [1, 2, 3, 4, 5, 6, 0], ents = cmpEnts(); return { head: ['Weekday', ...ents.map(e => e.name)], align: ['l', ...ents.map(() => 'n')], rows: order.map(d => [WDNAME[d], ...ents.map(e => { const a = weekdayStats(e.ci === -1 ? DAY : dayRows(e.ci)).avg, t = sum(a.map(v => v || 0)); return a[d] != null && t ? fPct(100 * a[d] / t, 1) : '—'; })]) }; },
  });
}
function cmpBallotCard() {
  return card({
    id: 'cmp-ballot', kicker: 'Heatmap', cat: 'mochi', stack: true,
    title: () => `What is on the ballot in ${cmpNames()}`, sub: 'Number of contests of each kind on each county’s ballot, from the county election sites.', draw: drawCmpBallot,
    notes: { what: 'Beyond governor and Congress, each county votes on its own commission, school board, sheriff, judges and ballot questions. This counts them.', how: 'Each cell is a number of contests. A darker cell means more of that kind.', shows: () => { const rows = cmpEnts(false).map(e => ({ n: e.name, c: countyBallot(e.ci).length })); return rows.map(x => `**${x.n}**: ${x.c ? plural(x.c, 'contest') : 'no ballot data yet'}`).join('; ') + '.'; }, watch: 'A missing row is a county whose results page is not published yet, not a county with a short ballot.' },
    table: () => ({ head: ['County', 'Contests on the ballot'], align: ['l', 'n'], rows: cmpEnts(false).map(e => [e.name, fInt(countyBallot(e.ci).length)]) }),
  });
}
function cmpTableCard() {
  return card({
    id: 'cmp-table', kicker: 'Table', cat: 'pearl', stack: true, noTable: true,
    title: () => `${cmpNames()}, measure by measure`, sub: 'Every comparison above in one table, with Florida as the last column.', draw: host => drawCmpTable(host),
    notes: { what: 'When you need the exact numbers, a table beats a chart. Every figure on this page is in here.', how: 'Columns are counties, rows are measures. Scroll sideways on a phone; the measure names stay in place.', shows: () => 'Change the counties or the race above and the table follows.', watch: 'Rates divide by active registered voters. Votes in a race are counted votes, not final.' },
  });
}

/* ---- the view ---- */
VIEWS.compare = {
  build() {
    seedCompare();
    const picker = cmpPicker();
    const CH = [
      ...(HAS_RESULTS ? [{ id: 'cmp-race', nav: 'The race', title: () => { const r = cmpRace(); return r ? `${r.name}, county by county` : 'The race'; }, lead: () => anyResults() ? `How **${cmpNames()}** voted in this race, how complete their counts are and how the lead moved.` : 'Votes are not counted yet. Everything in this part fills in as results arrive; until then it shows each county’s ballot and context.',
        cards: () => [cmpForecastStrip(), cmpShareCard().el, cmpMarginCard().el, cmpCountCard().el, cmpMethodCard().el, cmpTimeCard().el] }] : []),
      { id: 'cmp-turnout', nav: 'Turnout', title: 'Turnout, side by side', lead: () => `Who has voted in **${cmpNames()}**, how fast and in what way.`, cards: () => [cmpTiles(), cmpPaceCard().el, cmpTypeCard().el, cmpPartyCard().el] },
      { id: 'cmp-inside', nav: 'Inside', title: 'Inside the counties', lead: 'Precincts, early-voting sites, weekdays and the shape of each county’s ballot.', cards: () => [cmpSpreadCard().el, cmpSitesCard().el, cmpWeekCard().el, ...(HAS_RESULTS ? [cmpBallotCard().el] : [])] },
      { id: 'cmp-all', nav: 'The table', title: 'Everything in one table', lead: 'Exact numbers for every measure, ready to scan across counties.', cards: () => [cmpTableCard().el] },
    ];
    const sub = CH.map(c => ({ id: c.id, label: c.nav }));
    const root = h('div', null, viewHead('Compare counties', () => `Pick one to four counties and compare their turnout and, once votes come in, how they voted in any race. Showing **${cmpNames()}**${CMP.florida ? ' against Florida' : ''}.`), inlineSubnav(sub), picker.el,
      ...CH.map((ch, i) => chapter(ch.id, String(i + 1), ch.title, ch.lead, ch.cards())));
    return { root, sub, picker, refresh() { adoptScope(); picker.render(); setParam('cmp', CMP.slots.map(ci => C[ci].id).join(',')); const r = cmpRace(); if (r) setParam('race', r.id); (viewCache.compare ? viewCache.compare.live : []).forEach(i => i.run()); },
      onParams() { this.onShow(); redrawView('compare'); },
      onShow() { const fromUrl = (param('cmp') || '').split(',').map(id => C.findIndex(c => c.id === id)).filter((i, k, a) => i >= 0 && a.indexOf(i) === k).slice(0, 4); if (fromUrl.length) CMP.slots = fromUrl; if (param('race') && RACE_BY_ID.has(param('race'))) RES.key = param('race'); picker.render(); setParam('cmp', CMP.slots.map(ci => C[ci].id).join(',')); const r = cmpRace(); if (r) setParam('race', r.id); (viewCache.compare ? viewCache.compare.live : []).forEach(i => i.run()); } };
  },
};
