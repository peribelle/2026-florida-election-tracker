/* ---------- chapter: the learn-by-looking corner ---------- */
const brow = () => C.find(c => c.name === 'Broward');
function tipsGrid() {
  const b = brow(), allR = D.meta.broward.allRegistered, actR = D.meta.broward.activeRegistered;
  const denom = b && allR && actR ? `Broward reports against all registered voters, including inactive ones: **${fPct(100 * b.total / allR)}**. Every other county uses active voters. On the active basis Broward is **${fPct(100 * b.total / actR)}**, so that is what this page uses.` : 'Counties can report against all registered voters or only active ones. This page uses active registered voters everywhere so the rates compare.';
  const tips = [
    ['Check the denominator', `Turnout divides ballots by "registered voters", and the definition of registered moves the answer. ${denom}`],
    ['Rates compare, counts size', 'A count says how big something is. A rate says how likely it is. Miami-Dade casts the most ballots because it has the most voters, not because its voters are the keenest. Use rates to compare places of different sizes.'],
    ['Small numbers wobble', 'A precinct at 90% turnout can be nine people out of ten. Before you read anything into a very high or very low rate, ask how many people are behind it. The funnel plot above shows the effect.'],
    ['“So far” is not “final”', HAS_ED ? 'These counts are unofficial and still changing. Different groups choose different ways to vote, so a pattern so far is not a forecast of the final result.' : 'Everything here is mail and early voting. Election Day is still to come, and different groups choose different ways to vote. A pattern in early ballots is not a forecast of the result.'],
    ['Correlation is not causation', 'Counties with more voters tend to have higher turnout. That does not mean size causes turnout. Age, income, campaigns and ease of voting all differ between big and small counties.'],
    ['A forecast is not a result', 'A 90% chance to win still loses one time in ten. Forecasts and market prices are shown beside the count, never mixed into it, and when sources disagree this page shows each one rather than an average.'],
    ['Mind the baseline', 'Bars should start at zero. If the axis starts at 30%, a two-point difference looks like a cliff. And never put two different scales on one chart: the overlap is arbitrary and can invent a relationship.'],
  ];
  return h('div', { class: 'tips' }, tips.map(([t, p]) => h('div', { class: 'tip-card' }, h('h3', null, s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, use('paw')), t), h('p', null, rich(p)))));
}
function glossary() {
  const g = [
    ['Active registered voter', 'A person on the rolls who is eligible to vote and not flagged inactive. The denominator for every turnout rate here, from the state’s Oct 5 book-closing report.'],
    ['Turnout', 'Ballots cast divided by active registered voters, as a percentage.'],
    ['Mail ballot', 'A vote-by-mail ballot that the voter returned and the county recorded.'],
    ['Early voting', 'In-person voting at a county site before Election Day. In this data it ran from Oct 19 through Nov 1.'],
    ['Election Day ballot', HAS_ED ? `A ballot cast in person on Nov 3. ${fInt(ST.ed)} are counted in this snapshot.` : 'A ballot cast in person on Nov 3. None are counted in this snapshot.'],
    ['Provisional ballot', `A ballot set aside until the county confirms the voter’s eligibility. There are ${fInt(ST.prov)} so far. They count in totals but are too few to draw.`],
    ['Precinct', 'The smallest voting district. This data has ' + fInt(PC.r.length) + ' of them.'],
    ['Percentage point', 'The difference between two percentages. 49.8% minus 38.6% is 11.2 points. It is not the same as a percent change.'],
    ['Median', 'The middle value once everything is sorted. Half the values are below it and half above.'],
    ['Percentile and quartile', 'The 25th percentile (first quartile) is the value a quarter of the data falls below. The middle half of the data sits between the 25th and 75th.'],
    ['Outlier', 'A value far from the rest. Worth a second look, often not an error.'],
    ['Correlation (r)', 'A number from -1 to +1 for how closely two things move together in a straight line. Near 0 means no straight-line link.'],
    ['Log scale', 'An axis where each step multiplies instead of adds, so tiny and huge values both fit.'],
    ['Quantile class', 'A group that holds about the same number of items as the others. Five quantile classes put about a fifth of counties in each map shade.'],
    ['Vote share and margin', 'A candidate’s share is their votes divided by all votes counted in the race. The margin is the leader’s share minus second place, in percentage points.'],
    ['Precincts reporting', 'The share of a county’s voting districts that have posted at least some results. It tells you how finished the count is, not how many ballots are left.'],
    ['Undervote (roll-off)', 'A ballot that was cast but left a particular race blank. Roll-off is the share of ballots that skipped a race.'],
    ['Forecast and win probability', 'A model’s estimate of how likely a candidate is to win, such as 61%. It is not a vote share: it means that candidate would win about 6 times in 10 if the election were rerun many times.'],
    ['Prediction market', 'A market where people trade shares that pay $1 if a candidate wins. The price in cents is read as a probability. Thin markets (little money traded) can move on a few trades.'],
    ['Race call', 'A news organization’s announcement that a candidate has won. Here the only source is DDHQ. A call is a judgment, not a certified result.'],
    ['Party colors', 'Red is Republican, blue is Democratic and yellow is Independent (no party affiliation, or the Independent Party of Florida). Gray is every other party. These colors are never used for anything else.'],
    ['Snapshot (pull)', 'One saved copy of a data feed at a moment in time. Turnout runs, results pulls, precinct pulls and projection pulls are never edited, so any two can be compared.'],
  ];
  return h('dl', { class: 'gloss' }, g.map(([t, d]) => h('div', null, h('dt', null, t), h('dd', null, d))));
}
function aboutBox() {
  const a = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  const b = D.meta.broward;
  return h('div', { class: 'about' },
    h('details', { open: true }, h('summary', null, 'Where the numbers come from'),
      h('p', null, 'Turnout for 66 counties comes from each county’s own turnout widget (VR Systems Turnout Quick View). Broward publishes through its own dashboard. Registered voters, by county, party and precinct, come from the Florida Division of Elections book-closing report for this election (closed Oct 5). All figures are unofficial.')),
    h('details', null, h('summary', null, 'Results, forecasts and snapshots'),
      h('ul', null,
        h('li', null, 'Statewide races come from the Florida Division of Elections’ Election Watch feed. County, city and school races, and the split by Election Day, early and mail, come from each county’s own election site, for the counties that have posted one.'),
        h('li', null, 'Forecasts and race calls come from DDHQ; market prices from Kalshi and Polymarket. They are saved separately from the vote count and are predictions, not votes.'),
        h('li', null, 'Every pull is archived and never edited. The Snapshots view compares any two. A pull that looks identical to the one before it simply had nothing new at its source.'),
        h('li', null, 'Red is Republican, blue is Democratic, yellow is Independent. County colors in the Compare view are plum, brown sugar, taro and matcha so they never look like a party.'))),
    h('details', null, h('summary', null, 'How the tricky parts were handled'),
      h('ul', null,
        h('li', null, `Broward’s dashboard divides by all ${fInt(b.allRegistered)} registered voters. We use its ${fInt(b.activeRegistered)} active voters, like the other counties, both for the county and for each of its 346 precincts.`),
        h('li', null, 'Broward reports one daily number for all ballot types. We split it using its early-voting-site counts: mail is the day’s total minus that day’s early votes. The result matches Broward’s own mail total to within 0.02%.'),
        h('li', null, 'Party figures put Republican, Democratic and no-party voters in their own groups. Everything else (minor parties, unknown, and Broward’s lumped “other”) is grouped as minor parties.'),
        h('li', null, 'Precinct charts use precincts with at least 50 registered voters, except the funnel plot, which uses 10 or more so the small-number wobble is visible.'))),
    h('details', null, h('summary', null, 'Things to keep in mind'),
      h('ul', null,
        h('li', null, `The oldest county feed in this snapshot was last updated ${stampET(D.meta.feedOldest)}; the newest ${stampET(D.meta.feedLatest)}. Counties refresh on their own schedules.`),
        h('li', null, 'Party is a voter’s registration. The data does not record how anyone voted.'),
        h('li', null, 'The county turnout widgets switch off when polls close at 7 PM on Election Day, so the last pull before then is the last turnout snapshot. Results come from a different source.'))),
    h('details', null, h('summary', null, 'Where these chart types come from'),
      h('p', null, 'The mix of charts follows what election-data guides recommend: line charts for change over time, bars for comparison, choropleth maps for geography, histograms for distribution, scatter plots for relationships, small multiples and sparklines for many comparisons, and a table when exact numbers matter. See ',
        a('https://infogram.com/blog/ways-to-visualize-data-about-elections/', 'Infogram'), ', ', a('https://flourish.studio/blog/report-on-elections-with-flourish/', 'Flourish'), ' and the ', a('https://www.ifes.org/learning-series-disability-inclusive-election-technology/accessible-election-data-visualization', 'IFES guide to accessible election charts'),
        '. Colors were checked for color-blind safety and contrast, in light and dark, and every chart has a table view.')),
    h('details', null, h('summary', null, 'Refreshing this page'),
      h('p', null, 'The page is rebuilt from the latest tables after every turnout refresh and after every results pull. To rebuild by hand: ', h('code', null, '.venv/bin/python build_viewer.py'), '. It writes ', h('code', null, 'Reports/viewer.html'), ' as a single file you can open offline. Reload the page to see the newest data.')));
}

function learnChapter() {
  return [h('div', null, h('h2', { style: { font: '600 1.25rem var(--font-display)' } }, 'Seven habits of a skeptical chart reader'), tipsGrid()),
    h('div', null, h('h2', { style: { font: '600 1.25rem var(--font-display)' } }, 'Words you will meet'), glossary()),
    h('div', null, h('h2', { style: { font: '600 1.25rem var(--font-display)' } }, 'About this page'), aboutBox())];
}

VIEWS.learn = {
  build() {
    const root = h('div', null, viewHead('Learn the lingo', 'Short lessons on reading charts without getting fooled, a glossary, and notes on how the data was put together.'), ...learnChapter().map(x => h('section', { class: 'chapter' }, x)));
    return { root, sub: [] };
  },
};
