/* ---------- results: analysis across races and counties ---------- */
const WIDE_RACES = () => RACES.filter(r => ['exec', 'senate', 'amend'].includes(r.kind) || (r.kind === 'judicial' && r.rows.filter(c => c >= 0).length === N));
/* "the Democratic side" of a race: D share of the two-party vote, or Yes share for yes/no questions */
function sideOf(r) {
  if (isYesNo(r)) return { k: r.cands.findIndex(isYes), label: 'Yes share' };
  const d = r.cands.findIndex(c => c[1] === 'DEM'), p = r.cands.findIndex(c => c[1] === 'REP');
  return d >= 0 && p >= 0 ? { k: d, rep: p, label: 'Democratic share of the two-party vote' } : null;
}
function sideShare(r, ci, s = RLAST) {
  const sm = raceSum(r, ci, s), side = sideOf(r); if (!sm || !side || !sm.total) return null;
  if (side.rep === undefined) return sm.shares[side.k];
  const two = sm.v[side.k] + sm.v[side.rep]; return two ? 100 * sm.v[side.k] / two : null;
}

/* 1. the ticket: do counties vote the same way in two races? */
const ticket = { a: '160000', b: '120000' };
function drawTicket(host, w, api) {
  const A = RACE_BY_ID.get(ticket.a), B = RACE_BY_ID.get(ticket.b);
  if (!A || !B) { emptyCard(host, 'Pick two races.'); return; }
  const pts = [];
  for (let ci = 0; ci < N; ci++) { const x = sideShare(A, ci), y = sideShare(B, ci); if (x == null || y == null) continue; const c = C[ci];
    pts.push({ x, y, label: c.name, hi: selection.i === ci, always: selection.i === ci, r: Math.max(4, Math.min(11, Math.sqrt(c.total) / 38)), click: () => selection.set(ci),
      tip: () => tipContent(c.name, [{ label: sideOf(A).label.split(' ')[0] + ' in ' + A.short, value: fPct(x) }, { label: sideOf(B).label.split(' ')[0] + ' in ' + B.short, value: fPct(y) }, { label: 'Gap', value: `${fPts(y - x)} pts` }], 'Click to tailor the page to this county') }); }
  if (pts.length < 3) { emptyCard(host, 'Needs votes counted in both races. Counties appear as soon as they report.'); api.label('No data yet.'); return; }
  const fit = kitScatter(host, w, pts, { xFmt: v => v + '%', yFmt: v => v + '%', xLabel: `${A.short}: ${sideOf(A).label.toLowerCase()}`, yLabel: `${B.short}: ${sideOf(B).label.toLowerCase()}`, diag: true, fit: true, labelN: 5 });
  api.label(`Scatter of ${A.short} against ${B.short} by county. Correlation ${fit ? fit.r.toFixed(2) : 'n/a'}.`);
}
function ticketCard() {
  let api;
  const opts = () => WIDE_RACES().map(r => [r.id, r.name]);
  const sa = selectOf('Race on the horizontal axis', opts(), ticket.a, v => { ticket.a = v; api.redraw(); }), sb = selectOf('Race on the vertical axis', opts(), ticket.b, v => { ticket.b = v; api.redraw(); });
  api = card({
    id: 'r-ticket', kicker: 'Scatter plot', cat: 'pearl', controls: [h('div', { class: 'pickers' }, sa, sb)],
    title: () => `Do counties vote the same way for ${(RACE_BY_ID.get(ticket.a) || {}).short || '?'} and ${(RACE_BY_ID.get(ticket.b) || {}).short || '?'}?`,
    sub: 'One dot per county. Dots on the diagonal voted the same way in both races. Bigger dots are bigger counties.',
    draw: drawTicket,
    notes: {
      what: 'A ticket plot compares one county’s result in two races at once. It shows split-ticket voting: places that back a party for one office and the other party for another.',
      how: 'Across is the Democratic share of the two-party vote (or Yes share) in the first race; up is the same for the second. The diagonal means "identical". Dots above the line did better for the Democratic side (or Yes) in the vertical race.',
      shows: () => { const A = RACE_BY_ID.get(ticket.a), B = RACE_BY_ID.get(ticket.b); const d = []; for (let ci = 0; ci < N; ci++) { const x = A && sideShare(A, ci), y = B && sideShare(B, ci); if (x != null && y != null) d.push({ ci, gap: y - x }); } if (d.length < 3) return 'Fills in once votes are counted.'; const mean2 = mean(d.map(x => x.gap)), top = [...d].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0]; return `On average the vertical race runs **${fPts(mean2)}** points from the horizontal one. The biggest split is **${C[top.ci].name}** (**${fPts(top.gap)}**).`; },
      watch: 'Yes/No questions and candidate races are different kinds of choices, so a gap between them is not a "mistake". Compare like with like when you can.',
    },
  });
  return api;
}

