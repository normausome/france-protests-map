const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
const labelsOf = (fs) => Object.fromEntries([...$(fs).querySelectorAll('input')].map((i) => [i.value, i.parentNode.textContent.trim()]));
const SEVERITY = labelsOf('f-sev');
const TYPES = labelsOf('f-type');
const SEV_IDS = Object.keys(SEVERITY).map(Number);
const mobile = window.matchMedia('(max-width: 700px)');
// Strip accents and case so "Republique" finds "République".
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtDay = (d, long) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: long ? 'long' : 'short', ...(long ? { weekday: 'short', year: 'numeric' } : {}) });

// Filters and view live in the URL hash (#city=Paris&from=2026-10-17&map=lat,lon,zoom) so a link reproduces what you see.
const hashParams = () => new URLSearchParams(location.hash.replace(/^#\/?/, ''));
const viewFromHash = (p) => {
  const v = (p.get('map') || '').split(',').map(Number);
  return v.length === 3 && v.every(Number.isFinite) && Math.abs(v[0]) <= 85 && Math.abs(v[1]) <= 180 && v[2] >= 3 && v[2] <= 18 ? v : null;
};

// Incident extent, fixed so the first tile requests are the final view. Pad for the floating desktop panel.
const BOUNDS = [[43.2, -4.6], [50.7, 7.8]];
const map = L.map('map', { zoomControl: false, maxZoom: 18 });
const startView = viewFromHash(hashParams());
if (startView) map.setView([startView[0], startView[1]], startView[2]);
else map.fitBounds(BOUNDS, mobile.matches ? { padding: [12, 12] } : { paddingTopLeft: [400, 20], paddingBottomRight: [20, 20] });
L.control.zoom({ position: 'topright' }).addTo(map);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
let theme;
function setTheme(t, save) {
  theme = t;
  document.documentElement.dataset.theme = t;
  const tb = $('theme');
  if (tb) { tb.textContent = t === 'dark' ? 'Light map' : 'Dark map'; tb.setAttribute('aria-label', t === 'dark' ? 'Switch to light map' : 'Switch to dark map'); }
  if (save) try { localStorage.setItem('fpm-theme', t); } catch {}
}
const saved = (() => { try { return localStorage.getItem('fpm-theme'); } catch { return null; } })();
setTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('theme')?.addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark', true));
$('skip')?.addEventListener('click', (e) => { e.preventDefault(); map.getContainer().focus(); });

const legend = L.control({ position: 'bottomright' });
legend.onAdd = () => {
  const d = el('details', { className: 'legend', open: !mobile.matches }, el('summary', {}, 'Legend'));
  Object.entries(SEVERITY).forEach(([i, label]) => d.append(el('span', { className: `sw sev-${i}` }), label, el('br')));
  d.append(el('span', { className: 'sw hollow' }), 'City-centre only',
    el('small', {}, 'Hollow dashed pins are placed at the city centre only; the exact location is unknown.'),
    el('small', {}, el('span', { className: 'sw cl sev-4' }), 'Numbered circles group nearby incidents, coloured by the most severe one. Select to zoom in, or to fan out pins that share one spot.'));
  L.DomEvent.disableClickPropagation(d);
  return d;
};
legend.addTo(map);

const sevCounts = (list) => list.reduce((acc, d) => { acc[d.severity ?? d.options?.sev]++; return acc; }, [0, 0, 0, 0, 0, 0]);
const total = (s) => s.reduce((a, b) => a + b, 0);
const describe = (counts) => counts.map((k, i) => (k ? `${k} ${SEVERITY[i].replace(/^\d /, '').toLowerCase()}` : '')).filter(Boolean).join(', ');

let clusters;
const makeClusters = () => L.markerClusterGroup({
  maxClusterRadius: (z) => (z < 13 ? 50 : 20),
  showCoverageOnHover: false,
  chunkedLoading: true,
  zoomToBoundsOnClick: false, // handled below: fan out pins that share one spot instead of zooming to street level first
  spiderfyDistanceMultiplier: 1.6,
  spiderLegPolylineOptions: { weight: 2, opacity: 0.7, className: 'spider-leg' },
  iconCreateFunction(c) {
    const kids = c.getAllChildMarkers();
    const counts = sevCounts(kids);
    const max = Math.max(...kids.map((m) => m.options.sev));
    const size = kids.length < 10 ? 30 : kids.length < 50 ? 36 : 44;
    const cities = new Map();
    kids.forEach((m) => cities.set(m.options.city, (cities.get(m.options.city) || 0) + 1));
    const [city] = [...cities].sort((a, b) => b[1] - a[1])[0];
    const where = cities.size > 1 ? `${city} and ${cities.size - 1} other ${cities.size > 2 ? 'cities' : 'city'}` : city;
    // Leaflet copies options.title onto the icon after createIcon, so the cluster gets a tooltip; the visually hidden text is its accessible name.
    c.options.title = `${kids.length} incidents, ${where}: ${describe(counts)}`;
    const html = el('span', {}, String(kids.length), el('span', { className: 'vh' }, ` incidents, ${where}, most severe: ${SEVERITY[max]}. Select to zoom in or fan out.`));
    return L.divIcon({ html, className: `cluster sev-${max}`, iconSize: [size, size] });
  },
}).addTo(map);
// Pins that would not separate before street level (zoom 16) fan out there in one click, instead of zooming to 18 and needing a second click.
const STREET = 16;
function onCluster(e) {
  if (e.type === 'clusterkeypress' && e.originalEvent?.key !== 'Enter') return;
  const c = e.layer;
  const b = c.getBounds();
  const diag = map.project(b.getNorthEast(), STREET).distanceTo(map.project(b.getSouthWest(), STREET));
  if (diag > 40 && map.getBoundsZoom(b) <= STREET) { c.zoomToBounds({ padding: [40, 40] }); return; }
  if (map.getZoom() >= STREET) { c.spiderfy(); return; }
  const kids = c.getAllChildMarkers();
  let done = false;
  let tries = 0;
  const fan = () => {
    if (done) return;
    if (clusters._inZoomAnimation && tries++ < 10) { setTimeout(fan, 150); return; } // spiderfy is a no-op mid-animation
    done = true;
    // At street level the cluster may split; fan out the biggest remaining group, which is the one that will not separate.
    let best = null;
    kids.forEach((m) => {
      let p = m.__parent;
      while (p && !p._icon && p.__parent) p = p.__parent;
      if (p && p._icon && (!best || p.getChildCount() > best.getChildCount())) best = p;
    });
    if (best) best.spiderfy();
  };
  clusters.once('animationend', fan);
  map.once('moveend', () => setTimeout(fan, 400));
  map.setView(c.getLatLng(), STREET);
}

let incidents = [];
let shown = [];
const state = { sev: new Set(), types: new Set(), city: '', from: '', to: '', q: '' };
const range = { min: '', max: '' };
let days = [];
let cities = [];
let ready = false;
let viewInHash = Boolean(startView);

function popup(d) {
  const p = (...kids) => el('p', {}, ...kids);
  const root = el('div', { className: 'popup' },
    el('div', { className: 'meta' },
      el('span', { className: `chip sev-${d.severity}` }, SEVERITY[d.severity]),
      el('span', {}, TYPES[d.type] || d.type), el('span', {}, d.date + (d.time ? ` ${d.time}` : ''))),
    el('h3', {}, d.city));
  if (d.location) root.append(el('p', { className: 'loc' }, d.location));
  if (d.business_name || d.business_type) {
    root.append(p(el('strong', {}, 'Business: '), [d.business_name, d.business_type].filter(Boolean).join(' — ')));
  }
  root.append(p(d.description));
  if (d.corroboration) root.append(p(el('strong', {}, 'Corroboration: '), d.corroboration));
  if (d.geocode_precision === 'city') root.append(el('p', { className: 'approx' }, 'Approximate: city-centre location only'));
  root.append(sourceLine(d));
  return root;
}
function sourceLine(d) {
  if (/^https?:\/\//i.test(d.source_url || '')) {
    return el('p', {}, el('strong', {}, 'Source: '), el('a', { href: d.source_url, target: '_blank', rel: 'noopener noreferrer' }, d.source_name || 'Source'));
  }
  return el('p', {}, el('strong', {}, 'Source: '), d.source_name || 'not given');
}

function marker(d) {
  const hollow = d.geocode_precision === 'city';
  const s = hollow ? 16 : 14;
  const icon = L.divIcon({ className: `pin sev-${d.severity}${hollow ? ' hollow' : ''}`, iconSize: [s, s] });
  return L.marker([d.lat, d.lon], { icon, sev: d.severity, city: d.city, title: `${d.city}: ${TYPES[d.type] || d.type}, ${SEVERITY[d.severity]}` })
    .bindPopup(() => popup(d), { maxWidth: 300 });
}

const datesOk = () => state.from <= state.to;
let qTokens = [];
// skip: 'city' or 'date' leaves that filter out, for the Top cities and Timeline counts.
const matches = (d, skip) => state.sev.has(d.severity) && state.types.has(d.type)
  && (skip === 'city' || !state.city || d.city === state.city)
  && (skip === 'date' || (d.date >= state.from && d.date <= state.to))
  && qTokens.every((t) => d._text.includes(t));

function render() {
  if (!ready) return;
  qTokens = fold(state.q).split(/\s+/).filter(Boolean);
  const bad = !datesOk();
  const warn = $('date-warn') || {};
  warn.hidden = !bad;
  warn.textContent = bad ? `"From" (${state.from}) is after "To" (${state.to}), so no incidents match. Change either date or reset filters.` : '';
  for (const id of ['f-from', 'f-to']) $(id).setAttribute('aria-invalid', String(bad));

  shown = incidents.filter((d) => matches(d));
  clusters.clearLayers();
  clusters.addLayers(shown.map((d) => d._marker));
  $('count').textContent = `Showing ${shown.length} of ${incidents.length} incidents`;
  renderMix();
  renderTimeline();
  renderTop();
  renderList();
  writeHash();
}

function renderMix() {
  const counts = sevCounts(shown);
  const bar = $('mix-bar');
  bar.replaceChildren(...counts.flatMap((k, i) => { if (!k) return []; const s = el('span', { className: `sev-${i}` }); s.style.flex = k; return [s]; }));
  $('mix').replaceChildren(...counts.map((k, i) => el('li', { className: k ? '' : 'zero' },
    el('span', { className: `sw sev-${i}` }), el('strong', {}, String(k)), ` ${SEVERITY[i].replace(/^\d /, '')}`)));
  $('mix').setAttribute('aria-label', `Shown incidents by severity: ${describe(counts) || 'none'}`);
}

function renderTimeline() {
  const by = new Map(days.map((d) => [d, [0, 0, 0, 0, 0, 0]]));
  incidents.forEach((d) => { if (matches(d, 'date')) by.get(d.date)[d.severity]++; });
  const max = Math.max(1, ...[...by.values()].map(total));
  $('timeline').replaceChildren(...days.map((day) => {
    const counts = by.get(day);
    const n = total(counts);
    const solo = state.from === day && state.to === day;
    const bar = el('span', { className: 'tbar' });
    bar.style.height = `${n ? Math.max(3, (100 * n) / max) : 0}%`;
    counts.forEach((k, i) => { if (k) { const s = el('span', { className: `sev-${i}` }); s.style.flex = k; bar.append(s); } });
    const b = el('button', { type: 'button', className: day >= state.from && day <= state.to ? '' : 'out' },
      el('span', { className: 'n' }, String(n)), bar, el('span', { className: 'd' }, fmtDay(day)));
    b.setAttribute('aria-pressed', String(solo));
    b.setAttribute('aria-label', `${fmtDay(day, true)}: ${n} incidents${solo ? ' (only this day shown)' : ''}`);
    b.addEventListener('click', () => {
      state.from = solo ? range.min : day;
      state.to = solo ? range.max : day;
      $('f-from').value = state.from; $('f-to').value = state.to;
      render();
    });
    return el('li', {}, b);
  }));
}

function renderTop() {
  if (!$('top-list')) return;
  const by = new Map();
  incidents.forEach((d) => {
    if (!matches(d, 'city')) return;
    const sev = by.get(d.city) || [0, 0, 0, 0, 0, 0];
    sev[d.severity]++;
    by.set(d.city, sev);
  });
  const top = [...by].map(([city, sev]) => ({ city, sev, n: total(sev) })).sort((a, b) => b.n - a.n || a.city.localeCompare(b.city, 'fr')).slice(0, 8);
  $('top-list').replaceChildren(...top.map(({ city, sev, n }) => {
    const stack = el('span', { className: 'stack' });
    stack.style.width = `${(100 * n) / top[0].n}%`;
    sev.forEach((k, i) => { if (k) { const s = el('span', { className: `sev-${i}` }); s.style.flex = k; stack.append(s); } });
    stack.setAttribute('aria-hidden', 'true');
    const b = el('button', { type: 'button' }, el('span', {}, city), el('span', {}, String(n)), stack);
    b.setAttribute('aria-pressed', String(state.city === city));
    b.setAttribute('aria-label', `${city}: ${n} incidents, ${describe(sev)}`);
    b.addEventListener('click', () => { $('f-city').value = state.city = state.city === city ? '' : city; render(); });
    return el('li', {}, b);
  }));
}

// Plain list of the shown incidents: readable without the map (screen readers, print), and each row can open its pin.
function renderList() {
  $('list-n').textContent = `(${shown.length})`;
  const list = $('list');
  if (!$('list-sec').open) { list.replaceChildren(); return; }
  const items = [...shown].sort((a, b) => b.date.localeCompare(a.date) || a.city.localeCompare(b.city, 'fr') || b.severity - a.severity);
  list.replaceChildren(...items.map((d) => {
    const show = el('button', { type: 'button', className: 'small' }, 'Show on map');
    show.setAttribute('aria-label', `Show on map: ${d.city}, ${d.location || 'city centre'}`);
    show.addEventListener('click', () => showOnMap(d));
    const li = el('li', { className: 'item' },
      el('div', { className: 'meta' },
        el('span', { className: `chip sev-${d.severity}` }, SEVERITY[d.severity]),
        el('span', {}, TYPES[d.type] || d.type), el('span', {}, d.date + (d.time ? ` ${d.time}` : '')), show),
      el('h3', {}, d.city, d.location ? el('span', { className: 'loc' }, `, ${d.location}`) : ''));
    if (d.business_name || d.business_type) li.append(el('p', {}, el('strong', {}, 'Business: '), [d.business_name, d.business_type].filter(Boolean).join(' — ')));
    li.append(el('p', {}, d.description));
    if (d.geocode_precision === 'city') li.append(el('p', { className: 'approx' }, 'Approximate: city-centre location only'));
    li.append(sourceLine(d));
    return li;
  }));
}
function showOnMap(d) {
  if (mobile.matches && $('sidebar').classList.contains('open')) { $('sidebar').classList.remove('open'); syncToggle(); map.invalidateSize(); }
  clusters.zoomToShowLayer(d._marker, () => d._marker.openPopup());
}

let hashTimer;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const p = new URLSearchParams();
    if (SEV_IDS.some((i) => !state.sev.has(i))) p.set('sev', SEV_IDS.filter((i) => state.sev.has(i)).join(','));
    if (Object.keys(TYPES).some((k) => !state.types.has(k))) p.set('type', Object.keys(TYPES).filter((k) => state.types.has(k)).join(','));
    if (state.city) p.set('city', state.city);
    if (state.q) p.set('q', state.q);
    if (state.from !== range.min) p.set('from', state.from);
    if (state.to !== range.max) p.set('to', state.to);
    if (viewInHash) { const c = map.getCenter(); p.set('map', `${c.lat.toFixed(4)},${c.lng.toFixed(4)},${map.getZoom()}`); }
    const h = p.toString().replace(/%2C/g, ',');
    const url = h ? `#${h}` : location.pathname + location.search;
    if (location.hash !== (h ? `#${h}` : '')) try { history.replaceState(null, '', url); } catch {}
  }, 150);
}
function applyHash() {
  const p = hashParams();
  const list = (k) => (p.get(k) || '').split(',').filter(Boolean);
  setDefaults();
  const sev = list('sev').map(Number).filter((i) => i in SEVERITY);
  if (sev.length) { state.sev.clear(); sev.forEach((i) => state.sev.add(i)); }
  const types = list('type').filter((k) => k in TYPES);
  if (types.length) { state.types.clear(); types.forEach((k) => state.types.add(k)); }
  if (cities.includes(p.get('city'))) state.city = p.get('city');
  state.q = (p.get('q') || '').trim().slice(0, 100);
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (isDay(p.get('from'))) state.from = p.get('from');
  if (isDay(p.get('to'))) state.to = p.get('to');
  syncControls();
}
function setDefaults() {
  SEV_IDS.forEach((i) => state.sev.add(i));
  Object.keys(TYPES).forEach((k) => state.types.add(k));
  state.city = ''; state.q = ''; state.from = range.min; state.to = range.max;
}
function syncControls() {
  document.querySelectorAll('#filters input[type=checkbox]').forEach((cb) => {
    cb.checked = cb.closest('#f-sev') ? state.sev.has(Number(cb.value)) : state.types.has(cb.value);
  });
  $('f-city').value = state.city;
  $('f-q').value = state.q;
  $('f-from').value = state.from;
  $('f-to').value = state.to;
}

