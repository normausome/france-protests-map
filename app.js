const SEVERITY = [
  { label: 'Gathering', color: '#ffe066' },
  { label: 'Vandalism', color: '#fdb53a' },
  { label: 'Break-in', color: '#f48a1f' },
  { label: 'Looted', color: '#e04b1a' },
  { label: 'Partially burned', color: '#a3141b' },
  { label: 'Destroyed', color: '#220000' },
];
const TYPES = {
  looting: 'Looting',
  vandalism: 'Vandalism',
  break_in: 'Break-in',
  fire_business: 'Fire (business)',
  fire_vehicle: 'Fire (vehicle)',
  protest_gathering: 'Protest gathering',
  fire_building: 'Fire (building)',
};

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

const map = L.map('map').setView([46.6, 2.5], 6);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const legend = L.control({ position: 'bottomright' });
legend.onAdd = () => {
  const d = el('div', { className: 'legend' }, el('h3', {}, 'Severity'));
  SEVERITY.forEach((s, i) => {
    const sw = el('span', { className: 'sw' });
    sw.style.background = s.color;
    d.append(sw, `${i} ${s.label}`, el('br'));
  });
  d.append(el('span', { className: 'sw hollow' }), 'City-centre only',
    el('small', {}, 'Hollow dashed pins are placed at the city centre only; the exact location is unknown.'));
  return d;
};
legend.addTo(map);

const layer = L.layerGroup().addTo(map);
let incidents = [];
const state = { sev: new Set(), types: new Set(), city: '', from: '', to: '' };
let defaults;

function jitter(data) {
  const seen = new Map();
  data.forEach((d) => {
    const key = `${d.lat},${d.lon}`;
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    d._pos = [d.lat, d.lon];
    if (n > 0) {
      const a = n * 2.399963; // golden angle spiral, deterministic
      const r = 0.00012 * Math.sqrt(n);
      d._pos = [d.lat + r * Math.sin(a), d.lon + r * Math.cos(a) / Math.cos(d.lat * Math.PI / 180)];
    }
  });
}

function popup(d) {
  const sev = SEVERITY[d.severity];
  const root = el('div', { className: 'popup' }, el('h3', {}, d.city));
  const line = (...kids) => root.append(el('p', {}, ...kids));
  if (d.location) line(d.location);
  line(el('strong', {}, 'Date: '), d.date + (d.time ? ` (${d.time})` : ''));
  line(el('strong', {}, 'Type: '), TYPES[d.type] || d.type);
  line(el('strong', {}, 'Severity: '), `${d.severity} – ${sev.label}`);
  if (d.business_name || d.business_type) {
    line(el('strong', {}, 'Business: '), [d.business_name, d.business_type].filter(Boolean).join(' — '));
  }
  line(d.description);
  if (d.corroboration) line(el('strong', {}, 'Corroboration: '), d.corroboration);
  if (d.geocode_precision === 'city') root.append(el('p', { className: 'approx' }, 'Approximate: city-centre location only'));
  if (/^https?:\/\//i.test(d.source_url || '')) {
    const a = el('a', { href: d.source_url, target: '_blank', rel: 'noopener noreferrer' }, d.source_name || 'Source');
    line(el('strong', {}, 'Source: '), a);
  } else if (d.source_name) {
    line(el('strong', {}, 'Source: '), d.source_name);
  }
  return root;
}

function marker(d) {
  const color = SEVERITY[d.severity].color;
  const hollow = d.geocode_precision === 'city';
  const opts = hollow
    ? { radius: 8, color, weight: 2, dashArray: '3 3', fillColor: '#fff', fillOpacity: 0.1, opacity: 0.7 }
    : { radius: 7, color: '#333', weight: 1, fillColor: color, fillOpacity: 0.9 };
  return L.circleMarker(d._pos, opts).bindPopup(() => popup(d), { maxWidth: 300 });
}

function render() {
  layer.clearLayers();
  let n = 0;
  incidents.forEach((d) => {
    const ok = state.sev.has(d.severity) && state.types.has(d.type)
      && (!state.city || d.city === state.city)
      && d.date >= state.from && d.date <= state.to;
    if (ok) { layer.addLayer(d._marker); n++; }
  });
  $('count').textContent = `Showing ${n} of ${incidents.length} incidents`;
}

function checkbox(container, value, label, set) {
  const cb = el('input', { type: 'checkbox', checked: true, value });
  cb.addEventListener('change', () => { cb.checked ? set.add(value) : set.delete(value); render(); });
  container.append(el('label', {}, cb, ' ', label));
  return cb;
}

function setup(data) {
  incidents = data;
  jitter(incidents);
  incidents.forEach((d) => { d._marker = marker(d); });
  const dates = incidents.map((d) => d.date).sort();
  const [min, max] = [dates[0], dates[dates.length - 1]];

  const boxes = [];
  SEVERITY.forEach((s, i) => boxes.push(checkbox($('f-sev'), i, `${i} ${s.label}`, state.sev)));
  Object.entries(TYPES).forEach(([k, v]) => boxes.push(checkbox($('f-type'), k, v, state.types)));
  const cities = [...new Set(incidents.map((d) => d.city))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('f-city').append(el('option', { value: '' }, 'All cities'), ...cities.map((c) => el('option', { value: c }, c)));
  for (const id of ['f-from', 'f-to']) { $(id).min = min; $(id).max = max; }

  const reset = () => {
    boxes.forEach((b) => { b.checked = true; });
    SEVERITY.forEach((_, i) => state.sev.add(i));
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

$('toggle').addEventListener('click', () => {
  const c = $('sidebar').classList.toggle('collapsed');
  $('toggle').textContent = c ? 'Show panel' : 'Hide panel';
  $('toggle').setAttribute('aria-expanded', String(!c));
  setTimeout(() => map.invalidateSize(), 50);
});
if (window.matchMedia('(max-width: 700px)').matches) $('toggle').click();

fetch('data/incidents.json')
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(setup)
  .catch((e) => { $('count').textContent = `Could not load data (${e.message}). Serve over HTTP, not file://.`; });