/* 2. roll-off: how many ballots skipped a race */
function undervoteOf(r, ci) {
  if (ci == null) { let b = 0, v = 0; r.rows.filter(c => c >= 0).forEach(c => { const sm = raceSum(r, c); const bc = ballotsCast(RLAST, c); if (sm && sm.total && bc) { b += bc; v += sm.total; } }); return b ? 100 * (1 - v / b) : null; }
  const sm = raceSum(r, ci), bc = ballotsCast(RLAST, ci); return sm && sm.total && bc ? 100 * (1 - sm.total / bc) : null;
}
function drawRolloff(host, w, api) {
  const ci = scopeCi(), rows = WIDE_RACES().map(r => ({ r, u: undervoteOf(r, ci) })).filter(x => x.u != null).sort((a, b) => b.u - a.u);
  if (!rows.length) { emptyCard(host, 'Needs ballots cast and votes counted. This chart compares how many voters skipped each race.'); api.label('No data yet.'); return; }
  kitBars(host, w, rows.map(x => ({ label: x.r.short, sub: x.r.kind === 'amend' ? 'amendment' : x.r.kind === 'judicial' ? 'retention' : 'candidate race', value: Math.max(x.u, 0), color: x.r.kind === 'amend' ? 'var(--ed)' : 'var(--early)', text: fPct(x.u),
    tip: () => tipContent(x.r.name, [{ label: 'Skipped this race', value: fPct(x.u) }, { label: 'Votes in the race', value: fInt((raceSum(x.r, ci == null ? -1 : ci) || {}).total || 0) }], ci == null ? 'Statewide, ballots cast vs votes in the race' : `${scopeName()} County`) })),
    { rowH: 38, fmt: v => fPct(v), rightPad: 70 });
  api.label(`Share of ballots that skipped each race in ${scopeLabel()}.`);
}
function rolloffCard() {
  return card({
    id: 'r-rolloff', kicker: 'Ranked bar chart', cat: 'mochi',
    title: () => `Which races did voters in ${scopeLabel()} skip most?`,
    sub: 'Share of ballots cast that left the race blank (or voted too many times).',
    draw: drawRolloff,
    notes: {
      what: 'Roll-off (also called undervote) is the gap between people who voted and people who voted in a particular race. It tells you which contests voters found hardest or least important.',
      how: 'Each bar is "ballots cast minus votes in this race", as a share of ballots cast. Longer bars mean more voters skipped it.',
      shows: () => { const ci = scopeCi(), rows = WIDE_RACES().map(r => ({ r, u: undervoteOf(r, ci) })).filter(x => x.u != null).sort((a, b) => b.u - a.u); return rows.length ? `Most skipped: **${rows[0].r.name}** (**${fPct(rows[0].u)}**). Least skipped: **${rows[rows.length - 1].r.name}** (**${fPct(rows[rows.length - 1].u)}**).` : 'Fills in once votes are counted.'; },
      watch: 'Early in the night, counties report ballots and races on different clocks, so roll-off can look wrong until counting settles.',
    },
  });
}