let statusTimer;
function status(msg) {
  $('status').textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('status').textContent = ''; }, 8000);
}
async function copyLink() {
  viewInHash = true;
  writeHash();
  await new Promise((r) => setTimeout(r, 200));
  const url = location.href;
  const share = $('share');
  try {
    await navigator.clipboard.writeText(url);
    share.hidden = true;
    status('Link copied. It opens the map with these filters and this view.');
  } catch {
    share.hidden = false; share.value = url; share.select();
    status('Copy the link from the box below. It opens the map with these filters and this view.');
  }
}
const CSV_COLS = ['id', 'date', 'time', 'city', 'location', 'lat', 'lon', 'geocode_precision', 'type', 'severity', 'business_name', 'business_type', 'description', 'corroboration', 'source_name', 'source_url'];
function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheets from treating text as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv() {
  const rows = [CSV_COLS.join(','), ...shown.map((d) => CSV_COLS.map((c) => csvCell(d[c])).join(','))];
  const blob = new Blob([`﻿${rows.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `france-incidents-${shown.length}-of-${incidents.length}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  status(`Exported ${shown.length} incidents as CSV (sources included).`);
}

function setup(data) {
  incidents = data;
  incidents.forEach((d) => {
    d._marker = marker(d);
    d._text = fold([d.city, d.location, d.business_name, d.business_type, d.description, TYPES[d.type], d.source_name, d.date].join(' '));
  });
  days = [...new Set(incidents.map((d) => d.date))].sort();
  [range.min, range.max] = [days[0], days[days.length - 1]];
  cities = [...new Set(incidents.map((d) => d.city))].sort((a, b) => a.localeCompare(b, 'fr'));

  document.querySelectorAll('#filters input[type=checkbox]').forEach((cb) => {
    const [set, value] = cb.closest('#f-sev') ? [state.sev, Number(cb.value)] : [state.types, cb.value];
    cb.addEventListener('change', () => { cb.checked ? set.add(value) : set.delete(value); render(); });
  });
  $('f-city').append(...cities.map((c) => el('option', { value: c }, c)));
  for (const id of ['f-from', 'f-to']) { $(id).min = range.min; $(id).max = range.max; }

  $('f-city').addEventListener('change', (e) => { state.city = e.target.value; render(); });
  $('f-from').addEventListener('change', (e) => { state.from = e.target.value || range.min; render(); });
  $('f-to').addEventListener('change', (e) => { state.to = e.target.value || range.max; render(); });
  let qTimer;
  const onQ = (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { if (state.q !== e.target.value.trim()) { state.q = e.target.value.trim(); render(); } }, 120); };
  $('f-q').addEventListener('input', onQ);
  $('f-q').addEventListener('search', onQ);
  $('reset').addEventListener('click', () => { setDefaults(); syncControls(); $('share').hidden = true; render(); });
  $('copy').addEventListener('click', copyLink);
  $('export').addEventListener('click', exportCsv);
  $('print').addEventListener('click', () => window.print());
  $('list-sec').addEventListener('toggle', renderList);
  let listWasOpen;
  window.addEventListener('beforeprint', () => {
    listWasOpen = $('list-sec').open;
    $('print-note').textContent = `Printed ${new Date().toISOString().slice(0, 10)} from ${location.href}`;
    if (!listWasOpen) { $('list-sec').open = true; renderList(); }
  });
  window.addEventListener('afterprint', () => { if (!listWasOpen) { $('list-sec').open = false; renderList(); } });
  window.addEventListener('hashchange', () => {
    const v = viewFromHash(hashParams());
    if (v) { viewInHash = true; map.setView([v[0], v[1]], v[2]); }
    applyHash();
    render();
  });
  map.on('moveend', () => { if (ready) { viewInHash = true; writeHash(); } });
  clusters.on('clusterclick clusterkeypress', onCluster);

  ready = true;
  applyHash();
  render();
}

// CSS decides the default (open on desktop, closed on phones); JS only flips it and mirrors aria-expanded.
const syncToggle = () => $('toggle').setAttribute('aria-expanded', String($('panel').offsetParent !== null));
$('toggle').addEventListener('click', () => {
  $('sidebar').classList.toggle(mobile.matches ? 'open' : 'collapsed');
  syncToggle();
  map.invalidateSize();
});
syncToggle();

// markercluster is not needed for the first tiles, so it loads (preloaded in <head>) after the map exists.
const clusterLib = new Promise((resolve, reject) => {
  document.head.append(el('script', { src: 'vendor/markercluster-1.5.3/leaflet.markercluster.js', onload: resolve, onerror: () => reject(new Error('markercluster')) }));
});
Promise.all([
  fetch('data/incidents.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
  clusterLib,
])
  .then(([data]) => { clusters = makeClusters(); setup(data); })
  .catch((e) => { $('count').textContent = `Could not load data (${e.message}). Serve over HTTP, not file://.`; });
