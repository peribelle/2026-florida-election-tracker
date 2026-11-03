/* ---------- UI: cards, controls, legends, table twins, notes ---------- */
const registry = [];
const redrawAll = () => redrawView(activeView);          // cards in views that are not on screen redraw when shown

const catSvg = who => s('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' }, use(who === 'pearl' ? 'pearl' : 'mochi'));
const pawSvg = () => s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, use('paw'));

/* A chart container is an image only when nothing inside it takes focus; otherwise it is a labelled group. */
function settleRole(viz) {
  const label = viz.getAttribute('aria-label');
  if (viz.querySelector('[tabindex="0"], button, a[href], input, select')) {
    viz.setAttribute('role', 'group');
    viz.querySelectorAll('svg[aria-hidden]').forEach(v => v.removeAttribute('aria-hidden'));
  } else if (label) viz.setAttribute('role', 'img');
  else viz.removeAttribute('role');
}

function legendNode(items) {
  return h('div', { class: 'legend', role: 'list' }, items.map(it =>
    h('span', { class: 'lg', role: 'listitem' },
      h('i', { class: it.type || '', style: it.type === 'ring' ? { color: it.color } : { background: it.color, ...(it.border ? { outline: '1px solid var(--axis)', outlineOffset: '-1px' } : {}) } }), it.label)));
}

function segmented(label, opts, value, onChange) {
  const btns = opts.map(([v, text]) => h('button', {
    type: 'button', 'aria-pressed': String(v === value),
    onclick: () => { btns.forEach((b, i) => b.setAttribute('aria-pressed', String(opts[i][0] === v))); onChange(v); },
  }, text));
  return h('div', { class: 'seg', role: 'group', 'aria-label': label }, btns);
}
function selectField(label, opts, value, onChange) {
  const sel = h('select', { class: 'field', onchange: e => onChange(e.target.value) },
    opts.map(([v, text]) => h('option', { value: v, ...(String(v) === String(value) ? { selected: true } : {}) }, text)));
  return h('label', null, label, sel);
}

function tableNode({ head, rows, align = [] }) {
  return h('table', null,
    h('thead', null, h('tr', null, head.map((t, i) => h('th', { class: align[i] === 'n' ? 'n' : '', scope: 'col' }, t)))),
    h('tbody', null, rows.map(r => h('tr', null, r.map((c, i) => h('td', { class: align[i] === 'n' ? 'n' : '' }, c))))));
}

function buildNotes(o) {
  const n = o.notes || {}, cat = o.cat || 'mochi';
  const dd = { what: h('dd'), how: h('dd'), shows: h('dd'), watch: h('dd') };
  const note = (key, label, cls) => (n[key] != null || key === 'shows') && h('dl', { class: 'note ' + (cls || '') },
    h('dt', null, pawSvg(), label), dd[key]);
  const nerdP = h('p');
  const nerd = n.nerd && h('details', { class: 'nerd' },
    h('summary', null, catSvg('pearl'), `Pearl's nerd corner: ${n.nerd.title}`), nerdP);
  const el = h('div', { class: 'notes', role: 'group', 'aria-label': 'About this chart' },
    h('div', { class: 'bubble' },
      h('div', { class: 'sayer' }, catSvg(cat), cat === 'pearl' ? 'Pearl says' : 'Mochi says'),
      note('what', 'What it is'), note('how', 'How to read it'), note('shows', 'What it shows here', 'shows'),
      n.watch != null && note('watch', 'Watch out', 'watch'), nerd));
  const val = v => typeof v === 'function' ? v() : v;
  return {
    el,
    update() {
      for (const k of Object.keys(dd)) { clear(dd[k]); if (n[k] != null) dd[k].appendChild(rich(val(n[k]))); }
      if (n.nerd) clear(nerdP).appendChild(rich(val(n.nerd.text)));
    },
  };
}

