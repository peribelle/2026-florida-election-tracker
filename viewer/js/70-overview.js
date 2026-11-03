/* ---------- the Overview view: the hero, headlines, your county's report card and a menu of every view ---------- */
function buildHero() {
  const root = document.getElementById('tpl-hero').content.firstElementChild.cloneNode(true);
  const q = sel => $(sel, root);
  live(q('#hero-num'), () => fInt(totalsFor(scopeCi()).total));
  live(q('#hero-cap'), () => { const T = totalsFor(scopeCi()); return scopeC() ? `ballots cast so far in **${scopeLabel()}**, **${fPct(T.rate)}** of ${fInt(T.reg)} active registered voters (#${scopeC().rank} of ${N})` : `ballots cast so far, **${fPct(T.rate)}** of ${fMil(T.reg)} active registered voters`; });
  live(q('.eyebrow'), () => h('span', null, scopeC() ? `${scopeLabel()} · Florida General Election · Nov 3, 2026` : 'Florida · General Election · Nov 3, 2026'));
  live(q('.hero .sub'), () => scopeC() ? `Everything in this app is now tailored to ${scopeLabel()}. Pick "All of Florida" in the county menu to zoom back out.` : 'Every chart for Florida’s turnout and results, explained for first-timers by Mochi the cat. Unofficial numbers from the county feeds.');
  live(q('#hero-status'), () => { const open = C.filter(c => c.total > 0).length; return h('div', { style: { display: 'contents' } }, ...[`Data as of ${stampET(SNAP)}`, `${open} of ${N} counties reporting`, electionPhase].map(t => h('span', null, t))); });
  live(q('#kpis'), () => { const box = h('div', { class: 'kpis', style: { margin: 0 } }); renderKpis(box); return box; });
  return root;
}
/* a link that keeps the chosen county */
const viewHref = (view, id) => hashFor(view, { ...(selection.i != null ? { c: C[selection.i].id } : {}), ...(id ? { s: id } : {}) });
const viewLink = (view, id, text) => h('a', { href: viewHref(view, id) }, text);

/* ---- status strip: what is saved and how fresh ---- */
function statusStrip() {
  return h('section', { class: 'card plain', 'aria-label': 'Data status', style: { gap: '10px' } }, live(h('div'), () => {
    const chips = [h('span', { class: 'spill' + (HAS_RESULTS && anyResults() ? ' ok' : ' warn') }, HAS_RESULTS && anyResults() ? 'Votes are being counted' : DAYS_TO_GO <= 0 ? 'Election Day: waiting for polls to close at 7 PM' : electionPhase),
      h('span', { class: 'spill' }, `Turnout: ${RUNS.length ? `${plural(RUNS.length, 'run')}, latest ${pullClock('turnout', RUNS.length - 1)}` : 'no archived runs'}`)];
    if (HAS_RESULTS) chips.push(h('span', { class: 'spill' }, `Results: ${plural(RSNAPS.length, 'pull')}, latest ${pullClock('results', RLAST)}`));
    if (HAS_PROJ) chips.push(h('span', { class: 'spill' }, `Forecasts: ${plural(PSNAPS.length, 'pull')}, latest ${pullClock('proj', PLAST)}`));
    if (HAS_CHECKS) chips.push(checksChip());
    return h('div', null, h('div', { class: 'chips' }, chips), h('p', { class: 'mini-note', style: { marginTop: '10px' } }, 'All numbers are unofficial. ', viewLink('snapshots', 'snap-timeline', 'See every saved pull'), '.'));
  }));
}

