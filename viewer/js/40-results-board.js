/* ---------- results: the contest handle, the status banner, the race board, seat tallies ---------- */
const RES = { key: null, family: 'all', q: '', local: true, fc: false };

/* A "contest" is either a statewide-feed race ('ew', by contest id) or one county's local race ('lr', key "L<index>"). */
function contestHandle(key) {
  if (!HAS_RESULTS || !key) return null;
  if (key[0] === 'L') { const l = LR[+key.slice(1)]; return l ? { key, type: 'lr', l, name: l.name, cands: l.cands, ci: l.ci, kind: 'local' } : null; }
  const r = RACE_BY_ID.get(key);
  return r ? { key, type: 'ew', r, name: r.name, cands: r.cands, kind: r.kind } : null;
}
function contestSum(hd, ci = -1, s = RLAST) {
  if (!hd) return null;
  if (hd.type === 'ew') return raceSum(hd.r, ci, s);
  if (ci !== -1 && ci !== hd.ci) return null;
  return summarize(lvotes(hd.l, s), hd.cands);
}
function currentContest() {
  let hd = contestHandle(RES.key);
  if (!hd) hd = contestHandle('160000') || (RACES[0] && contestHandle(RACES[0].id));
  return hd;
}
function setContest(key, scroll = true) {
  RES.key = key; setParam('race', key);
  redrawView('results');
  (viewCache.results && viewCache.results.live || []).forEach(i => i.run());
  if (scroll) scrollToId('r-race');
}
const contestPopulation = (hd) => hd.type === 'ew' ? hd.r.rows.filter(c => c >= 0) : [hd.ci];
const candLine = (cands, order, n = 3) => h('span', null, ...order.slice(0, n).flatMap((k, i) => [i ? ' ' : null, h('span', { style: { whiteSpace: 'nowrap' } }, partyChip(cands[k][1]), ' ', candShort([cands[k][0], cands[k][1], cands[k][2]]))]), order.length > n ? h('span', { class: 'rb-sub' }, ` +${order.length - n} more`) : null);
const noVotes = () => h('span', { class: 'spill' }, 'No votes yet');

/* ---- the status banner ---- */
function statusBanner() {
  return h('section', { class: 'card plain', 'aria-label': 'Results status', style: { gap: '10px' } }, live(h('div'), () => {
    const sn = RSNAPS[RLAST], ci = scopeCi(), rep = stateReporting(RLAST), counted = anyResults();
    const parts = [h('span', { class: 'spill' + (counted ? ' ok' : ' warn') }, counted ? 'Votes are coming in' : 'Waiting for polls to close'),
      h('span', { class: 'spill' }, `Latest pull ${fmtDayClock(sn.t)} ET`), h('span', { class: 'spill' }, `${RSNAPS.length} snapshot${RSNAPS.length === 1 ? '' : 's'} saved`),
      h('span', { class: 'spill' }, `${rep.counties} of ${N} counties with ballots counted`), h('span', { class: 'spill' }, `${fPct(rep.precinctPct, 0)} of precincts reporting`)];
    if (ci != null) { const p = countyReportingPct(ci); parts.push(h('span', { class: 'spill' }, `${C[ci].name}: ${p == null ? 'not reporting yet' : fPct(p, 0) + ' of precincts'}`)); }
    return h('div', null, h('div', { class: 'chips' }, parts),
      h('p', { class: 'mini-note', style: { marginTop: '10px' } }, counted
        ? 'Counts are unofficial and change with every pull. A candidate who is "leading" has not necessarily won.'
        : 'Polls close at 7 PM local time. Until then every count is zero, but the races, candidates and your county’s ballot are already here. This page fills in as each snapshot arrives.'));
  }));
}

