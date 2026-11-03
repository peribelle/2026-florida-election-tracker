/* ---------- results: one race in depth (everything below follows RES.key and the county scope) ---------- */
function contestPicker() {
  return live(h('div'), () => {
    const cur = currentContest(), ci = scopeCi();
    const sel = h('select', { class: 'field', 'aria-label': 'Choose a race', onchange: e => setContest(e.target.value, false) },
      FAMILIES.map(f => h('optgroup', { label: f.label }, RACES.filter(r => familyOf(r) === f && (ci == null || r.rowIdx.has(ci))).map(r => h('option', { value: r.id, ...(cur && cur.key === r.id ? { selected: true } : {}) }, r.name)))),
      ...(ci != null ? [h('optgroup', { label: `Local races in ${C[ci].name}` }, countyBallot(ci).filter(l => l.sw < 0).map(l => h('option', { value: 'L' + l.i, ...(cur && cur.key === 'L' + l.i ? { selected: true } : {}) }, l.name)))] : []));
    return h('label', { class: 'pickers', style: { display: 'grid', gap: '4px', fontSize: '.75rem', fontWeight: 800, color: 'var(--ink-2)' } }, 'RACE', sel);
  });
}
/* the result the cards show: the selected county when the race covers it, otherwise the district or state total */
function scopeResult(hd) {
  const ci = scopeCi();
  if (!hd) return null;
  if (hd.type === 'lr') return { sm: contestSum(hd, hd.ci), where: C[hd.ci].name, local: true, ci: hd.ci, smAll: null };
  if (ci != null && hd.r.rowIdx.has(ci)) return { sm: raceSum(hd.r, ci), where: C[ci].name, ci, smAll: raceSum(hd.r, -1) };
  return { sm: raceSum(hd.r, -1), where: hd.r.rows.length > 69 || hd.r.rows.filter(c => c >= 0).length === N ? 'Florida' : 'the district', ci: -1, outside: ci != null, smAll: null };
}
const kpiTile = (l, v, s) => h('div', { class: 'kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v', style: { fontSize: '1.5rem' } }, v), h('div', { class: 's' }, s));

