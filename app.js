const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
const labelsOf = (fs) => Object.fromEntries([...$(fs).querySelectorAll('input')].map((i) => [i.value, i.parentNode.textContent.trim()]));
const SEVERITY = labelsOf('f-sev');
const TYPES = labelsOf('f-type');
const mobile = window.matchMedia('(max-width: 700px)');

// Incident extent, fixed so the first tile requests are the final view. Pad for the floating desktop panel.
const BOUNDS = [[43.2, -4.6], [50.7, 7.8]];
const map = L.map('map', { zoomControl: false, maxZoom: 18 })
  .fitBounds(BOUNDS, mobile.matches ? { padding: [12, 12] } : { paddingTopLeft: [400, 20], paddingBottomRight: [20, 20] });
L.control.zoom({ position: 'topright' }).addTo(map);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
let theme;
function setTheme(t, save) {
  theme = t;
  document.documentElement.dataset.theme = t;
  $('theme').setAttribute('aria-pressed', String(t === 'dark'));
  if (save) localStorage.setItem('fpm-theme', t);
}
setTheme(localStorage.getItem('fpm-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('theme').addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark', true));

const legend = L.control({ position: 'bottomright' });
legend.onAdd = () => {
  const d = el('details', { className: 'legend', open: !mobile.matches }, el('summary', {}, 'Legend'));
  Object.entries(SEVERITY).forEach(([i, label]) => d.append(el('span', { className: `sw sev-${i}` }), label, el('br')));
  d.append(el('span', { className: 'sw hollow' }), 'City-centre only',
    el('small', {}, 'Hollow dashed pins are placed at the city centre only; the exact location is unknown.'),
    el('small', {}, el('span', { className: 'sw cl sev-4' }), 'Numbered circles group nearby incidents, coloured by the most severe one. Select to zoom in.'));
  L.DomEvent.disableClickPropagation(d);
  return d;
};
legend.addTo(map);

let clusters;
const makeClusters = () => L.markerClusterGroup({
  maxClusterRadius: (z) => (z < 13 ? 50 : 20),
  showCoverageOnHover: false,
  chunkedLoading: true,
  iconCreateFunction(c) {
    const kids = c.getAllChildMarkers();
    const max = Math.max(...kids.map((m) => m.options.sev));
    const size = kids.length < 10 ? 30 : kids.length < 50 ? 36 : 44;
    return L.divIcon({ html: String(kids.length), className: `cluster sev-${max}`, iconSize: [size, size] });
  },
}).addTo(map);

let incidents = [];
const state = { sev: new Set(), types: new Set(), city: '', from: '', to: '' };

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
  if (/^https?:\/\//i.test(d.source_url || '')) {
    root.append(p(el('strong', {}, 'Source: '), el('a', { href: d.source_url, target: '_blank', rel: 'noopener noreferrer' }, d.source_name || 'Source')));
  } else if (d.source_name) {
    root.append(p(el('strong', {}, 'Source: '), d.source_name));
  }
  return root;
}

function marker(d) {
  const hollow = d.geocode_precision === 'city';
  const s = hollow ? 16 : 14;
  const icon = L.divIcon({ className: `pin sev-${d.severity}${hollow ? ' hollow' : ''}`, iconSize: [s, s] });
  return L.marker([d.lat, d.lon], { icon, sev: d.severity, title: `${d.city}: ${TYPES[d.type] || d.type}, ${SEVERITY[d.severity]}` })
    .bindPopup(() => popup(d), { maxWidth: 300 });
}

const datesOk = () => state.from <= state.to;
const matches = (d, ignoreCity) => state.sev.has(d.severity) && state.types.has(d.type)
  && (ignoreCity || !state.city || d.city === state.city)
  && d.date >= state.from && d.date <= state.to;

function render() {
  const bad = !datesOk();
  $('date-warn').hidden = !bad;
  $('date-warn').textContent = bad ? `"From" (${state.from}) is after "To" (${state.to}), so no incidents match. Change either date or reset filters.` : '';
  for (const id of ['f-from', 'f-to']) $(id).setAttribute('aria-invalid', String(bad));

  const shown = incidents.filter((d) => matches(d));
  clusters.clearLayers();
  clusters.addLayers(shown.map((d) => d._marker));
  $('count').textContent = `Showing ${shown.length} of ${incidents.length} incidents`;
  renderTop();
}

function renderTop() {
  const by = new Map();
  incidents.forEach((d) => {
    if (!matches(d, true)) return;
    const sev = by.get(d.city) || [0, 0, 0, 0, 0, 0];
    sev[d.severity]++;
    by.set(d.city, sev);
  });
  const total = (s) => s.reduce((a, b) => a + b, 0);
  const top = [...by].map(([city, sev]) => ({ city, sev, n: total(sev) })).sort((a, b) => b.n - a.n || a.city.localeCompare(b.city, 'fr')).slice(0, 8);
  $('top-list').replaceChildren(...top.map(({ city, sev, n }) => {
    const stack = el('span', { className: 'stack' });
    stack.style.width = `${(100 * n) / top[0].n}%`;
    sev.forEach((k, i) => { if (k) { const s = el('span', { className: `sev-${i}` }); s.style.flex = k; stack.append(s); } });
    stack.setAttribute('aria-hidden', 'true');
    const b = el('button', { type: 'button' }, el('span', {}, city), el('span', {}, String(n)), stack);
    b.setAttribute('aria-pressed', String(state.city === city));
    b.setAttribute('aria-label', `${city}: ${n} incidents`);
    b.addEventListener('click', () => { $('f-city').value = state.city = state.city === city ? '' : city; render(); });
    return el('li', {}, b);
  }));
}

function setup(data) {
  incidents = data;
  incidents.forEach((d) => { d._marker = marker(d); });
  const dates = incidents.map((d) => d.date).sort();
  const [min, max] = [dates[0], dates[dates.length - 1]];

  const boxes = [...document.querySelectorAll('#filters input[type=checkbox]')];
  boxes.forEach((cb) => {
    const [set, value] = cb.closest('#f-sev') ? [state.sev, Number(cb.value)] : [state.types, cb.value];
    cb.addEventListener('change', () => { cb.checked ? set.add(value) : set.delete(value); render(); });
  });
  const cities = [...new Set(incidents.map((d) => d.city))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('f-city').append(...cities.map((c) => el('option', { value: c }, c)));
  for (const id of ['f-from', 'f-to']) { $(id).min = min; $(id).max = max; }

  const reset = () => {
    boxes.forEach((b) => { b.checked = true; });
    Object.keys(SEVERITY).forEach((i) => state.sev.add(Number(i)));
    Object.keys(TYPES).forEach((k) => state.types.add(k));
    $('f-city').value = state.city = '';
    $('f-from').value = state.from = min;
    $('f-to').value = state.to = max;
    render();
  };
  $('f-city').addEventListener('change', (e) => { state.city = e.target.value; render(); });
  $('f-from').addEventListener('change', (e) => { state.from = e.target.value || min; render(); });
  $('f-to').addEventListener('change', (e) => { state.to = e.target.value || max; render(); });
  $('reset').addEventListener('click', reset);
  reset();
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