/* ---- headlines: sentences written from the data, each linking to the chart behind it ---- */
function headlineItems() {
  const ci = scopeCi(), c = scopeC(), T = totalsFor(ci), out = [], ps = [...partyStatsFor(ci)].sort((a, b) => b.rate - a.rate), pk = peakOf(dayRows(ci).slice(START)), inC = c ? ` in ${c.name}` : '';
  out.push({ k: 'Turnout', v: 'turnout', id: c ? 'c-ranked' : 'c-map', text: c ? `**${c.name}** has voted at **${fPct(T.rate)}**: #${c.rank} of ${N} counties and **${Math.abs(T.rate - ST.rate).toFixed(1)}** points ${T.rate >= ST.rate ? 'above' : 'below'} Florida (${fPct(ST.rate)}).` : `**${fPct(ST.rate)}** of Florida’s ${fMil(ST.reg)} active registered voters have voted. **${BY_RATE[0].name}** leads at **${fPct(BY_RATE[0].rate)}** and **${BY_RATE[N - 1].name}** trails at **${fPct(BY_RATE[N - 1].rate)}**.` });
  out.push({ k: 'How people voted', v: 'turnout', id: 'c-types', text: `**${fPct(100 * T.mail / (T.total || 1), 0)}** of ballots${inC} came by mail, **${fPct(100 * T.early / (T.total || 1), 0)}** in person before Election Day${HAS_ED ? ` and **${fPct(100 * T.ed / (T.total || 1), 0)}** on Election Day` : ''}.` });
  out.push({ k: 'Party', v: 'turnout', id: 'c-prate', text: `**${ps[0].who}** are turning out at the highest rate${inC}: **${fPct(ps[0].rate)}**, ahead of **${ps[1].who}** at **${fPct(ps[1].rate)}**. Party is how a voter registered, not how anyone voted.` });
  out.push({ k: 'Busiest day', v: 'turnout', id: 'c-daily', text: `**${pk.long}** was the busiest day${inC}, with **${fInt(pk.total)}** ballots.` });
  if (HAS_RESULTS) {
    const g = RACE_BY_ID.get('160000');
    if (anyResults() && g) { const at = c && g.rowIdx.has(ci) ? ci : -1, sm = raceSum(g, at); out.push({ k: 'The count', v: 'results', id: 'r-race', text: `Governor: **${leaderPhrase(g, sm)}**${at === -1 ? '' : ` in ${c.name}`}, with **${fInt(sm.total)}** votes counted. **${RACES.filter(r => raceHasVotes(r)).length}** of ${RACES.length} races have votes.` }); }
    else out.push({ k: 'The count', v: 'results', id: 'r-board', text: `Polls close at 7 PM. **${RACES.length}** statewide races${c ? ` and **${countyBallot(ci).length}** contests on ${c.name}’s ballot` : ` and **${fInt(LR.filter(l => l.sw < 0).length)}** county contests in ${new Set(LR.map(l => l.ci)).size} counties`} are waiting for their first votes.` });
  }
  if (HAS_PROJ) {
    const gv = PJR.find(R => R.key === 'FL-GOV'), f = gv && pjFavorite(gv.i), rows = PJR.map(R => ({ R, f: pjFavorite(R.i) })).filter(x => x.f).sort((a, b) => a.f.p - b.f.p), called = PJR.filter(R => pjCall(R.i)).length;
    if (f) out.push({ k: 'Forecasts', v: 'results', id: 'r-fcboard', text: `Forecasters favor **${sideName(f.sideObj)}** for governor (**${fProb(f.p)}**, ${f.tag.toLowerCase()}). The closest forecast race is **${rows[0].R.name}** (**${sideName(rows[0].f.sideObj)}** ${fProb(rows[0].f.p)}).${called ? ` DDHQ has called **${called}** race${called === 1 ? '' : 's'}.` : ''}` });
  }
  const o = outlierRows()[0];
  if (o) out.push({ k: 'What stands out', v: 'lab', id: 'lab-outliers', text: `**${o.c.name}** is unusual on ${mdef(o.id).t.toLowerCase()}: **${mdef(o.id).f(o.v)}**, **${Math.abs(o.z).toFixed(1)}** standard deviations ${o.z >= 0 ? 'above' : 'below'} the typical county.` });
  out.push({ k: 'Snapshots', v: 'snapshots', id: 'snap-timeline', text: `**${allPulls().length}** pulls are saved across turnout, results, precinct and forecast feeds. Any two can be compared.` });
  return out;
}
function headlinesList() {
  return live(h('div'), () => h('ul', { class: 'headlines' }, headlineItems().map(x => h('li', null, h('div', { class: 'rb-sub', style: { textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 800 } }, x.k), h('div', null, rich(x.text)), h('div', { style: { marginTop: '6px' } }, viewLink(x.v, x.id, 'Open the chart →'))))));
}