/* 3. counting progress */
const REPORT_BINS = [[0, 'Not reporting'], [1, 'Under 25%'], [25, '25–50%'], [50, '50–75%'], [75, '75–99%'], [100, '100%']];
const reportColor = p => { if (p == null || p <= 0) return css('--empty'); const i = p >= 100 ? 5 : p >= 75 ? 4 : p >= 50 ? 3 : p >= 25 ? 2 : 1; return [css('--empty'), seqStops()[0], seqStops()[1], seqStops()[2], seqStops()[3], seqStops()[4]][i]; };
function drawReportMap(host, w, api) {
  const rep = stateReporting(RLAST);
  kitMap(host, w, { color: c => reportColor(countyReportingPct(c.i)), legendTitle: 'Precincts reporting', legend: REPORT_BINS.map(([v, l], i) => ({ color: [css('--empty'), seqStops()[0], seqStops()[1], seqStops()[2], seqStops()[3], seqStops()[4]][i], label: l, outline: i === 0 })),
    tip: c => { const p = countyReportingPct(c.i), ed = RS.edLast[c.i]; return tipContent(c.name, [{ label: 'Precincts reporting', value: p == null ? '—' : fPct(p, 0) }, { label: 'Ballots counted', value: fInt(ballotsCast(RLAST, c.i)) }, { label: 'Mail counted', value: csGet(RLAST, c.i, CS.vbm) == null ? '—' : fInt(csGet(RLAST, c.i, CS.vbm)) }, { label: 'Early counted', value: csGet(RLAST, c.i, CS.early) == null ? '—' : fInt(csGet(RLAST, c.i, CS.early)) }], ed ? `Election Day last reported ${ed}` : 'No Election Day report yet'); } });
  api.label(`Map of precincts reporting by county. ${rep.counties} counties have counted ballots.`);
}
function reportMapCard() {
  return card({
    id: 'r-progress', kicker: 'Choropleth map', cat: 'mochi',
    title: () => { const r = stateReporting(RLAST); return anyResults() || r.counties ? `${r.counties} of ${N} counties have counted ballots; ${fPct(r.precinctPct, 0)} of precincts are in` : 'Counting has not started'; },
    sub: 'Precincts reporting by county, from Florida Election Watch.',
    draw: drawReportMap,
    notes: {
      what: 'A progress map shades each county by how much of its count is finished. It tells you which results are close to final and which are still early.',
      how: 'Darker means more precincts are in. The palest gray means nothing is reporting yet. Hover a county for what it has counted.',
      shows: () => { const r = stateReporting(RLAST), done = C.filter(c => (countyReportingPct(c.i) || 0) >= 100).length; return `**${done}** counties are at 100%. Statewide, **${fPct(r.precinctPct, 0)}** of precincts have reported and **${fInt(r.ballots)}** ballots are counted.`; },
      watch: 'A precinct counts as "reporting" once it posts anything, so a county at 100% can still be tallying. Official results come days later.',
    },
  });
}
function drawProgressTime(host, w, api) {
  const xs = RSNAPS.map(s => new Date(s.t).getTime());
  const pct = RSNAPS.map((_, s) => stateReporting(s).precinctPct), bal = RSNAPS.map((_, s) => stateReporting(s).ballots);
  if (!bal.some(v => v > 0)) { emptyCard(host, 'No ballots counted in any snapshot yet. When counting starts, this shows how fast the count moves.'); api.label('No data yet.'); return; }
  const a = h('div'), b = h('div', { style: { marginTop: '10px' } }); host.append(a, b);
  kitLines(a, w, xs, [{ name: 'Precincts reporting', color: 'var(--early)', ys: pct }], { yFmt: v => v + '%', yMax: 100, endFmt: v => fPct(v, 0), xFmt: (m, i) => fmtClock(RSNAPS[i].t), tipHead: i => `${snapLabel(i)} ET`, height: 200 });
  kitLines(b, w, xs, [{ name: 'Ballots counted', color: 'var(--ink)', ys: bal }], { yFmt: fComp, endFmt: fComp, xFmt: (m, i) => fmtClock(RSNAPS[i].t), tipHead: i => `${snapLabel(i)} ET`, height: 200 });
  api.label('Precincts reporting and ballots counted over the snapshots.');
}
function progressTimeCard() {
  return card({
    id: 'r-pace', kicker: 'Line chart', cat: 'pearl', stack: true,
    title: 'How fast the count is moving',
    sub: 'Top: share of precincts reporting. Bottom: ballots counted statewide. One point per saved pull.',
    draw: drawProgressTime,
    notes: {
      what: 'Two line charts, one above the other, share a time axis. One shows how complete the count is, the other how many ballots it holds.',
      how: 'A steep climb means many counties reporting at once. A flat stretch means everyone is working through the next batch.',
      shows: () => { const b = RSNAPS.map((_, s) => stateReporting(s).ballots), i = b.findIndex(v => v > 0); return i < 0 ? 'The lines start at the first pull with ballots counted.' : `The first counted ballots arrived at **${fmtClock(RSNAPS[i].t)}**; the latest pull has **${fInt(b[RLAST])}** counted.`; },
      watch: 'Votes are reported in batches (early and mail first), so the pace is lumpy by design.',
    },
  });
}
function drawKnown(host, w, api) {
  const rows = C.map(c => ({ c, counted: ballotsCast(RLAST, c.i), known: c.mail + c.early })).filter(x => x.known > 0).sort((a, b) => b.known - a.known).slice(0, 20);
  if (!rows.some(x => x.counted > 0)) { emptyCard(host, 'No ballots counted yet. After polls close, this compares ballots counted with the early and mail ballots we saw cast beforehand.'); api.label('No data yet.'); return; }
  kitBars(host, w, rows.map(x => ({ label: x.c.name, sub: `${fComp(x.counted)} counted of ${fComp(x.known)} early + mail`, value: 100 * x.counted / x.known, color: x.counted >= x.known ? 'var(--mail)' : 'var(--early)', hi: selection.i === x.c.i, text: fPct(100 * x.counted / x.known, 0), click: () => selection.set(x.c.i),
    tip: () => tipContent(x.c.name, [{ label: 'Ballots counted', value: fInt(x.counted) }, { label: 'Early + mail seen before', value: fInt(x.known) }, { label: 'Counted as % of that', value: fPct(100 * x.counted / x.known, 1) }], 'Election Day ballots push this above 100%') })),
    { rowH: 40, fmt: v => v + '%', ref: { value: 100, label: 'All early + mail counted' }, labelW: Math.min(230, w * .4) });
  api.label('Ballots counted compared with the early and mail ballots seen before Election Day.');
}
function knownCard() {
  return card({
    id: 'r-known', kicker: 'Bullet-style bars', cat: 'pearl', stack: true,
    title: 'Counted so far versus the early and mail ballots we already knew about',
    sub: 'The 20 biggest counties. 100% means the county has counted at least as many ballots as were cast early or by mail.',
    draw: drawKnown,
    notes: {
      what: 'This joins two datasets: the turnout we tracked before polls closed, and the ballots the results feed says are counted. The ratio is a rough "how much of the vote is in?"',
      how: 'Each bar is ballots counted divided by early plus mail ballots. Below 100% the county is still working through its early and mail ballots. Above 100% Election Day votes are in the count too.',
      shows: () => { const rows = C.map(c => ({ c, r: c.mail + c.early ? ballotsCast(RLAST, c.i) / (c.mail + c.early) : 0 })).filter(x => x.r > 0); return rows.length ? `**${rows.filter(x => x.r >= 1).length}** counties have counted at least as many ballots as early plus mail; **${rows.filter(x => x.r < 1).length}** have not.` : 'Fills in after polls close.'; },
      watch: 'This is a rough yardstick, not a forecast. Mail ballots can still arrive and be counted, and counties publish ballots cast and race results on different schedules.',
    },
  });
}