/* ---- the race board ---- */
function boardRows() {
  const ci = scopeCi(), rows = [];
  for (const r of RACES) {
    if (ci != null && !r.rowIdx.has(ci)) continue;
    const fam = familyOf(r);
    rows.push({ key: r.id, name: r.name, fam: fam.label, fk: fam.k, cands: r.cands, tot: raceSum(r, -1), loc: ci != null ? raceSum(r, ci) : null, nCounties: r.rows.filter(c => c >= 0).length,
      fcPi: HAS_PROJ ? pjIndexOf(r) : null, reporting: r.rows.filter(c => c >= 0 && (raceSum(r, c) || {}).total > 0).length });
  }
  if (ci != null && RES.local) for (const l of countyBallot(ci)) {
    if (l.sw >= 0) continue;
    rows.push({ key: 'L' + l.i, name: l.name, fam: localKind(l.name), fk: 'local', cands: l.cands, tot: summarize(lvotes(l), l.cands), loc: null, nCounties: 1, reporting: 0, local: true });
  }
  return rows;
}
const boardState = { key: 'order', dir: 1 };
function drawBoard(host) {
  const ci = scopeCi(), q = RES.q.trim().toLowerCase();
  let rows = boardRows().filter(r => (RES.family === 'all' || r.fk === RES.family) && (!RES.fc || r.fcPi != null) && (!q || r.name.toLowerCase().includes(q) || r.cands.some(c => c[0].toLowerCase().includes(q))));
  rows.forEach((r, i) => { r.fcP = r.fcPi != null ? (pjFavorite(r.fcPi) || { p: -1 }).p : -1; r.order = i; r.share = r.tot && r.tot.lead >= 0 ? r.tot.shares[r.tot.lead] : -1; r.marginV = r.tot ? r.tot.marginPct : -1; r.votes = r.tot ? r.tot.total : 0; });
  const cols = [
    { k: 'order', t: 'Race', get: r => r.order, cls: 'wrapcell namecell', node: r => h('div', null, h('div', { class: 'rb-name' }, r.name), h('div', { class: 'rb-sub' }, r.fam + (r.local ? ' · local' : ''))) },
    { k: 'cands', t: 'On the ballot', nosort: true, get: r => '', cls: 'hide-sm wrapcell', node: r => candLine(r.cands, r.cands.map((_, i) => i), 2) },
    ...(HAS_PROJ ? [{ k: 'fc', t: 'Forecast', cls: 'hide-sm', get: r => r.fcP, node: r => r.fcPi != null ? fcCell(r.fcPi) : h('span', { class: 'rb-sub' }, '—') }] : []),
    { k: 'lead', t: ci != null && !rows.every(r => r.local) ? 'Leading overall' : 'Leading', get: r => r.share, node: r => r.tot && r.tot.total ? h('span', { style: { whiteSpace: 'nowrap' } }, r.tot.lead >= 0 ? [partyChip(r.cands[r.tot.lead][1]), ' ', candShort(r.cands[r.tot.lead]), ' ', h('b', null, fPct(r.share))] : 'Tied') : noVotes() },
    ...(ci != null ? [{ k: 'loc', t: `In ${C[ci].name}`, get: r => r.loc && r.loc.lead >= 0 ? r.loc.shares[r.loc.lead] : -1, node: r => r.loc && r.loc.total ? h('span', { style: { whiteSpace: 'nowrap' } }, r.loc.lead >= 0 ? [partyChip(r.cands[r.loc.lead][1]), ' ', candShort(r.cands[r.loc.lead]), ' ', h('b', null, fPct(r.loc.shares[r.loc.lead]))] : 'Tied') : (r.local ? '—' : r.loc ? noVotes() : '—') }] : []),
    { k: 'margin', t: 'Margin', get: r => r.marginV, node: r => r.tot && r.tot.total && r.tot.lead >= 0 ? h('div', { class: 'margin-bar', title: `${fPct(r.marginV)} (${fInt(r.tot.margin)} votes)` }, h('i', { style: { left: 0, width: clamp(r.marginV * 2, 4, 100) + '%', background: candColor(r.cands, r.tot.lead) } })) : '—' },
    { k: 'votes', t: 'Votes', n: true, get: r => r.votes, node: r => h('div', null, r.votes ? fInt(r.votes) : '—', r.local || !r.nCounties || r.nCounties === 1 ? null : h('div', { class: 'rb-sub' }, `${r.reporting} of ${r.nCounties} counties`)) },
  ];
  const wrap = kitTable(cols, rows, boardState, () => drawBoard(clear(host)), { onRow: r => setContest(r.key), rowClass: r => (RES.key || '160000') === r.key ? 'sel' : '', maxH: '560px', minW: '720px', empty: 'No races match.', label: 'Race board' });
  host.append(wrap);
}
function boardCard() {
  let api;
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Search races or candidates…', 'aria-label': 'Search races or candidates', oninput: e => { RES.q = e.target.value; api.redraw(); } });
  const famChips = live(h('div'), () => chipRow([['all', 'All'], ...FAMILIES.map(f => [f.k, f.label]), ...(scopeC() ? [['local', 'Local']] : [])], RES.family, v => { RES.family = v; api.redraw(); }, 'Race type'));
  const localToggle = live(h('div'), () => scopeC() ? h('label', { class: 'mini-note', style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', ...(RES.local ? { checked: true } : {}), onchange: e => { RES.local = e.target.checked; api.redraw(); } }), 'Include local races on this county’s ballot') : null);
  const fcToggle = HAS_PROJ ? h('label', { class: 'mini-note', style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', ...(RES.fc ? { checked: true } : {}), onchange: e => { RES.fc = e.target.checked; api.redraw(); } }), 'Only races with a forecast') : null;
  api = card({
    id: 'r-board', kicker: 'Table', cat: 'mochi', stack: true, noTable: true, controls: [search, famChips, localToggle, fcToggle],
    title: () => scopeC() ? `Your ballot in ${scopeName()}: every race that includes the county` : 'Every race on Florida’s ballot',
    sub: () => anyResults() ? 'Click any row to open that race below. Sort by any column.' : 'No votes are counted yet, so this is a ballot preview. Click any row to open that race.',
    foot: () => `${RACES.length} statewide-feed races${scopeC() ? ` and ${countyBallot(scopeCi()).length} contests on ${scopeName()}’s county ballot` : ''}. Source: Florida Election Watch${RSNAPS[RLAST].synth ? ', and where the state has not loaded a race yet, the sum of the county election sites reporting it (the county count under Votes shows how many)' : ''}${scopeC() ? ' and the county election site' : ''}.`,
    draw: host => drawBoard(host),
    notes: {
      what: 'A race board is a table with one row per contest, so you can scan dozens of races at once and jump to the one you care about.',
      how: 'The colored chip is the candidate’s party. "Margin" is the leader’s lead over second place, as a share of the votes counted. Click a row to open it.',
      shows: () => { const c = RACES.filter(r => raceHasVotes(r)).length; return c ? `**${c}** of ${RACES.length} races have votes counted so far.` : `**${RACES.length}** races are on the statewide feed, from governor to judges and **${RACES.filter(r => r.kind === 'amend').length}** constitutional amendments.`; },
      watch: 'Leading is not winning: until precincts are all in, a lead can flip. Races with very few votes counted swing the most.',
    },
  });
  return api;
}

/* ---- seat tally: who is leading in the district races ---- */
function seatCounts(kind) {
  const rs = RACES.filter(r => r.kind === kind), out = { rep: 0, dem: 0, ind: 0, oth: 0, none: 0, total: rs.length };
  rs.forEach(r => { const sm = raceSum(r, -1); if (!sm || !sm.total || sm.lead < 0) out.none++; else { const p = r.cands[sm.lead][1]; if (p === 'REP') out.rep++; else if (p === 'DEM') out.dem++; else if (isIndep(p)) out.ind++; else out.oth++; } });
  return out;
}
function seatCard() {
  return card({
    id: 'r-seats', kicker: 'Stacked bar chart', cat: 'pearl', stack: true,
    title: () => anyResults() ? 'Who is leading in the district races' : 'The district races on this year’s ballot',
    sub: 'One bar per chamber: the seats up for election, colored by the party of the current leader.',
    legend: () => [{ color: 'var(--rep)', label: 'Republican leading' }, { color: 'var(--dem)', label: 'Democratic leading' }, { color: 'var(--npa)', label: 'Independent leading' }, { color: 'var(--oth)', label: 'Other party leading' }, { color: 'var(--axis)', label: 'Not counted or tied' }],
    draw: (host, w, api) => {
      const rows = [['house', 'U.S. House'], ['sdist', 'State Senate'], ['hdist', 'State House']].map(([k, label]) => { const c = seatCounts(k);
        return { label, sub: `${c.total} contests`, parts: [{ label: 'Republican', color: 'var(--rep)', value: c.rep }, { label: 'Democratic', color: 'var(--dem)', value: c.dem }, { label: 'Independent', color: 'var(--npa)', value: c.ind }, { label: 'Other party', color: 'var(--oth)', value: c.oth }, { label: 'Not counted or tied', color: 'var(--axis)', value: c.none }],
          tip: () => tipContent(label, [{ color: 'var(--rep)', label: 'Republican leading', value: c.rep }, { color: 'var(--dem)', label: 'Democratic leading', value: c.dem }, ...(c.ind ? [{ color: 'var(--npa)', label: 'Independent leading', value: c.ind }] : []), ...(c.oth ? [{ color: 'var(--oth)', label: 'Other party leading', value: c.oth }] : []), { label: 'Not counted or tied', value: c.none }], 'Only seats on this ballot are counted'), text: String(c.total),
          click: () => { RES.family = k; (viewCache.results.live || []).forEach(i => i.run()); redrawView('results'); scrollToId('r-board'); } }; });
      if (HAS_PROJ) {                                  // the forecasts, as expected seats, in the row right under the U.S. House count
        const e = expectedSeats();
        if (e.n) rows.splice(1, 0, { label: 'U.S. House', sub: `forecast, ${e.n} races`, parts: [{ label: 'Republican', color: 'var(--rep)', value: e.rep }, { label: 'Democratic', color: 'var(--dem)', value: e.dem }, { label: 'Independent', color: 'var(--npa)', value: e.ind }],
          text: `${e.rep.toFixed(1)} R · ${e.dem.toFixed(1)} D`, tip: () => tipContent('U.S. House, forecast', [{ color: 'var(--rep)', label: 'Republican, expected seats', value: e.rep.toFixed(1) }, { color: 'var(--dem)', label: 'Democratic, expected seats', value: e.dem.toFixed(1) }, ...(e.ind ? [{ color: 'var(--npa)', label: 'Independent, expected seats', value: e.ind.toFixed(1) }] : [])], ['Adds up each race’s win probability (DDHQ)', 'A prediction, not a count']) });
        if (e.called.n) rows.splice(2, 0, { label: 'U.S. House', sub: 'called by DDHQ', parts: [{ label: 'Republican', color: 'var(--rep)', value: e.called.rep }, { label: 'Democratic', color: 'var(--dem)', value: e.called.dem }, { label: 'Independent', color: 'var(--npa)', value: e.called.ind }, { label: 'Other party', color: 'var(--oth)', value: e.called.oth }, { label: 'Not called yet', color: 'var(--axis)', value: Math.max(e.n - e.called.n, 0) }], text: `${e.called.n} of ${e.n}`,
          tip: () => tipContent('U.S. House, race calls', [{ color: 'var(--rep)', label: 'Republican called', value: e.called.rep }, { color: 'var(--dem)', label: 'Democratic called', value: e.called.dem }, { label: 'Not called yet', value: e.n - e.called.n }], 'DDHQ is the only source of race calls here') });
      }
      kitStack(host, w, rows, { mode: 'count', rowH: 44, barH: 22 });
      api.label('Seats on the ballot by the party of the current leader.');
    },
    notes: {
      what: 'A seat tally counts how many races each party is leading. It is the headline number on election night for legislatures.',
      how: 'Each bar is a chamber. The colored parts are seats where that party currently leads. Gray means no votes counted yet or an exact tie. Click a bar to see those races.',
      shows: () => { const a = seatCounts('house'), b = seatCounts('sdist'), c = seatCounts('hdist'); return anyResults() ? `U.S. House: **${a.rep}** R, **${a.dem}** D leading. State Senate: **${b.rep}** R, **${b.dem}** D. State House: **${c.rep}** R, **${c.dem}** D.` : `**${a.total}** U.S. House, **${b.total}** State Senate and **${c.total}** State House contests are on the ballot. Counts start when polls close.`; },
      watch: 'Not every seat is up this year, and some races are unopposed, so this tally is not the whole chamber.',
    },
    table: () => ({ head: ['Chamber', 'Contests', 'Republican leading', 'Democratic leading', 'Independent leading', 'Other party', 'Not counted'], align: ['l', 'n', 'n', 'n', 'n', 'n', 'n'], rows: [['house', 'U.S. House'], ['sdist', 'State Senate'], ['hdist', 'State House']].map(([k, l]) => { const c = seatCounts(k); return [l, c.total, c.rep, c.dem, c.ind, c.oth, c.none].map(String); }) }),
  });
}

/* ---- closest races ---- */
function closestCard() {
  return card({
    id: 'r-close', kicker: 'Ranked bar chart', cat: 'mochi', stack: true,
    title: () => anyResults() ? 'The ten closest races right now' : 'Closest races will appear here once votes are counted',
    sub: 'Margin between the top two candidates, as a share of votes counted. Smaller bars are tighter races.',
    draw: (host, w, api) => {
      const rows = RACES.map(r => ({ r, sm: raceSum(r, -1) })).filter(x => x.sm && x.sm.total >= 50).sort((a, b) => a.sm.marginPct - b.sm.marginPct).slice(0, 10);
      if (!rows.length) { emptyCard(host, 'No race has enough votes counted yet. Mochi is napping until polls close.'); api.label('No data yet.'); return; }
      kitBars(host, w, rows.map(x => ({ label: x.r.short || x.r.name, sub: `${candShort(x.r.cands[x.sm.order[0]])} vs ${candShort(x.r.cands[x.sm.order[1]])}`, value: x.sm.marginPct, color: x.sm.lead >= 0 ? candColor(x.r.cands, x.sm.lead) : 'var(--oth)', text: `${fPct(x.sm.marginPct)}  ·  ${fInt(x.sm.margin)} votes`,
        tip: () => tipContent(x.r.name, x.sm.order.slice(0, 3).map(k => ({ color: candColor(x.r.cands, k), label: candShort(x.r.cands[k]), value: `${fInt(x.sm.v[k])}  (${fPct(x.sm.shares[k])})` })), `${fInt(x.sm.total)} votes counted`), click: () => setContest(x.r.id) })), { rowH: 40, rightPad: 130, fmt: v => fPct(v) });
      api.label('The ten races with the smallest margin between first and second.');
    },
    notes: {
      what: 'A ranked bar chart lines races up by how close they are, so the ones that could flip float to the top.',
      how: 'Each bar is the gap between first and second place as a percentage of the votes counted. Click a bar to open the race.',
      shows: () => { const rows = RACES.map(r => ({ r, sm: raceSum(r, -1) })).filter(x => x.sm && x.sm.total >= 50).sort((a, b) => a.sm.marginPct - b.sm.marginPct); return rows.length ? `Tightest: **${rows[0].r.name}** at **${fPct(rows[0].sm.marginPct)}** (${fInt(rows[0].sm.margin)} votes).` : 'Nothing to rank yet.'; },
      watch: 'A tiny count makes a margin look huge or tiny. Races with few votes counted are noisy, which is why races under 50 votes are left out.',
    },
    table: () => ({ head: ['Race', 'Leader', 'Margin %', 'Margin votes', 'Votes counted'], align: ['l', 'l', 'n', 'n', 'n'], rows: RACES.map(r => ({ r, sm: raceSum(r, -1) })).filter(x => x.sm && x.sm.total).sort((a, b) => a.sm.marginPct - b.sm.marginPct).slice(0, 40).map(x => [x.r.name, x.sm.lead >= 0 ? candShort(x.r.cands[x.sm.lead]) : 'Tied', fPct(x.sm.marginPct), fInt(x.sm.margin), fInt(x.sm.total)]) }),
  });
}
