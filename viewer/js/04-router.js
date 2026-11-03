/* ---------- router, the global county scope, and the view lifecycle ----------
   URL shape:  #/<view>?c=<county code>&s=<section id>&...view-specific params
   The county (c) is global: pick one and every view re-tailors itself. */
const VIEW_ORDER = [['overview', 'Overview'], ['turnout', 'Turnout'], ['results', 'Results'], ['compare', 'Compare'],
  ['snapshots', 'Snapshots'], ['lab', 'Data lab'], ['learn', 'Learn']];
const VIEWS = {};                   // id -> { build() -> { root, sub: [{id,label}], refresh?, onShow? } }
const viewCache = {};
const route = { view: 'overview', params: {} };
let activeView = null, currentBuild = null, spy = null, liveSink = null;

/* text that depends on the county scope: registered while a view builds, re-run by the view's refresh */
function live(el, fn) {
  const item = { el, run: () => { const v = fn(); clear(el); if (v != null) el.append(typeof v === 'string' ? rich(v) : v); } };
  item.run(); if (liveSink) liveSink.push(item);
  return el;
}

const scopeC = () => selection.i == null ? null : C[selection.i];
const scopeName = () => scopeC() ? scopeC().name : 'Florida';
const scopeLabel = () => scopeC() ? `${scopeC().name} County` : 'Florida';
const param = k => route.params[k];

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, ''), cut = raw.indexOf('?');
  const path = cut < 0 ? raw : raw.slice(0, cut), params = {};
  new URLSearchParams(cut < 0 ? '' : raw.slice(cut + 1)).forEach((v, k) => { params[k] = v; });
  return { view: VIEWS[path] ? path : 'overview', params };
}
function hashFor(view, params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, v);
  return `#/${view}${q.toString() ? '?' + q.toString().replace(/%2C/gi, ',') : ''}`;      // commas stay readable: ?cmp=DAD,HIL
}
function setParam(k, v) {            // mirrors in-view state into the URL without adding history entries
  if (v == null || v === '') delete route.params[k]; else route.params[k] = String(v);
  const h = hashFor(route.view, route.params);
  if (location.hash !== h) history.replaceState(null, '', h);
}
function go(view, params = {}) {     // navigate: a real history entry; keeps the county
  const p = { ...params };
  if (selection.i != null && p.c === undefined) p.c = C[selection.i].id;
  location.hash = hashFor(view, p);
}
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
}

/* ---- the county scope: the dropdown, the URL and the views all follow selection ---- */
function buildCountySelect() {
  const sel = $('#county-select');
  clear(sel).append(h('option', { value: '' }, 'All of Florida'),
    ...[...C].sort((a, b) => a.name.localeCompare(b.name)).map(c => h('option', { value: c.id }, `${c.name}`)));
  sel.addEventListener('change', () => selection.set(sel.value ? C.findIndex(c => c.id === sel.value) : null));
}
function syncCountySelect() {
  const sel = $('#county-select'); if (!sel) return;
  sel.value = selection.i == null ? '' : C[selection.i].id;
  sel.closest('.countypick').classList.toggle('on', selection.i != null);
}
selection.on(() => {
  if (!activeView) return;
  syncCountySelect();
  setParam('c', selection.i == null ? null : C[selection.i].id);
  for (const v of Object.values(viewCache)) v.stale = true;
  renderTabs();
  const v = viewCache[activeView];
  if (v) { v.stale = false; refreshView(v); }
  redrawView(activeView);
});

/* ---- tabs and section chips ---- */
function renderTabs() {
  const c = selection.i == null ? '' : `?c=${C[selection.i].id}`;
  clear($('#tabs')).append(...VIEW_ORDER.filter(([id]) => VIEWS[id]).map(([id, label]) =>
    h('a', { href: `#/${id}${c}`, ...(id === activeView ? { 'aria-current': 'page' } : {}) }, label)));
}
function renderSubnav(v) {
  const sub = v.sub || [];
  const links = sub.map(x => h('li', null, h('a', { href: '#', 'data-nav': x.id, onclick: e => { e.preventDefault(); scrollToId(x.id); } }, x.label)));
  clear($('#subnav')).append(...links);
  if (spy) spy.disconnect();
  if (!sub.length) return;
  const all = [...document.querySelectorAll('#subnav [data-nav]')];
  spy = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting && scrollY > 300) all.forEach(a => a.setAttribute('aria-current', String(a.dataset.nav === e.target.id)));
  }), { rootMargin: '-30% 0px -60% 0px' });
  sub.forEach(x => { const el = document.getElementById(x.id); if (el) spy.observe(el); });
}
function inlineSubnav(sub) {         // phones: the sticky sub-nav is hidden, so the view carries its own
  return sub.length ? h('ul', { class: 'subnav-inline', 'aria-label': 'Sections in this view' },
    sub.map(x => h('li', null, h('a', { href: '#', onclick: e => { e.preventDefault(); scrollToId(x.id); } }, x.label)))) : null;
}

/* ---- views ---- */
const refreshView = v => { (v.live || []).forEach(i => i.run()); v.refresh && v.refresh(); };
const redrawView = id => registry.filter(a => a.view === id && !a.dead).forEach(a => a.redraw());
function showView(id, section) {
  if (!VIEWS[id]) id = 'overview';
  route.view = id;
  if (activeView === id && viewCache[id]) { viewCache[id].onParams && viewCache[id].onParams(); if (section) scrollToId(section); return; }
  if (activeView && viewCache[activeView]) viewCache[activeView].root.remove();
  activeView = id;
  let v = viewCache[id];
  if (!v) { currentBuild = id; liveSink = []; v = viewCache[id] = VIEWS[id].build(); v.live = liveSink; liveSink = null; currentBuild = null; }
  clear($('#view')).append(v.root);
  renderTabs(); renderSubnav(v);
  if (v.stale) { v.stale = false; refreshView(v); }
  v.onShow && v.onShow();
  redrawView(id);
  document.title = `${VIEW_ORDER.find(x => x[0] === id)[1]} · Taro Tally`;
  if (section) requestAnimationFrame(() => scrollToId(section)); else scrollTo(0, 0);
}
function applyRoute() {
  const r = parseHash();
  route.params = r.params;
  const ci = r.params.c ? C.findIndex(c => c.id === r.params.c) : -1;
  const want = ci >= 0 ? ci : null, changed = want !== selection.i;
  if (changed) { selection.i = want; syncCountySelect(); for (const v of Object.values(viewCache)) v.stale = true; }
  if (changed && activeView === r.view && viewCache[r.view]) {
    const v = viewCache[r.view]; v.stale = false; refreshView(v); v.onParams && v.onParams(); redrawView(r.view); renderTabs();
    if (r.params.s) scrollToId(r.params.s);
    return;
  }
  showView(r.view, r.params.s);
}
addEventListener('hashchange', applyRoute);
