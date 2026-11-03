/* ---------- core: DOM, formatting, math, scales, color, theme, tooltip ---------- */
const D = window.__DATA__;
const NS = 'http://www.w3.org/2000/svg';
const root = document.documentElement;

/* DOM builders. Text always goes through textContent / text nodes: labels come from data files. */
function setAttrs(el, props) {
  for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
}
function addKids(el, k) {
  if (k == null || k === false) return;
  if (Array.isArray(k)) k.forEach(x => addKids(el, x));
  else el.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
}
const h = (tag, props, ...kids) => { const el = document.createElement(tag); if (props) setAttrs(el, props); addKids(el, kids); return el; };
const s = (tag, props, ...kids) => { const el = document.createElementNS(NS, tag); if (props) setAttrs(el, props); addKids(el, kids); return el; };
const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
const $ = (sel, r = document) => r.querySelector(sel);
const use = (id, props) => s('use', { href: '#' + id, ...props });

/* **bold** inside a string becomes <strong>; everything else stays text */
function rich(str) {
  const f = document.createDocumentFragment();
  String(str).split('**').forEach((part, i) => { if (part) f.appendChild(i % 2 ? h('strong', null, part) : document.createTextNode(part)); });
  return f;
}

/* ---------- formatting ---------- */
const fInt = n => Math.round(n).toLocaleString('en-US');
const fPct = (n, d = 1) => `${n.toFixed(d)}%`;
const fPts = (n, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`;
const fComp = n => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
};
const fMil = n => `${(n / 1e6).toFixed(1)}M`;
const plural = (n, one, many) => `${fInt(n)} ${n === 1 ? one : (many || one + 's')}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dcache = {};
function dinfo(iso) {
  if (dcache[iso]) return dcache[iso];
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dcache[iso] = { iso, y, m, d, dow: dt.getUTCDay(), ms: dt.getTime(), wd: WD[dt.getUTCDay()],
    short: `${MON[m - 1]} ${d}`, long: `${WD[dt.getUTCDay()]}, ${MON[m - 1]} ${d}` };
}
const addDays = (iso, n) => new Date(dinfo(iso).ms + n * 864e5).toISOString().slice(0, 10);
const smallWords = new Set(['of', 'the', 'and', 'at', 'for']);
const keepCaps = new Set(['BC', 'SOE', 'ESC', 'JM', 'MLK', 'NW', 'SW', 'NE', 'SE', 'II', 'III', 'FT.', 'FL', 'USF', 'UCF', 'FAU', 'FIU']);
function niceName(n) {                                  // Broward sends ALL CAPS
  if (n !== n.toUpperCase()) return n;
  return n.toLowerCase().replace(/[a-z][a-z.']*/g, (w, i) => {
    const up = w.toUpperCase();
    if (keepCaps.has(up)) return up;
    return i > 0 && smallWords.has(w) ? w : w[0].toUpperCase() + w.slice(1);
  });
}

/* ---------- math ---------- */
const sum = a => { let t = 0; for (const x of a) t += x; return t; };
const mean = a => sum(a) / a.length;
const sorted = a => Float64Array.from(a).sort();
const quantile = (srt, q) => {
  const pos = (srt.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return srt[lo] + (srt[hi] - srt[lo]) * (pos - lo);
};
const median = a => quantile(sorted(a), .5);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function linfit(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const slope = sxy / sxx, r = sxy / Math.sqrt(sxx * syy);
  return { slope, intercept: my - slope * mx, r, r2: r * r };
}

/* ---------- scales and ticks ---------- */
function linear(d0, d1, r0, r1) {
  const k = (r1 - r0) / (d1 - d0), f = v => r0 + (v - d0) * k;
  f.inv = p => d0 + (p - r0) / k;
  return f;
}
function logScale(d0, d1, r0, r1) {
  const a = Math.log(d0), k = (r1 - r0) / (Math.log(d1) - a), f = v => r0 + (Math.log(v) - a) * k;
  f.inv = p => Math.exp(a + (p - r0) / k);
  return f;
}
function niceTicks(max, count = 5, min = 0) {           // returns {ticks, max}
  const raw = (max - min) / count, pow = 10 ** Math.floor(Math.log10(raw || 1)), f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const top = Math.ceil(max / step - 1e-9) * step, ticks = [];
  for (let v = Math.floor(min / step) * step; v <= top + 1e-9; v += step) ticks.push(+v.toFixed(10));
  return { ticks, max: top, step };
}

/* ---------- color: OKLab mixing for ramps, contrast for labels ---------- */
const hex2rgb = hx => { let t = hx.trim().replace('#', ''); if (t.length === 3) t = [...t].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(t.slice(i, i + 2), 16)); };
const lin = c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const enc = c => { c = clamp(c, 0, 1); return 255 * (c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055); };
function toLab(hx) {
  const [r, g, b] = hex2rgb(hx).map(lin);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const q = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * q, 1.9779984951 * l - 2.428592205 * m + .4505937099 * q, .0259040371 * l + .7827717662 * m - .808675766 * q];
}
function fromLab([L, a, b]) {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, q = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + .2309699292 * q, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * q, -.0041960863 * l - .7034186147 * m + 1.707614701 * q];
  return '#' + rgb.map(v => Math.round(enc(v)).toString(16).padStart(2, '0')).join('');
}
const mix = (a, b, t) => { const A = toLab(a), B = toLab(b); return fromLab(A.map((v, i) => v + (B[i] - v) * t)); };
function ramp(stops) {                                  // t in [0,1] -> hex, piecewise through the stops
  const labs = stops.map(toLab), n = stops.length - 1;
  return t => {
    const x = clamp(t, 0, 1) * n, i = Math.min(Math.floor(x), n - 1), f = x - i;
    return fromLab(labs[i].map((v, k) => v + (labs[i + 1][k] - v) * f));
  };
}
const relLum = hx => { const [r, g, b] = hex2rgb(hx).map(lin); return .2126 * r + .7152 * g + .0722 * b; };
const contrastOf = (a, b) => { const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); };
const onFill = (fill, light = '#ffffff', dark = '#1f1629') => contrastOf(light, fill) >= contrastOf(dark, fill) ? light : dark;
/* class suffix for an in-bar label: dark ink on light fills (yellow, and every data color in dark mode), white otherwise */
const labelInk = color => { const c = String(color), hex = c.startsWith('var(') ? css(c.slice(4, -1)) : c; return /^#[0-9a-f]{6}$/i.test(hex) && onFill(hex) !== '#ffffff' ? ' dark' : ''; };

/* ---------- theme ---------- */
let cssCache = null;
const css = name => (cssCache ??= getComputedStyle(root)).getPropertyValue(name).trim();
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const mode = () => root.dataset.theme || (prefersDark.matches ? 'dark' : 'light');
function applyMode() {
  root.dataset.mode = mode(); cssCache = null;
  const b = $('#themebtn'); if (b) b.setAttribute('aria-pressed', String(mode() === 'dark'));
}
const deepWord = () => mode() === 'dark' ? 'lighter' : 'darker';   // the sequential ramp flips in dark mode
const seqStops = () => [1, 2, 3, 4, 5].map(i => css('--seq-' + i));
const tierColors = () => [1, 2, 3, 4].map(i => css('--tier-' + i));

/* ---------- measuring text (for "does this label fit?") ---------- */
const mctx = document.createElement('canvas').getContext('2d');
function textW(str, px = 12, weight = 700) { mctx.font = `${weight} ${px}px Nunito, system-ui, sans-serif`; return mctx.measureText(str).width; }
function fitText(str, px, weight, maxW) {               // ellipsize to a pixel width
  if (textW(str, px, weight) <= maxW) return str;
  let lo = 0, hi = str.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (textW(str.slice(0, mid) + '…', px, weight) <= maxW) lo = mid; else hi = mid - 1; }
  return str.slice(0, lo).trimEnd() + '…';
}