/* ---- the county report card, or a map to pick a county ---- */
const REPORT_IDS = ['rate', 'total', 'mail', 'repRate', 'demRate', 'gap', 'prMed', 'perSite', 'demGov'];
function reportCard() {
  return h('section', { class: 'card plain', id: 'ov-report', 'aria-label': 'County report card', style: { gap: '14px' } }, live(h('div'), () => {
    const c = scopeC(); if (!c) return h('p', { class: 'callout' }, 'Pick a county in the menu at the top, or click one on the map below, and this turns into that county’s report card: where it ranks on a dozen measures, which counties it resembles and where to look next.');
    const ids = REPORT_IDS.filter(id => metricsNow().some(m => m.id === id));
    const tiles = ids.map(id => { const M = mdef(id), v = mvals(id)[c.i], n = mclean(id).length, r = mrank(id, c.i); if (isNaN(v) || r == null) return null;
      return h('div', { class: 'rank-tile' }, h('div', { class: 'l' }, M.t), h('div', { class: 'v' }, M.f(v)), h('div', { class: 'bar', role: 'img', 'aria-label': `${c.name} ranks ${r} of ${n}` }, h('i', { style: { left: (n > 1 ? 100 * (n - r) / (n - 1) : 50) + '%' } })), h('div', { class: 's' }, `#${r} of ${n}${M.state ? ` · Florida ${M.f(M.state())}` : ` · median ${M.f(mstat(id).median)}`}`)); }).filter(Boolean);
    const peers = peersOf(c.i, 6);
    return h('div', { style: { display: 'grid', gap: '14px' } },
      h('h3', { style: { font: '600 1.25rem var(--font-display)' } }, `${c.name} County at a glance`), h('div', { class: 'rank-grid' }, tiles),
      h('div', null, h('div', { class: 'mini-note', style: { fontWeight: 800, marginBottom: '6px' } }, 'Counties about the same size'), h('div', { class: 'chips' }, peers.map(p => h('button', { type: 'button', class: 'chipbtn', 'aria-pressed': 'false', onclick: () => selection.set(p.i) }, p.name)))),
      h('div', { class: 'chips' }, [['turnout', 'c-ranked', 'Its turnout'], ['results', 'r-board', 'Its ballot'], ['compare', 'cmp-pick', 'Compare it with others'], ['lab', 'lab-outliers', 'What stands out'], ['snapshots', 'snap-turnout', 'How it changed between pulls']].map(([v, id, t]) => h('a', { class: 'chipbtn', href: viewHref(v, id), style: { textDecoration: 'none' } }, t))));
  }));
}
function pickMapCard() {
  return card({
    id: 'ov-map', kicker: 'Choropleth map', cat: 'mochi',
    title: () => scopeC() ? `${scopeName()} on the map` : 'Click your county',
    sub: 'Counties are shaded by turnout so far. Click one to tailor every view to it, or use the county menu at the top.',
    draw: (host, w, api) => { const M = MAP_METRICS.rate, sc = mapScale(M); kitMap(host, w, { color: c => sc.color(M.val(c)), legendTitle: 'Turnout so far', legend: sc.classes, tip: c => tipContent(c.name, countyTipRows(c), pickHint), aria: c => `${c.name}: ${fPct(c.rate)} turnout` }); api.label('Map of Florida counties colored by turnout. Click a county to select it.'); },
    notes: { what: 'The map is also a menu. Every county is a button.', how: 'Click a county, or press Enter on it with the keyboard, and the whole page re-tailors itself to that county.', shows: () => scopeC() ? `**${scopeName()}** is selected. Use the county menu to go back to all of Florida.` : 'No county is selected yet.', watch: 'Land area is not people. Small, dense counties are easy to miss, so the menu at the top lists all 67.' },
    table: () => ({ head: ['County', 'Turnout', 'Ballots'], align: ['l', 'n', 'n'], rows: [...C].sort((a, b) => a.name.localeCompare(b.name)).map(c => [c.name, fPct(c.rate), fInt(c.total)]) }),
  });
}