/* 4. a finder for the local races (county commission, sheriff, school board, cities, ballot questions) */
const localState = { q: '', kind: 'all', sort: { key: 'votes', dir: -1 } };
function drawLocal(host) {
  const ci = scopeCi(), q = localState.q.trim().toLowerCase();
  const rows = LR.filter(l => l.sw < 0 && (ci == null || l.ci === ci) && (localState.kind === 'all' || localKind(l.name) === localState.kind) && (!q || l.name.toLowerCase().includes(q) || l.cands.some(c => c[0].toLowerCase().includes(q)) || C[l.ci].name.toLowerCase().includes(q)))
    .map(l => ({ l, sm: summarize(lvotes(l), l.cands) }));
  const cols = [
    { k: 'county', t: 'County', get: x => C[x.l.ci].name, cls: 'name' }, { k: 'name', t: 'Contest', get: x => x.l.name, cls: 'wrapcell namecell', node: x => h('div', null, h('div', { class: 'rb-name' }, x.l.name), h('div', { class: 'rb-sub' }, localKind(x.l.name))) },
    { k: 'cands', t: 'Candidates', nosort: true, get: () => '', cls: 'hide-sm wrapcell', node: x => candLine(x.l.cands, x.l.cands.map((_, i) => i), 2) },
    { k: 'lead', t: 'Leading', get: x => x.sm.lead >= 0 ? x.sm.shares[x.sm.lead] : -1, node: x => x.sm.total && x.sm.lead >= 0 ? h('span', { style: { whiteSpace: 'nowrap' } }, partyChip(x.l.cands[x.sm.lead][1]), ' ', x.l.cands[x.sm.lead][0], ' ', h('b', null, fPct(x.sm.shares[x.sm.lead]))) : noVotes() },
    { k: 'votes', t: 'Votes', n: true, get: x => x.sm.total, fmt: v => v ? fInt(v) : '—' },
  ];
  host.append(kitTable(cols, rows.slice(0, 600), localState.sort, () => drawLocal(clear(host)), { onRow: x => { selection.set(x.l.ci); setContest('L' + x.l.i); }, maxH: '520px', minW: '720px', empty: ci != null ? `No local races found for ${C[ci].name}.` : 'No local races match.', label: 'Table of local races' }));
  if (rows.length > 600) host.append(h('p', { class: 'mini-note' }, `Showing the first 600 of ${fInt(rows.length)}. Narrow the search.`));
}
function localCard() {
  let api;
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Search contests, candidates or counties…', 'aria-label': 'Search local races', oninput: e => { localState.q = e.target.value; api.redraw(); } });
  const kinds = chipRow([['all', 'All'], ...LOCAL_KINDS.map(([k]) => [k, k]), ['Other local', 'Other']], localState.kind, v => { localState.kind = v; api.redraw(); }, 'Kind of race');
  api = card({
    id: 'r-local', kicker: 'Table', cat: 'mochi', stack: true, noTable: true, controls: [search, kinds],
    title: () => scopeC() ? `Local races in ${scopeName()}: commission, sheriff, schools, cities and ballot questions` : 'Every local race the county election sites report',
    sub: () => scopeC() ? 'Click a row to open it in the race detail above.' : 'Pick a county in the menu to narrow this to one ballot, or search all counties. Click a row to open the race.',
    foot: () => `${fInt(LR.filter(l => l.sw < 0).length)} local contests across ${new Set(LR.map(l => l.ci)).size} counties. Counties not listed have not published a 2026 general-election results page yet.`,
    draw: host => drawLocal(host),
    notes: {
      what: 'The statewide feed covers state and federal races. Everything else (county commission, sheriff, school board, city councils, charter amendments) lives on each county’s own election site, and this table gathers them.',
      how: 'Filter by kind, search by name, and sort by votes to find the biggest contests. The chip shows the candidate’s party when there is one.',
      shows: () => { const n = LR.filter(l => l.sw < 0 && (scopeCi() == null || l.ci === scopeCi())).length; return `**${fInt(n)}** local contests${scopeC() ? ` on ${scopeName()}’s ballot` : ' statewide'}. ${anyResults() ? '' : 'No votes yet, so this is a ballot preview.'}`; },
      watch: 'Coverage depends on which counties have posted results pages. A missing county is a gap in the data, not a county with no local races.',
    },
  });
  return api;
}