/* ---------- tooltip: one shared element; values lead, labels follow ---------- */
const tipEl = $('#tip');
let tipTimer = 0;
function tipContent(head, rows, foot) {
  const f = document.createDocumentFragment();
  if (head) f.appendChild(h('div', { class: 'th' }, head));
  (rows || []).forEach(r => f.appendChild(h('div', { class: 'tr' },
    h('span', null, r.color ? h('i', { class: 'k', style: { background: r.color } }) : null, r.label),
    h('b', null, r.value))));
  (Array.isArray(foot) ? foot : foot ? [foot] : []).forEach(t => f.appendChild(h('div', { class: 'tl' }, t)));
  return f;
}
function placeTip(x, y) {
  const r = tipEl.getBoundingClientRect(), pad = 16;
  let left = x + pad, top = y + pad;
  if (left + r.width > innerWidth - 8) left = x - r.width - pad;
  if (top + r.height > innerHeight - 8) top = y - r.height - pad;
  tipEl.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
}
const tip = {
  show(e, content) { clearTimeout(tipTimer); clear(tipEl).appendChild(content); tipEl.classList.add('on'); placeTip(e.clientX, e.clientY); },
  move(e) { if (tipEl.classList.contains('on')) placeTip(e.clientX, e.clientY); },
  hide(delay = 0) { clearTimeout(tipTimer); tipTimer = setTimeout(() => tipEl.classList.remove('on'), delay); },
};
/* Hover + keyboard focus + touch for any mark. getContent runs lazily. */
function hover(node, getContent, extra = {}) {         // getContent may be null when extra.move draws its own tooltip
  node.addEventListener('pointerenter', e => { if (getContent) tip.show(e, getContent(e)); extra.enter && extra.enter(e); });
  node.addEventListener('pointermove', e => { tip.move(e); extra.move && extra.move(e); });
  node.addEventListener('pointerleave', e => { tip.hide(e.pointerType === 'touch' ? 2200 : 0); extra.leave && extra.leave(e); });
  if (getContent) {
    node.addEventListener('focus', () => { const r = node.getBoundingClientRect(); tip.show({ clientX: r.left + r.width / 2, clientY: r.top }, getContent()); });
    node.addEventListener('blur', () => tip.hide());
  }
  return node;
}
addEventListener('scroll', () => tip.hide(), { passive: true });

/* ---------- redraw when the box width changes ---------- */
function watchWidth(el, cb) {
  let last = 0, raf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { const w = Math.round(el.clientWidth); if (w && Math.abs(w - last) >= 1) { last = w; cb(w); } });
  });
  ro.observe(el);
  return { force() { last = 0; cb(Math.round(el.clientWidth)); } };
}