/* ---- the view finder: every card, as a question ---- */
const FINDER = [
  ['turnout', 'c-cup', 'How many registered voters have voted?', 'Waffle chart'], ['turnout', 'c-types', 'Which counties cast the most ballots, and how?', 'Stacked bars'], ['turnout', 'c-daily', 'When did people vote, day by day?', 'Stacked columns'],
  ['turnout', 'c-cum', 'How fast did turnout build?', 'Line chart'], ['turnout', 'c-cal', 'Which weekdays are busiest?', 'Calendar heatmap'], ['turnout', 'c-map', 'Where is turnout highest?', 'Map'], ['turnout', 'c-ranked', 'Which counties lead and trail on turnout?', 'Ranked bars'],
  ['turnout', 'c-table', 'Show me every county in one table', 'Table with sparklines'], ['turnout', 'c-prate', 'Which party’s voters turn out most?', 'Bars'], ['turnout', 'c-share', 'Who has cast the ballots, by party?', 'Donut'],
  ['turnout', 'c-dumb', 'Which party is over- or under-represented among voters?', 'Dumbbell'], ['turnout', 'c-pmix', 'Do Republicans and Democrats vote by mail or in person?', '100% bars'], ['turnout', 'c-gap', 'Where does one party vote at a higher rate?', 'Diverging bars'],
  ['turnout', 'c-hist', 'How spread out is turnout?', 'Histogram'], ['turnout', 'c-box', 'Does county size change precinct turnout?', 'Box plot'], ['turnout', 'c-scatter', 'Do bigger counties vote more?', 'Scatter plot'],
  ['turnout', 'c-funnel', 'Why do tiny precincts swing so wildly?', 'Funnel plot'], ['turnout', 'c-sites', 'Which early-voting sites were busiest?', 'Ranked bars'], ['turnout', 'c-heat', 'When did each county vote?', 'Heatmap'], ['turnout', 'c-small', 'Do big counties share a rhythm?', 'Small multiples'],
  ['results', 'r-board', 'What races are on my ballot?', 'Race board'], ['results', 'r-fcboard', 'Where do forecasters expect close races?', 'Forecast scoreboard', () => HAS_PROJ], ['results', 'r-seats', 'Who is leading in the district races?', 'Seat tally'],
  ['results', 'r-close', 'What are the closest races right now?', 'Ranked bars'], ['results', 'r-race', 'Who is winning this race?', 'Ranked bars'], ['results', 'r-forecast', 'What do forecasters and markets say about this race?', 'Probability bars', () => HAS_PROJ],
  ['results', 'r-map', 'Where is each candidate winning?', 'Map'], ['results', 'r-counties', 'How did every county vote in this race?', 'Table'], ['results', 'r-time', 'How did the count move through the night?', 'Line chart'],
  ['results', 'r-method', 'Did mail, early or Election Day votes favor each candidate?', '100% bars'], ['results', 'r-dist', 'How much does a candidate’s share vary by county?', 'Histogram'], ['results', 'r-ticket', 'Do counties vote the same way in two races?', 'Scatter plot'],
  ['results', 'r-rolloff', 'Which races did voters skip most?', 'Ranked bars'], ['results', 'r-progress', 'How much of the vote is in?', 'Progress map'], ['results', 'r-pace', 'How fast is the count moving?', 'Line chart'],
  ['results', 'r-known', 'How does the count compare with the early and mail ballots we saw?', 'Bullet bars'], ['results', 'r-local', 'What is on the ballot for sheriff, schools and cities?', 'Table'], ['results', 'r-prec', 'What does a race look like precinct by precinct?', 'Precinct charts'],
  ['compare', 'cmp-pick', 'How do two or three counties compare?', 'Picker'], ['compare', 'cmp-share', 'How did these counties split on a race?', '100% bars', () => HAS_RESULTS], ['compare', 'cmp-margin', 'Who won by more, county to county?', 'Ranked bars', () => HAS_RESULTS],
  ['compare', 'cmp-time', 'How did each county’s count move?', 'Line chart', () => HAS_RESULTS], ['compare', 'cmp-pace', 'Which county voted earliest?', 'Line chart'], ['compare', 'cmp-type', 'Do these counties vote by mail or in person?', '100% bars'],
  ['compare', 'cmp-party', 'How does party turnout differ between these counties?', 'Bars and dot plot'], ['compare', 'cmp-spread', 'How uneven is turnout inside each county?', 'Box plot'], ['compare', 'cmp-sites', 'How busy was the average early-voting site?', 'Bars'],
  ['compare', 'cmp-week', 'Which weekday does each county vote on?', 'Dot plot'], ['compare', 'cmp-ballot', 'What is on each county’s ballot?', 'Heatmap', () => HAS_RESULTS], ['compare', 'cmp-table', 'Give me all of it in one table', 'Table'],
  ['snapshots', 'snap-timeline', 'What has the pipeline saved, and when?', 'Timeline'], ['snapshots', 'snap-table', 'Show me every saved pull', 'Table'], ['snapshots', 'snap-turnout', 'What changed between two turnout pulls?', 'Before and after', () => RUNS.length > 0],
  ['snapshots', 'snap-results', 'Which races changed leader between two pulls?', 'Before and after', () => HAS_RESULTS], ['snapshots', 'snap-movers', 'Which counties moved a race’s margin?', 'Diverging bars', () => HAS_RESULTS], ['snapshots', 'snap-proj', 'How did the forecasts move?', 'Before and after', () => HAS_PROJ],
  ['snapshots', 'snap-replay', 'Can I replay the night?', 'Animated bars'], ['snapshots', 'snap-coverage', 'How many counties could the pipeline read?', 'Line chart', () => HAS_RESULTS], ['snapshots', 'snap-fresh', 'How fresh was each turnout pull?', 'Bars', () => RUNS.some(r => r.feed)],
  ['lab', 'lab-scatter', 'Is any measure linked to any other?', 'Scatter lab'], ['lab', 'lab-rank', 'Rank counties by any measure', 'Rank lab'], ['lab', 'lab-map', 'Map any measure', 'Map lab'], ['lab', 'lab-dist', 'What does the spread of any measure look like?', 'Histogram lab'],
  ['lab', 'lab-corr', 'Which measures move together?', 'Correlation matrix'], ['lab', 'lab-sim', 'Which counties are most like mine?', 'Similarity'], ['lab', 'lab-outliers', 'What stands out about a county?', 'Outlier table'],
  ['lab', 'lab-lorenz', 'How few counties make up half the vote?', 'Concentration curve'], ['lab', 'lab-prec', 'Which precincts had the highest turnout?', 'Leaderboard'],
];
const FINDER_VIEWS = [['turnout', 'Turnout'], ['results', 'Results'], ['compare', 'Compare'], ['snapshots', 'Snapshots'], ['lab', 'Data lab']];
const finderState = { q: '', v: 'all' };
function viewFinder() {
  const box = h('div'), list = h('div', { class: 'vfind' }), count = h('p', { class: 'mini-note', role: 'status' });
  const render = () => {
    const q = finderState.q.trim().toLowerCase(), items = FINDER.filter(([v, id, t, kind, ok]) => (finderState.v === 'all' || v === finderState.v) && (!ok || ok()) && (!q || t.toLowerCase().includes(q) || kind.toLowerCase().includes(q)));
    clear(list).append(...items.map(([v, id, t, kind]) => h('a', { class: 'vtile', href: viewHref(v, id) }, h('b', null, t), h('span', null, `${FINDER_VIEWS.find(x => x[0] === v)[1]} · ${kind}`))));
    count.textContent = items.length ? `${items.length} view${items.length === 1 ? '' : 's'}` : 'Nothing matches. Try a shorter search, like "map" or "party".';
  };
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Search the questions…', 'aria-label': 'Search views', oninput: e => { finderState.q = e.target.value; render(); } });
  box.append(h('div', { class: 'pickers' }, h('label', { class: 'grow' }, 'FIND A VIEW', search), chipRow([['all', 'Everything'], ...FINDER_VIEWS], finderState.v, v => { finderState.v = v; render(); }, 'Which part of the app')), count, list);
  render(); return box;
}

VIEWS.overview = {
  build() {
    const CH = [
      { id: 'ov-now', nav: 'Right now', title: 'Right now', lead: () => scopeC() ? `The headlines for **${scopeLabel()}**, written from the data.` : 'The headlines, written from the data. Pick a county to make them local.', cards: () => [statusStrip(), headlinesList()] },
      { id: 'ov-county', nav: 'Your county', title: () => scopeC() ? `${scopeName()} County` : 'Your county', lead: () => scopeC() ? 'Where it ranks, who it resembles, and where to look next.' : 'Choose one and the whole app follows you.', cards: () => [reportCard(), pickMapCard().el] },
      { id: 'ov-find', nav: 'Find a view', title: 'Every view, as a question', lead: `${FINDER.filter(f => !f[4] || f[4]()).length} charts, tables and maps across turnout, results, comparisons, snapshots and the data lab.`, cards: () => [viewFinder()] },
    ];
    const sub = CH.map(c => ({ id: c.id, label: c.nav }));
    const root = h('div', null, buildHero(), inlineSubnav(sub), ...CH.map((ch, i) => chapter(ch.id, String(i + 1), ch.title, ch.lead, ch.cards())));
    return { root, sub };
  },
};
