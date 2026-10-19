// Usage: NODE_PATH=/path/to/node_modules node tools/check.js [url]
const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.argv[2] || 'http://localhost:8765/';
const TILES = /tile\.openstreetmap\.org/;
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++; };

async function run(name, viewport) {
  console.log(`\n# ${name} ${viewport.width}x${viewport.height}`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, colorScheme: 'light', acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  const errors = [];
  let tileFailures = 0;
  // OSM tile requests may be blocked where this runs (sandboxes, offline); count them separately instead of failing.
  const isTile = (url) => TILES.test(url || '');
  page.on('console', (m) => { if (m.type() === 'error') { if (isTile(m.location().url)) tileFailures++; else errors.push(m.text()); } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => { if (isTile(r.url())) tileFailures++; else errors.push(`failed ${r.url()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !isTile(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    window.__cls = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls.push({ v: e.value, src: e.sources.map((x) => x.node?.id || x.node?.className || x.node?.nodeName).join(',') }); }))
      .observe({ type: 'layout-shift', buffered: true });
  });
  // Throttle the load like Lighthouse (slow 4G, 4x CPU) so paint-before-JS shifts show up.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 204800, uploadThroughput: 96000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(URL);
  const count = page.locator('#count');
  const expectCount = async (re, msg) => {
    try { await page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#count').textContent), re.source, { timeout: 20000 }); } catch {}
    ok(re.test(await count.textContent()), `${msg}: "${await count.textContent()}"`);
  };
  const hash = () => page.evaluate(() => location.hash);
  const settle = (ms = 300) => page.waitForTimeout(ms);
  await expectCount(/^Showing 166 of 166/, 'all incidents loaded');
  const mobile = viewport.width <= 700;
  await page.waitForTimeout(1500);
  const cls = await page.evaluate(() => window.__cls);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const total = cls.reduce((a, e) => a + e.v, 0);
  ok(total < 0.01, `no layout shift on load (CLS ${total.toFixed(3)}${cls.length ? `: ${cls.map((e) => `${e.v.toFixed(3)} ${e.src}`).join('; ')}` : ''})`);
  const once = await page.evaluate(() => ['.disclaimer', '.updated', '.summary', '#filters'].map((q) => document.querySelectorAll(q).length));
  ok(once.every((n) => n === 1) && await page.locator('.summary li').count() === 7, `header content present once (${once})`);
  ok((await page.locator('.summary li >> nth=2').textContent()).replace(/\s+/g, ' ').includes('(RTL, RFI, BFMTV/AFP)'), 'RTL, RFI, BFMTV/AFP order kept');
  ok((await hash()) === '', 'default filters leave the URL hash empty');

  const initial = await page.evaluate(() => ({ cls: document.querySelector('#sidebar').className, aria: document.querySelector('#toggle').getAttribute('aria-expanded'), label: document.querySelector('#toggle').innerText }));
  ok(initial.cls === '', `default panel state needs no class (class="${initial.cls}")`);
  ok(initial.aria === String(!mobile) && initial.label === (mobile ? 'Show panel' : 'Hide panel'), `toggle reads "${initial.label}", aria-expanded=${initial.aria}`);
  const west = await page.evaluate(() => {
    const p = map.latLngToContainerPoint([48.39, -4.49]); const r = document.querySelector('#sidebar').getBoundingClientRect(); const m = map.getSize();
    return { x: Math.round(p.x), y: Math.round(p.y), panelRight: Math.round(r.right), panelTop: Math.round(r.top), w: m.x, h: m.y };
  });
  ok(west.x > (mobile ? 8 : west.panelRight + 8) && west.y > 8 && west.y < west.h - 8, `Brest (west-most incident) in view, clear of panel (${JSON.stringify(west)})`);

  // Keyboard: the skip link is the first tab stop and moves focus to the map.
  await page.keyboard.press('Tab');
  ok(await page.evaluate(() => document.activeElement.id) === 'skip', 'skip link is the first tab stop');
  await page.keyboard.press('Enter');
  ok(await page.evaluate(() => document.activeElement.id === 'map' && !location.hash), 'skip link focuses the map without touching the hash');

  if (mobile) {
    ok(await page.locator('#panel').isHidden(), 'sheet collapsed by default');
    await page.click('#toggle');
    ok(await page.locator('#panel').isVisible(), 'sheet expands');
    const h = await page.locator('#sidebar').boundingBox();
    ok(h.height <= viewport.height * 0.72, `sheet height ${Math.round(h.height)}px <= ~70vh`);
  }

  await page.selectOption('#f-city', 'Paris');
  await expectCount(/^Showing 45 of 166/, 'city filter Paris');
  await settle();
  ok((await hash()) === '#city=Paris', `URL hash follows the city filter (${await hash()})`);
  await page.click('#reset');
  await page.uncheck('#f-sev input[value="0"]');
  await expectCount(/^Showing (?!166 )\d+ of 166/, 'severity filter changes count');
  await settle();
  ok((await hash()) === '#sev=1,2,3,4,5', `URL hash lists the kept severities (${await hash()})`);
  await page.click('#reset');
  await page.uncheck('#f-type input[value="looting"]');
  await expectCount(/^Showing (?!166 )\d+ of 166/, 'type filter changes count');
  await page.click('#reset');
  await page.fill('#f-from', '2026-10-18');
  await page.dispatchEvent('#f-from', 'change');
  await expectCount(/^Showing (?!166 )\d+ of 166/, 'date From changes count');
  await page.fill('#f-to', '2026-10-05');
  await page.dispatchEvent('#f-to', 'change');
  await expectCount(/^Showing 0 of 166/, 'From > To shows 0');
  ok(await page.locator('#date-warn[role=alert]').isVisible(), 'From > To warning visible');
  ok(await page.getAttribute('#f-from', 'aria-invalid') === 'true', 'date inputs marked invalid');
  await page.click('#top-list button >> nth=0').catch(() => {});
  await page.click('#reset');
  await expectCount(/^Showing 166 of 166/, 'reset back to 166');
  ok(await page.locator('#date-warn').isHidden(), 'warning cleared after reset');
  await settle();
  ok((await hash()) === '', 'reset clears the URL hash');
  await page.click('#top-list button >> nth=0');
  await expectCount(/^Showing 45 of 166/, 'top-cities click sets city filter (Paris)');
  ok(await page.inputValue('#f-city') === 'Paris', 'city select follows top-cities click');
  await page.click('#reset');

  // Severity mix of the shown incidents
  const mixSum = async () => (await page.locator('#mix strong').allTextContents()).reduce((a, s) => a + Number(s), 0);
  ok(await page.locator('#mix li').count() === 6 && (await mixSum()) === 166, `severity mix lists 6 levels summing to 166 (${await mixSum()})`);
  ok(await page.locator('#mix-bar span').count() === 6, 'severity mix bar has a segment per level');
  await page.selectOption('#f-city', 'Lille');
  await expectCount(/^Showing 11 of 166/, 'city filter Lille');
  ok((await mixSum()) === 11, `severity mix follows the filter (${await mixSum()})`);
  await page.click('#reset');

  // Timeline: one bar per day; a day is a toggle for from=to=day
  ok(await page.locator('#timeline button').count() === 5, `timeline has one bar per day (${await page.locator('#timeline button').count()})`);
  const day17 = page.locator('#timeline button', { hasText: '17 Oct' });
  ok((await day17.locator('.n').textContent()) === '138', `timeline shows 138 for 17 Oct (${await day17.locator('.n').textContent()})`);
  ok((await day17.locator('.tbar').evaluate((e) => e.getBoundingClientRect().height)) > 20, 'timeline bar for 17 Oct is drawn');
  await day17.click();
  await expectCount(/^Showing 138 of 166/, 'timeline day click shows only 17 Oct');
  await settle();
  ok(await page.inputValue('#f-from') === '2026-10-17' && await page.inputValue('#f-to') === '2026-10-17', 'date inputs follow the timeline');
  ok(await page.locator('#timeline button[aria-pressed=true]').count() === 1, 'timeline marks the selected day');
  ok((await hash()) === '#from=2026-10-17&to=2026-10-17', `URL hash carries the day (${await hash()})`);
  await page.locator('#timeline button[aria-pressed=true]').click();
  await expectCount(/^Showing 166 of 166/, 'timeline day click again shows all days');
  await page.selectOption('#f-city', 'Lille');
  await expectCount(/^Showing 11 of 166/, 'city filter Lille again');
  ok((await day17.locator('.n').textContent()) === '11', 'timeline counts follow the other filters');
  await page.click('#reset');

  // Search
  await page.fill('#f-q', 'louvre');
  await expectCount(/^Showing 1 of 166/, 'search "louvre" finds the Louvre blockade');
  await settle();
  ok((await hash()) === '#q=louvre', `URL hash carries the search (${await hash()})`);
  await page.fill('#f-q', 'Republique');
  await expectCount(/^Showing (?!0 )(?!166 )\d+ of 166/, 'search ignores accents (Republique finds République)');
  await page.fill('#f-q', 'zzzz-no-such-thing');
  await expectCount(/^Showing 0 of 166/, 'search with no match shows 0');
  await page.fill('#f-q', '');
  await expectCount(/^Showing 166 of 166/, 'clearing search shows all');

  // Copy link, CSV export
  await page.selectOption('#f-city', 'Lille');
  await expectCount(/^Showing 11 of 166/, 'Lille for export');
  await page.click('#copy');
  await page.waitForTimeout(600);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok(/^Link copied/.test(await page.textContent('#status')) && clip.includes('#city=Lille&map='), `copy link reports success and includes filters and view (${clip.slice(clip.indexOf('#'))})`);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('#export')]);
  const csv = dl ? fs.readFileSync(await dl.path(), 'utf8') : '';
  const lines = csv.split('\r\n').filter(Boolean);
  ok(dl && dl.suggestedFilename() === 'france-incidents-11-of-166.csv' && lines.length === 12 && lines[0].startsWith('﻿id,date,time,city') && lines[1].includes('https://'), `CSV export has a header, 11 rows and sources (${dl ? dl.suggestedFilename() : 'no download'}, ${lines.length} lines)`);
  ok(/^Exported 11/.test(await page.textContent('#status')), 'export reports the row count');

  // Incident list and print view
  await page.click('#list-sec summary');
  await settle();
  ok(await page.locator('#list .item').count() === 11, `incident list renders the shown incidents (${await page.locator('#list .item').count()})`);
  ok(await page.locator('#list .item a[rel="noopener noreferrer"]').count() === 11, 'every listed incident links its source');
  await page.click('#list .item button >> nth=0');
  await page.waitForTimeout(1500);
  ok(await page.locator('.leaflet-popup .popup .chip').count() === 1, 'list "Show on map" opens the pin popup');
  if (mobile) {
    ok(await page.locator('#panel').isHidden(), 'sheet collapses so the popup is visible');
    await page.click('#toggle');
  }
  await page.click('#list-sec summary');
  await settle();
  ok(await page.locator('#list .item').count() === 0, 'closed list is emptied');
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await settle();
  const print = await page.evaluate(() => ({
    map: getComputedStyle(document.querySelector('#map')).display, panel: getComputedStyle(document.querySelector('#panel')).display,
    items: document.querySelectorAll('#list .item').length, note: document.querySelector('#print-note').textContent, buttons: getComputedStyle(document.querySelector('.actions')).display,
  }));
  ok(print.map === 'none' && print.panel === 'block' && print.items === 11 && /^Printed \d{4}-\d{2}-\d{2} from .*#city=Lille/.test(print.note) && print.buttons === 'none', `print view hides the map and lists the incidents (${JSON.stringify(print)})`);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  ok(await page.locator('#list .item').count() === 0, 'list closes again after printing');
  // Fresh load: "Show on map" left the view zoomed in, and the cluster checks below want the whole country.
  await page.goto(URL);
  await expectCount(/^Showing 166 of 166/, 'reload for theme and cluster checks');
  if (mobile) await page.click('#toggle');

  const bg = () => page.evaluate(() => getComputedStyle(document.querySelector('#sidebar')).backgroundColor);
  const before = await bg();
  await page.click('#theme');
  ok(await page.getAttribute('html', 'data-theme') === 'dark' && (await bg()) !== before, 'theme toggle switches to dark');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-tile-pane')).filter.includes('invert')), 'dark basemap filter applied');
  ok(await page.textContent('#theme') === 'Light map', 'theme button reads Light map while dark');

  if (mobile) {
    await page.click('#toggle');
    ok(await page.locator('#panel').isHidden(), 'sheet collapses');
  }
  const clusters = await page.locator('.cluster').count();
  ok(clusters > 0, `${clusters} clusters rendered`);
  ok(await page.locator('.cluster.sev-5, .cluster.sev-4').count() > 0, 'clusters coloured by max severity');
  const titles = await page.locator('.cluster').evaluateAll((els) => els.map((e) => e.title));
  ok(titles.length && titles.every((t) => /^\d+ incidents, .+: \d+ /.test(t)), `clusters carry a tooltip with city and severity counts ("${titles[0]}")`);
  const vh = await page.locator('.cluster .vh').evaluateAll((els) => els.map((e) => e.textContent));
  ok(vh.length === titles.length && vh.every((t) => /^ incidents, .+, most severe: \d .+\. Select/.test(t)), `clusters carry visually hidden text for screen readers ("${vh[0]}")`);
  ok(await page.evaluate(() => document.querySelector('main#map') !== null && document.querySelector('#map').getAttribute('aria-label').includes('Arrow keys')), 'map is the main landmark with keyboard hints');
  for (let i = 0; i < 6 && !(await page.locator('.leaflet-popup').count()); i++) {
    const pin = page.locator('.pin:visible').first();
    if (await pin.count()) { await pin.click(); break; }
    await page.locator('.cluster').first().click();
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(300);
  ok(await page.locator('.leaflet-popup .popup .chip').count() === 1, 'popup opens with severity chip');
  if (await page.locator('.leaflet-popup a[target=_blank]').count()) {
    ok((await page.getAttribute('.leaflet-popup a[target=_blank]', 'rel')) === 'noopener noreferrer', 'source link rel=noopener noreferrer');
  }
  ok(await page.locator('.pin[tabindex="0"]').count() > 0, 'markers keyboard-focusable');

  // Shareable URL: filters and view come from the hash, and the hash reacts to changes.
  await page.goto(`${URL}#city=Lille&sev=3,4,5&type=looting,fire_business&from=2026-10-17`);
  await expectCount(/^Showing (?!0 )(?!166 )\d+ of 166/, 'hash filters apply on load');
  const applied = await page.evaluate(() => ({ city: document.querySelector('#f-city').value, sev0: document.querySelector('#f-sev input[value="0"]').checked, sev3: document.querySelector('#f-sev input[value="3"]').checked, vand: document.querySelector('#f-type input[value="vandalism"]').checked, from: document.querySelector('#f-from').value }));
  ok(applied.city === 'Lille' && !applied.sev0 && applied.sev3 && !applied.vand && applied.from === '2026-10-17', `controls mirror the hash (${JSON.stringify(applied)})`);
  await page.evaluate(() => { location.hash = '#city=Paris'; });
  await expectCount(/^Showing 45 of 166/, 'hashchange re-applies filters');
  await page.goto(`${URL}#city=Nowhere&sev=9&from=bad`);
  await expectCount(/^Showing 166 of 166/, 'unknown hash values are ignored');

  // Clusters: pins that share one spot fan out at street level instead of zooming to the max first.
  await page.goto(`${URL}#map=48.8675,2.3640,13`);
  await expectCount(/^Showing 166 of 166/, 'hash map view loads');
  ok(await page.evaluate(() => map.getZoom()) === 13, 'hash map view sets the zoom');
  const tight = page.locator('.cluster', { hasText: /^1[0-9] incidents/ }).first();
  ok(await tight.count() === 1, 'République cluster (13 co-located pins plus neighbours) visible at zoom 13');
  await settle(500);
  await tight.click();
  await page.waitForTimeout(1800);
  const fan = await page.evaluate(() => ({ zoom: map.getZoom(), legs: document.querySelectorAll('path.spider-leg').length, hash: location.hash }));
  ok(fan.zoom === 16 && fan.legs >= 13, `one click fans out ${fan.legs} pins at street level (zoom ${fan.zoom}, not 18)`);
  ok(/^#map=48\.\d+,2\.\d+,16$/.test(fan.hash), `hash follows the map view (${fan.hash})`);
  await page.goto(`${URL}#map=48.8675,2.3640,16`);
  await expectCount(/^Showing 166 of 166/, 'reload at zoom 16');
  await page.locator('.cluster', { hasText: /^1[0-9] incidents/ }).first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  ok(await page.locator('path.spider-leg').count() >= 13 && await page.evaluate(() => map.getZoom()) === 16, 'Enter on a focused cluster fans it out in place');
  ok(await page.evaluate(() => { const leg = document.querySelector('path.spider-leg'); return leg && getComputedStyle(leg).stroke !== 'rgb(51, 136, 255)'; }), 'spider legs take the theme colour');
  await page.keyboard.press('Escape');
  await page.locator('.pin:visible').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  ok(await page.locator('.leaflet-popup .popup .chip').count() === 1, 'Enter on a focused pin opens its popup');

  await page.screenshot({ path: `/tmp/fpm-check-${name}.png` });
  if (tileFailures) console.log(`NOTE ${tileFailures} OpenStreetMap tile requests failed (blocked network?); not counted as errors`);
  ok(errors.length === 0, `no console errors / CSP violations / failed requests${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1440, height: 900 });
  await run('mobile', { width: 390, height: 844 });
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