/* 1. the count */
function drawCount(host, w, api) {
  const hd = currentContest(); if (!hd) { emptyCard(host, 'No race selected.'); return; }
  const R = scopeResult(hd), sm = R.sm, cands = hd.cands, st = R.smAll;
  const order = sm ? sm.order : cands.map((_, i) => i);
  const wrapT = h('div', { class: 'kpis', style: { marginTop: 0, marginBottom: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
    kpiTile('Votes counted', sm && sm.total ? fInt(sm.total) : '0', R.where),
    kpiTile('Leading', sm && sm.lead >= 0 ? candShort(cands[sm.lead]) : '—', sm && sm.lead >= 0 ? `${fPct(sm.shares[sm.lead])} of the vote` : 'no votes yet'),
    kpiTile('Margin', sm && sm.total && sm.lead >= 0 ? `${fPct(sm.marginPct)}` : '—', sm && sm.total && sm.lead >= 0 ? `${fInt(sm.margin)} votes` : ''));
  host.append(wrapT);
  if (R.outside) host.append(h('p', { class: 'mini-note', style: { margin: '0 0 8px' } }, `${scopeName()} is not in this race, so you are seeing the ${R.where} total.`));
  if (hd.type === 'ew' && isYesNo(hd.r) && sm) {
    const yes = sm.total ? sm.shares[hd.r.cands.findIndex(isYes)] : 0, need = hd.r.kind === 'amend' ? 60 : 50;
    host.append(h('div', { class: 'gauge', role: 'img', 'aria-label': `Yes has ${fPct(yes)}; it needs ${need}%` }, h('div', { class: 'fill', style: { width: clamp(yes, 0, 100) + '%' } }),
      h('div', { class: 'mark', style: { left: need + '%' } }, h('span', null, hd.r.kind === 'amend' ? 'needs 60% to pass' : 'needs a majority to be retained')), h('div', { class: 'val' }, sm.total ? `Yes ${fPct(yes)}` : 'Yes —')));
  }
  const box = h('div'); host.append(box);
  const rows = order.map(k => ({ label: candShort(cands[k]), sub: `${cands[k][1] || 'No party'}${st ? ` · Florida ${fPct(st.shares[k])}` : ''}`, value: sm ? sm.v[k] : 0, color: candColor(cands, k), hi: sm && sm.lead === k,
    text: sm && sm.total ? `${fInt(sm.v[k])}  ·  ${fPct(sm.shares[k])}` : '0', tip: () => tipContent(cands[k][0], [{ label: 'Votes', value: fInt(sm ? sm.v[k] : 0) }, { label: 'Share', value: fPct(sm ? sm.shares[k] : 0) }, ...(st ? [{ label: 'Florida share', value: fPct(st.shares[k]) }] : [])], cands[k][1] || null) }));
  kitBars(box, w, rows, { rowH: 36, rightPad: 150, fmt: fComp, axis: false, labelW: Math.min(220, w * .36), max: Math.max(...rows.map(r => r.value), 1) });
  api.label(`Votes by candidate in ${hd.name}, ${R.where}.`);
}
function countCard() {
  return card({
    id: 'r-race', kicker: 'Ranked bar chart', cat: 'mochi', stack: true, controls: [contestPicker()],
    title: () => { const hd = currentContest(), R = scopeResult(hd); return hd ? `${hd.name}: ${leaderPhrase({ cands: hd.cands }, R && R.sm)}${R && R.sm && R.sm.total ? ` in ${R.where}` : ''}` : 'Pick a race'; },
    sub: () => { const hd = currentContest(), R = scopeResult(hd); return hd ? (R && R.sm && R.sm.total ? `${fInt(R.sm.total)} votes counted in ${R.where}. ${scopeC() && hd.type === 'ew' && !R.outside ? 'Gray text under each name shows the statewide share for comparison.' : ''}` : 'Waiting for votes. The candidates on the ballot are listed below.') : ''; },
    draw: drawCount,
    notes: {
      what: 'A ranked bar chart orders candidates by votes. Because every bar starts at zero, the lengths show who is ahead and by how much.',
      how: () => scopeC() ? 'Bars show the votes in your county. Under each name you see the party and the statewide share, so you can tell whether your county leans toward or away from the state.' : 'Bar length is votes. The bold outline marks the leader. The chip color is the party. Pick another race above, or click a row in the board.',
      shows: () => { const hd = currentContest(), R = scopeResult(hd); if (!hd) return ''; const sm = R.sm; return sm && sm.total ? `${leaderPhrase({ cands: hd.cands }, sm)} in **${R.where}**, with **${fInt(sm.total)}** votes counted. The runner-up is **${sm.order[1] !== undefined ? candShort(hd.cands[sm.order[1]]) : '—'}**.` : `**${hd.cands.length}** candidates are on the ballot${hd.type === 'ew' ? ` in **${hd.r.rows.filter(c => c >= 0).length}** counties` : ''}. Counts begin at 7 PM.`; },
      watch: 'Percentages are shares of votes counted so far, not of all voters. Which precincts have reported changes the picture, so early leads can move.',
      nerd: { title: 'votes, shares and margins', text: 'A margin in votes is the leader minus second place. A margin in points is the same gap divided by all votes counted. Points let you compare a tiny county with a huge one; votes tell you how many ballots could still flip it.' },
    },
    table: () => { const hd = currentContest(), R = scopeResult(hd); if (!hd || !R.sm) return { head: ['Candidate'], rows: [] }; return { head: ['Candidate', 'Party', 'Votes', 'Share'], align: ['l', 'l', 'n', 'n'], rows: R.sm.order.map(k => [hd.cands[k][0], hd.cands[k][1] || '', fInt(R.sm.v[k]), fPct(R.sm.shares[k], 2)]) }; },
  });
}

/* 2. the county map for the race */
const mapMode = { m: 'leader', cand: -1 };
function raceMapColors(r) {
  const st = raceSum(r, -1), rep = r.cands.findIndex(c => c[1] === 'REP'), dem = r.cands.findIndex(c => c[1] === 'DEM');
  const rampR = [css('--div-r1'), css('--div-r2'), css('--div-r3')], rampD = [css('--div-d1'), css('--div-d2'), css('--div-d3')], rampY = [css('--div-y1'), css('--div-y2'), css('--div-y3')];
  return {
    leader: c => { const sm = raceSum(r, c.i); if (!sm) return null; if (!sm.total || sm.lead < 0) return css('--empty'); const p = r.cands[sm.lead][1], step = sm.marginPct < 8 ? 0 : sm.marginPct < 20 ? 1 : 2;
      return p === 'REP' ? rampR[step] : p === 'DEM' ? rampD[step] : isIndep(p) ? rampY[step] : (isYes(r.cands[sm.lead]) ? [css('--seq-2'), css('--seq-3'), css('--seq-5')][step] : isNo(r.cands[sm.lead]) ? ['#e9c9a8', '#d9a06b', css('--ed')][step] : css('--oth')); },
    cand: c => { const sm = raceSum(r, c.i); if (!sm) return null; if (!sm.total || mapMode.cand < 0) return css('--empty'); return seqColor(clamp(sm.shares[mapMode.cand] / 100, 0, 1)); },
    st,
  };
}
function raceMapLegend(r) {
  if (mapMode.m === 'cand') return { title: `Share for ${mapMode.cand >= 0 ? candShort(r.cands[mapMode.cand]) : '…'}`, items: [['seq-1', '0–25%'], ['seq-2', '25–50%'], ['seq-3', '50–75%'], ['seq-5', '75–100%']].map(([v, t]) => ({ color: css('--' + v), label: t })) };
  const yn = isYesNo(r);
  return { title: 'Leading candidate', items: yn ? [{ color: css('--seq-5'), label: 'Yes ahead by 20+ pts' }, { color: css('--seq-2'), label: 'Yes ahead, close' }, { color: '#e9c9a8', label: 'No ahead, close' }, { color: css('--ed'), label: 'No ahead by 20+ pts' }]
    : [{ color: css('--div-r3'), label: 'Republican by 20+ pts' }, { color: css('--div-r2'), label: 'Republican by 8–20' }, { color: css('--div-r1'), label: 'Republican, close' }, { color: css('--div-d1'), label: 'Democratic, close' }, { color: css('--div-d2'), label: 'Democratic by 8–20' }, { color: css('--div-d3'), label: 'Democratic by 20+ pts' }, ...(r.cands.some(c => isIndep(c[1])) ? [{ color: css('--div-y3'), label: 'Independent leading' }] : []), { color: css('--oth'), label: 'Other candidate leading' }] };
}
function drawRaceMap(host, w, api) {
  const hd = currentContest();
  if (!hd || hd.type !== 'ew') { emptyCard(host, hd ? `${hd.name} is a local race in ${C[hd.ci].name} County, so there is no statewide map.` : 'No race selected.'); api.label('No map.'); return; }
  const r = hd.r, col = raceMapColors(r), L = raceMapLegend(r), counted = raceHasVotes(r);
  if (mapMode.cand < 0 || mapMode.cand >= r.cands.length) mapMode.cand = raceSum(r, -1) && raceSum(r, -1).lead >= 0 ? raceSum(r, -1).lead : 0;
  kitMap(host, w, { color: c => { const f = mapMode.m === 'cand' ? col.cand : col.leader, v = f(c); return v; }, legend: [...L.items, { color: css('--empty'), label: counted ? 'No votes counted yet' : 'Not counted yet', outline: true }], legendTitle: L.title,
    tip: c => { const sm = raceSum(r, c.i); if (!sm) return tipContent(c.name, [], 'Not in this race'); return tipContent(c.name, sm.order.slice(0, 4).map(k => ({ color: candColor(r.cands, k), label: candShort(r.cands[k]), value: `${fInt(sm.v[k])}  (${fPct(sm.shares[k])})` })), [sm.total ? `${fInt(sm.total)} votes · margin ${fPct(sm.marginPct)}` : 'No votes counted yet', `Precincts reporting: ${countyReportingPct(c.i) == null ? '—' : fPct(countyReportingPct(c.i), 0)}`]); },
    aria: c => { const sm = raceSum(r, c.i); return `${c.name}: ${sm && sm.total ? leaderPhrase(r, sm) : 'no votes yet'}`; } });
  api.label(`County map for ${hd.name}.`);
}
function raceMapCard() {
  let api;
  const modeSel = live(h('div'), () => { const hd = currentContest(); return hd && hd.type === 'ew' ? h('div', { class: 'pickers' }, chipRow([['leader', 'Leading candidate'], ['cand', 'One candidate’s share']], mapMode.m, v => { mapMode.m = v; api.redraw(); (viewCache.results.live || []).forEach(i => i.run()); }, 'Map mode'),
    mapMode.m === 'cand' ? selectOf('Candidate', hd.r.cands.map((c, k) => [k, `${candShort(c)} (${c[1] || 'NP'})`]), mapMode.cand, v => { mapMode.cand = +v; api.redraw(); }) : null) : null; });
  api = card({
    id: 'r-map', kicker: 'Choropleth map', cat: 'mochi', controls: [modeSel],
    title: () => { const hd = currentContest(); return hd ? `Where ${hd.name} is being won` : 'Race map'; },
    sub: () => mapMode.m === 'cand' ? 'Counties shaded by one candidate’s share of the vote.' : 'Each county is colored by who is leading and how comfortably.',
    draw: drawRaceMap,
    notes: {
      what: 'A county map colors every county by one number, here who is leading. Intensity shows how big the lead is, so a pale county is close and a deep one is lopsided.',
      how: 'Red and blue are the parties; for amendments, purple is Yes and brown is No. Switch to "One candidate’s share" to see where a single candidate is strongest. Click a county to tailor the page to it.',
      shows: () => { const hd = currentContest(); if (!hd || hd.type !== 'ew') return 'Local races have no statewide map.'; const r = hd.r, rows = r.rows.filter(c => c >= 0).map(c => ({ c, sm: raceSum(r, c) })).filter(x => x.sm && x.sm.total); if (!rows.length) return 'Counties turn color as soon as they report.'; const lead = {}; rows.forEach(x => { const k = x.sm.lead >= 0 ? candShort(r.cands[x.sm.lead]) : 'Tied'; lead[k] = (lead[k] || 0) + 1; }); return `Counties led by each candidate: ${Object.entries(lead).sort((a, b) => b[1] - a[1]).map(([k, n]) => `**${k}** ${n}`).join(', ')}.`; },
      watch: 'Land area is not people. A county that looks huge may hold few voters. The county table below gives each county’s vote totals.',
    },
    table: () => { const hd = currentContest(); if (!hd || hd.type !== 'ew') return { head: ['Race'], rows: [] }; const r = hd.r; return { head: ['County', 'Leader', 'Share', 'Margin %', 'Votes'], align: ['l', 'l', 'n', 'n', 'n'], rows: r.rows.filter(c => c >= 0).map(c => { const sm = raceSum(r, c); return [C[c].name, sm && sm.lead >= 0 ? candShort(r.cands[sm.lead]) : '—', sm && sm.lead >= 0 ? fPct(sm.shares[sm.lead]) : '—', sm ? fPct(sm.marginPct) : '—', sm ? fInt(sm.total) : '0']; }) }; },
  });
  return api;
}

/* 3. county by county */
const raceTableState = { key: 'votes', dir: -1 };
function drawRaceTable(host) {
  const hd = currentContest(); if (!hd || hd.type !== 'ew') { emptyCard(host, 'The county table is for statewide-feed races.'); return; }
  const r = hd.r, st = raceSum(r, -1), top = (st ? st.order : r.cands.map((_, i) => i)).slice(0, 3);
  const rows = r.rows.filter(c => c >= 0).map(ci => { const sm = raceSum(r, ci); const ballots = ballotsCast(RLAST, ci); return { ci, c: C[ci], sm, ballots, under: sm && sm.total && ballots ? 100 * (1 - sm.total / ballots) : null }; });
  const cols = [
    { k: 'name', t: 'County', get: x => x.c.name, node: x => h('b', null, x.c.name) },
    { k: 'votes', t: 'Votes', n: true, get: x => x.sm ? x.sm.total : 0, fmt: v => v ? fInt(v) : '—' },
    { k: 'lead', t: 'Leading', get: x => x.sm && x.sm.lead >= 0 ? x.sm.shares[x.sm.lead] : -1, node: x => x.sm && x.sm.total && x.sm.lead >= 0 ? h('span', { style: { whiteSpace: 'nowrap' } }, partyChip(r.cands[x.sm.lead][1]), ' ', candShort(r.cands[x.sm.lead])) : '—' },
    ...top.map(k => ({ k: 'c' + k, t: candShort(r.cands[k]), n: true, get: x => x.sm && x.sm.total ? x.sm.shares[k] : -1, fmt: v => v >= 0 ? fPct(v) : '—' })),
    { k: 'margin', t: 'Margin (pts)', n: true, get: x => x.sm && x.sm.total ? x.sm.marginPct : -1, fmt: v => v >= 0 ? fPct(v) : '—' },
    { k: 'rep', t: 'Precincts in', n: true, get: x => countyReportingPct(x.ci) ?? -1, fmt: v => v >= 0 ? fPct(v, 0) : '—' },
    { k: 'under', t: 'Skipped this race', n: true, get: x => x.under ?? -1, fmt: v => v >= 0 ? fPct(v) : '—' },
  ];
  host.append(kitTable(cols, rows, raceTableState, () => drawRaceTable(clear(host)), { onRow: x => selection.set(x.ci), rowClass: x => selection.i === x.ci ? 'sel' : '', maxH: '520px', minW: '760px', label: 'Results by county' }));
}
function raceTableCard() {
  return card({
    id: 'r-counties', kicker: 'Table', cat: 'pearl', stack: true, noTable: true, controls: [contestPicker()],
    title: () => { const hd = currentContest(); return hd ? `${hd.name}, county by county` : 'County table'; },
    sub: 'Click a county to tailor the whole page to it. "Skipped this race" is the share of ballots with no vote in this contest.',
    draw: host => drawRaceTable(host),
    notes: {
      what: 'A table is the right tool when you want exact numbers for every county at once. You can sort by any column to ask a different question.',
      how: 'Sort by Margin to find the closest counties, by Votes to see where the volume is, by "Precincts in" to see who is still counting.',
      shows: () => { const hd = currentContest(); if (!hd || hd.type !== 'ew') return ''; const rows = hd.r.rows.filter(c => c >= 0).map(c => ({ c, sm: raceSum(hd.r, c) })).filter(x => x.sm && x.sm.total).sort((a, b) => a.sm.marginPct - b.sm.marginPct); return rows.length ? `Closest county: **${C[rows[0].c].name}** (**${fPct(rows[0].sm.marginPct)}**). Most lopsided: **${C[rows[rows.length - 1].c].name}** (**${fPct(rows[rows.length - 1].sm.marginPct)}**).` : 'No county has reported yet.'; },
      watch: '"Skipped this race" compares votes in the contest with ballots cast. Counties report ballots and races on slightly different clocks, so early numbers can look odd.',
    },
  });
}

/* 4. the count over time (snapshots) */
const timeMode = { m: 'share', where: 'auto' };
function drawRaceTime(host, w, api) {
  const hd = currentContest(); if (!hd) { emptyCard(host, 'No race selected.'); return; }
  const ci = scopeCi(), useCounty = hd.type === 'lr' ? hd.ci : (ci != null && hd.r.rowIdx.has(ci) && timeMode.where !== 'state' ? ci : -1);
  const per = RSNAPS.map((_, s) => hd.type === 'lr' ? summarize(lvotes(hd.l, s), hd.cands) : raceSum(hd.r, useCounty, s));
  const last = per[RLAST]; if (!last || !last.total) { emptyCard(host, 'No votes counted in any snapshot yet. Once they are, this chart shows how the count moved snapshot by snapshot.'); api.label('No data yet.'); return; }
  const idx = last.order.slice(0, 4), xs = RSNAPS.map(s => new Date(s.t).getTime());
  const metric = timeMode.m;
  const series = idx.map(k => ({ name: candShort(hd.cands[k]), color: candColor(hd.cands, k), ys: per.map(sm => sm && sm.total ? (metric === 'share' ? sm.shares[k] : sm.v[k]) : null), tip: i => per[i] && per[i].total ? `${fInt(per[i].v[k])}  (${fPct(per[i].shares[k])})` : '—' }));
  if (metric === 'margin') { const a = idx[0], b = idx[1]; series.length = 0; series.push({ name: `${candShort(hd.cands[a])} minus ${candShort(hd.cands[b])}`, color: candColor(hd.cands, a), ys: per.map(sm => sm && sm.total ? sm.shares[a] - sm.shares[b] : null), tip: i => `${fPts(per[i].shares[a] - per[i].shares[b])} pts` }); }
  kitLines(host, w, xs, series, { yFmt: v => metric === 'votes' ? fComp(v) : metric === 'margin' ? fPts(v, 0) : v + '%', endFmt: v => metric === 'votes' ? fComp(v) : metric === 'margin' ? fPts(v) : fPct(v), yMin: metric === 'margin' ? Math.min(0, ...series[0].ys.filter(v => v != null)) : 0,
    xFmt: (ms, i) => fmtClock(RSNAPS[i].t), tipHead: i => `${snapLabel(i)} ET`, tipFoot: i => per[i] ? `${fInt(per[i].total)} votes counted` : null, height: clamp(Math.round(w * .3), 260, 340) });
  api.label(`How ${hd.name} changed over ${RSNAPS.length} snapshots.`);
}
function raceTimeCard() {
  let api;
  const ctl = [chipRow([['share', 'Vote share'], ['votes', 'Votes'], ['margin', 'Lead (points)']], timeMode.m, v => { timeMode.m = v; api.redraw(); }, 'Metric'),
    live(h('div'), () => scopeC() ? chipRow([['auto', scopeName()], ['state', 'Florida']], timeMode.where, v => { timeMode.where = v; api.redraw(); }, 'Where') : null)];
  api = card({
    id: 'r-time', kicker: 'Line chart', cat: 'pearl', stack: true, controls: ctl,
    title: () => { const hd = currentContest(); return hd ? `How the count in ${hd.name} moved through the night` : 'The count over time'; },
    sub: () => `${RSNAPS.length} saved snapshot${RSNAPS.length === 1 ? '' : 's'}, from ${fmtClock(RSNAPS[0].t)} to ${fmtClock(RSNAPS[RLAST].t)} ET. Each point is one pull of the results.`,
    draw: drawRaceTime,
    notes: {
      what: 'A line chart over snapshots shows the count as it happened. Every pull of the results is a point, so you can watch a lead grow, shrink or flip.',
      how: 'Lines are the top candidates. "Vote share" shows each candidate’s percentage. "Votes" shows raw totals. "Lead" is the gap between the top two in points; below zero means the order flipped.',
      shows: () => { const hd = currentContest(); if (!hd || !HAS_RESULTS || !anyResults()) return 'The lines start when the first votes are counted.'; const per = RSNAPS.map((_, s) => hd.type === 'lr' ? summarize(lvotes(hd.l, s), hd.cands) : raceSum(hd.r, -1, s)).filter(x => x && x.total); return per.length > 1 ? `The leader's share moved from **${fPct(per[0].shares[per[0].lead] ?? 0)}** at the first count to **${fPct(per[per.length - 1].shares[per[per.length - 1].lead] ?? 0)}** now.` : 'Only one snapshot has votes so far.'; },
      watch: 'Early counts come from early and mail ballots, which can lean differently from Election Day votes. A moving line is normal, not a sign of a problem.',
    },
  });
  return api;
}

/* 5. how the vote was cast, from the county election sites */
function methodTotals(hd, ci) {
  // returns {coverage: counties, rows: [{k, parts:[ed, early, mail, prov]}]} for each candidate of the contest
  if (hd.type === 'lr') { const m = lmethod(hd.l); return { coverage: 1, rows: hd.cands.map((_, k) => ({ k, parts: m[k] })) }; }
  const acc = hd.r.cands.map(() => [0, 0, 0, 0]); const seen = new Set();
  LR.forEach(l => { if (l.sw !== hd.r.i || (ci != null && l.ci !== ci)) return; const m = lmethod(l); seen.add(l.ci); l.map.forEach((k, j) => { if (k >= 0) m[j].forEach((v, p) => { acc[k][p] += v; }); }); });
  return { coverage: seen.size, rows: acc.map((parts, k) => ({ k, parts })) };
}
function drawMethod(host, w, api) {
  const hd = currentContest(); if (!hd) { emptyCard(host, 'No race selected.'); return; }
  const ci = scopeCi(), mt = methodTotals(hd, hd.type === 'ew' ? ci : null);
  const tot = sum(mt.rows.map(r => sum(r.parts)));
  if (!mt.coverage || !tot) { emptyCard(host, hd.type === 'ew' && !mt.coverage ? 'The county election sites do not report this race by voting method.' : 'No votes counted yet. Once they are, this shows how each candidate’s votes split between mail, early voting and Election Day.'); api.label('No data yet.'); return; }
  const cands = hd.cands, order = [...mt.rows].sort((a, b) => sum(b.parts) - sum(a.parts)).slice(0, 6).filter(r => sum(r.parts) > 0);
  const P = [['Election Day', 'var(--ed)', 0], ['Early voting', 'var(--early)', 1], ['Mail', 'var(--mail)', 2]];
  const all = P.map(([l, c, i]) => ({ label: l, color: c, value: sum(mt.rows.map(r => r.parts[i])) }));
  const rows = [{ label: 'All candidates', sub: `${fInt(sum(all.map(p => p.value)))} votes`, parts: all, hi: true, tip: () => tipContent('All candidates', all.map(p => ({ color: p.color, label: p.label, value: `${fInt(p.value)}  (${fPct(100 * p.value / sum(all.map(x => x.value)))})` }))) },
    ...order.map(r => ({ label: candShort(cands[r.k]), sub: `${cands[r.k][1] || 'No party'} · ${fInt(sum(r.parts))} votes`, parts: P.map(([l, c, i]) => ({ label: l, color: c, value: r.parts[i] })),
      tip: () => tipContent(cands[r.k][0], P.map(([l, c, i]) => ({ color: c, label: l, value: `${fInt(r.parts[i])}  (${fPct(100 * r.parts[i] / (sum(r.parts) || 1))})` })), 'Provisional ballots not shown') }))];
  kitStack(host, w, rows, { mode: 'share', rowH: 44, barH: 22, rightPad: 70 });
  host.append(h('p', { class: 'mini-note', style: { marginTop: '8px' } }, hd.type === 'ew' ? `Based on the ${mt.coverage} ${mt.coverage === 1 ? 'county' : 'counties'} whose election sites report voting method${ci != null ? ` (${scopeName()} only)` : ''}. Other counties are left out.` : `${C[hd.ci].name} County election site.`));
  api.label(`How each candidate in ${hd.name} got their votes.`);
}
function methodCard() {
  return card({
    id: 'r-method', kicker: '100% stacked bar chart', cat: 'pearl', stack: true,
    title: () => { const hd = currentContest(); return hd ? `How people cast the votes counted in ${hd.name}` : 'Voting method'; },
    sub: 'For each candidate, the share of their votes that came by Election Day, early voting or mail.',
    legend: () => [{ color: 'var(--ed)', label: 'Election Day' }, { color: 'var(--early)', label: 'Early voting' }, { color: 'var(--mail)', label: 'Mail' }],
    draw: drawMethod,
    notes: {
      what: 'This splits each candidate’s votes by how they were cast. It answers "who wins mail, who wins in person?" which is the pattern behind most election-night swings.',
      how: 'Every bar is the same length, so you compare the mix. The top bar is everyone together; each bar below is one candidate.',
      shows: () => { const hd = currentContest(); if (!hd) return ''; const mt = methodTotals(hd, hd.type === 'ew' ? scopeCi() : null), tot = sum(mt.rows.map(r => sum(r.parts))); return tot ? `Of **${fInt(tot)}** votes with a method recorded, **${fPct(100 * sum(mt.rows.map(r => r.parts[2])) / tot, 0)}** came by mail, **${fPct(100 * sum(mt.rows.map(r => r.parts[1])) / tot, 0)}** early and **${fPct(100 * sum(mt.rows.map(r => r.parts[0])) / tot, 0)}** on Election Day.` : 'Method splits appear once votes are counted.'; },
      watch: 'Only counties whose own election site publishes the split are included, so this is a sample of the state, not all of it.',
    },
  });
}

/* 6. the spread of one candidate's share across counties */
const distState = { k: -1 };
function drawRaceDist(host, w, api) {
  const hd = currentContest(); if (!hd || hd.type !== 'ew') { emptyCard(host, 'The distribution view is for statewide-feed races.'); return; }
  const r = hd.r, st = raceSum(r, -1);
  if (distState.k < 0 || distState.k >= r.cands.length || distState.rid !== r.id) { distState.k = st && st.lead >= 0 ? st.lead : 0; distState.rid = r.id; }
  const k = distState.k, items = r.rows.filter(c => c >= 0).map(c => ({ ci: c, sm: raceSum(r, c) })).filter(x => x.sm && x.sm.total).map(x => ({ v: x.sm.shares[k], name: C[x.ci].name, ci: x.ci }));
  if (items.length < 2) { emptyCard(host, 'Needs at least two counties with votes counted.'); api.label('No data yet.'); return; }
  const med = median(items.map(i => i.v)), sel = scopeCi() != null ? items.find(i => i.ci === scopeCi()) : null;
  kitHist(host, w, items, { bin: 5, lo: 0, hi: 100, unit: 'Counties', names: i => i.name, color: candColor(r.cands, k), refs: [{ v: med, label: `Median county ${fPct(med)}`, anchor: 'start' }, ...(st && st.total ? [{ v: st.shares[k], label: `Statewide ${fPct(st.shares[k])}`, anchor: 'end' }] : [])], mark: sel ? { v: sel.v, label: scopeName() } : null, xLabel: `${candShort(r.cands[k])}’s share of the vote in each county` });
  api.label(`Histogram of ${candShort(r.cands[k])}'s vote share across counties.`);
}
function raceDistCard() {
  let api;
  const pick = live(h('div'), () => { const hd = currentContest(); return hd && hd.type === 'ew' ? selectOf('Candidate', hd.r.cands.map((c, k) => [k, `${candShort(c)} (${c[1] || 'NP'})`]), distState.k, v => { distState.k = +v; api.redraw(); }) : null; });
  api = card({
    id: 'r-dist', kicker: 'Histogram', cat: 'mochi', controls: [contestPicker(), pick],
    title: () => { const hd = currentContest(); return hd && hd.type === 'ew' ? `How ${candShort(hd.r.cands[Math.max(0, distState.k)] || hd.r.cands[0])}’s share varies across counties` : 'Share distribution'; },
    sub: 'Each bar counts counties whose share for that candidate falls in a 5-point band.',
    draw: drawRaceDist,
    notes: {
      what: 'A histogram sorts counties into bands by the candidate’s share, so you can see whether support is bunched together or spread wide.',
      how: 'Each bar is a band of vote share; its height is the number of counties. The marked county is yours. The vertical lines are the median county and the statewide figure.',
      shows: () => 'A wide spread means the candidate’s support depends a lot on where you are. A narrow one means the state looks alike county to county.',
      watch: 'The median county and the statewide share differ because big counties count for more votes. See the turnout histogram for the same effect.',
    },
  });
  return api;
}
