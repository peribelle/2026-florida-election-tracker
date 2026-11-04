/* ---------- the Results view ---------- */
VIEWS.results = {
  build() {
    if (!HAS_RESULTS) return { root: h('div', null, viewHead('Results', 'No results snapshots have been saved yet.'), emptyState('Run results.py to create the first snapshot.')), sub: [] };
    if (param('race')) RES.key = param('race');
    const CH = [
      { id: 'res-board', nav: 'The races', title: 'The races on the ballot', lead: () => scopeC() ? `Races that include **${scopeLabel()}**, with local contests from the county election site.` : 'Statewide, district and judicial races, with seat tallies and the tightest contests.', cards: () => [statusBanner(), boardCard().el, ...(HAS_PROJ ? [forecastBoardCard().el, forecastTimeCard().el] : []), seatCard().el, closestCard().el] },
      { id: 'res-race', nav: 'One race in depth', title: 'One race in depth', lead: () => { const hd = currentContest(); return hd ? `Showing **${hd.name}**${scopeC() ? ` for **${scopeLabel()}**` : ''}. Change the race in any card, or click a row in the board.` : ''; }, cards: () => [countCard().el, ...(HAS_PROJ ? [forecastCard().el] : []), raceMapCard().el, raceTableCard().el, raceTimeCard().el, methodCard().el, raceDistCard().el] },
      { id: 'res-across', nav: 'Across races', title: 'Comparing races and counties', lead: 'Do counties vote the same way in different races, and which races did voters skip?', cards: () => [ticketCard().el, rolloffCard().el] },
      { id: 'res-count', nav: 'The count', title: 'The count itself', lead: 'How much of the vote is in, how fast it is arriving, and how it compares with the ballots we saw before polls closed.', cards: () => [reportMapCard().el, progressTimeCard().el, knownCard().el] },
      { id: 'res-local', nav: 'Local races', title: 'Local races', lead: () => scopeC() ? `County commission, sheriff, schools, cities and ballot questions in **${scopeName()}**.` : 'County commission, sheriff, school board, city races and local ballot questions.', cards: () => [localCard().el] },
      { id: 'res-prec', nav: 'Precincts', title: 'Precinct detail', lead: () => `Precinct-level results for the **${precCounties().length}** counties that publish them.`, cards: () => [precChartsCard().el, precTableCard().el] },
    ];
    const sub = CH.map(c => ({ id: c.id, label: c.nav }));
    const root = h('div', null, viewHead('Results', () => anyResults() ? `**${RACES.filter(r => raceHasVotes(r)).length}** of ${RACES.length} statewide-feed races have votes counted. ${RSNAPS[RLAST].synth ? `**${RSNAPS[RLAST].synth}** of them are built from the counties' own results sites (summed over the counties reporting) because the state's feed has not loaded them yet; the state's numbers replace these as soon as they arrive. ` : ''}Unofficial and changing with every pull.` : 'The election is tomorrow, so no votes are counted yet. The races, candidates and your county’s ballot are all here and will fill in as results arrive.'), inlineSubnav(sub),
      ...CH.map((ch, i) => chapter(ch.id, String(i + 1), ch.title, ch.lead, ch.cards())));
    const adopt = () => { const k = param('race'); if (k && k !== RES.key && contestHandle(k)) { RES.key = k; (viewCache.results ? viewCache.results.live : []).forEach(i => i.run()); } };
    return { root, sub, onParams() { adopt(); redrawView('results'); }, onShow() { adopt(); setParam('race', RES.key); } };
  },
};