/* The card every chart lives in. draw(host, width, api) paints into host; table() returns the twin. */
function card(o) {
  let view = 'chart';
  const titleEl = h('h3'), subEl = h('p', { class: 'sub' }), legendHost = h('div');
  const viz = h('div', { class: 'viz' });
  const tableHost = h('div', { class: 'tablewrap', hidden: true });
  const viewBtn = o.noTable ? null : h('button', { type: 'button', class: 'viewbtn', 'aria-expanded': 'false' }, 'View as table');
  const notes = buildNotes(o);
  const footNote = o.foot ? h('span', { class: 'foot-note' }) : null;
  const ctrl = o.controls && o.controls.length ? h('div', { class: 'controls' }, o.controls) : null;
  const el = h('article', { class: 'card' + (o.stack ? ' stack' : '') + (o.plain ? ' plain' : ''), id: o.id },
    h('header', { class: 'card-head' }, h('span', { class: 'kicker' }, o.kicker), titleEl, subEl),
    h('div', { class: 'card-main' }, ctrl, legendHost, viz, tableHost, h('div', { class: 'card-foot' }, viewBtn, footNote)),
    notes.el);

  const api = {
    el, viz, redraw, view: currentBuild,
    label: t => viz.setAttribute('aria-label', t),
  };
  function redraw() {
    tip.hide();
    const val = v => typeof v === 'function' ? v() : v;
    titleEl.textContent = val(o.title) || '';
    subEl.textContent = val(o.sub) || ''; subEl.hidden = !subEl.textContent;
    clear(legendHost);
    const items = o.legend && o.legend();
    if (items && items.length) legendHost.appendChild(legendNode(items));
    if (footNote) footNote.textContent = val(o.foot) || '';
    notes.update();
    notes.el.setAttribute('aria-label', `About this chart: ${titleEl.textContent}`);
    if (view === 'table') {
      clear(tableHost).appendChild(tableNode(o.table()));
      return;
    }
    const w = Math.round(viz.clientWidth);
    if (!w) return;                                   // hidden or not laid out yet
    clear(viz);
    o.draw(viz, w, api);
    settleRole(viz);
  }
  if (viewBtn) viewBtn.addEventListener('click', () => {
    view = view === 'chart' ? 'table' : 'chart';
    viz.hidden = view === 'table'; tableHost.hidden = view === 'chart';
    viewBtn.textContent = view === 'table' ? 'View as chart' : 'View as table';
    viewBtn.setAttribute('aria-expanded', String(view === 'table'));
    redraw();
  });
  watchWidth(viz, () => redraw());
  registry.push(api);
  return api;
}

/* A light panel (no notes bubble) for the county explorer */
function miniCard({ title, sub, draw, label }) {
  const viz = h('div', { class: 'viz' });
  const el = h('div', { class: 'xcard' }, h('h3', null, title), sub ? h('p', { class: 'sub' }, sub) : null, viz);
  const api = {
    el, viz, dead: false, view: currentBuild,
    redraw() { tip.hide(); const w = Math.round(viz.clientWidth); if (!w) return; clear(viz); draw(viz, w, { label: t => viz.setAttribute('aria-label', t) }); settleRole(viz); },
  };
  watchWidth(viz, () => api.redraw());
  registry.push(api);
  return api;
}

/* Section scaffolding */
function chapter(id, num, title, lead, children) {
  const t = h('h2', { id: id + '-h' }), p = lead ? h('p') : null;
  live(t, () => typeof title === 'function' ? title() : title);
  if (p) live(p, () => typeof lead === 'function' ? lead() : lead);
  return h('section', { class: 'chapter', id, 'aria-labelledby': id + '-h' },
    h('div', { class: 'chapter-head' }, h('span', { class: 'badge', 'aria-hidden': 'true' }, num), h('div', null, t, p)),
    h('div', { class: 'cards' }, children));
}

/* Empty state: a sleepy cat */
function emptyState(text) {
  return h('div', { class: 'empty-state' }, catSvg('mochi'), text);
}
