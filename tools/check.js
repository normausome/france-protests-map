// Usage: NODE_PATH=/path/to/node_modules node tools/check.js [url]
const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://localhost:8765/';
const TILES = /tile\.openstreetmap\.org/;
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++; };

async function run(name, viewport) {
  console.log(`\n# ${name} ${viewport.width}x${viewport.height}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, colorScheme: 'light' });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => { if (!TILES.test(r.url())) errors.push(`failed ${r.url()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !TILES.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
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
  await expectCount(/^Showing 151 of 151/, 'all incidents loaded');
  const mobile = viewport.width <= 700;
  await page.waitForTimeout(1500);
  const cls = await page.evaluate(() => window.__cls);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const total = cls.reduce((a, e) => a + e.v, 0);
  ok(total < 0.01, `no layout shift on load (CLS ${total.toFixed(3)}${cls.length ? `: ${cls.map((e) => `${e.v.toFixed(3)} ${e.src}`).join('; ')}` : ''})`);
  const once = await page.evaluate(() => ['.disclaimer', '.updated', '.summary', '#filters'].map((q) => document.querySelectorAll(q).length));
  ok(once.every((n) => n === 1) && await page.locator('.summary li').count() === 4, `header content present once (${once})`);
  ok((await page.locator('.summary li >> nth=2').textContent()).replace(/\s+/g, ' ').includes('(RTL, RFI, BFMTV/AFP)'), 'RTL, RFI, BFMTV/AFP order kept');

  const initial = await page.evaluate(() => ({ cls: document.querySelector('#sidebar').className, aria: document.querySelector('#toggle').getAttribute('aria-expanded'), label: document.querySelector('#toggle').innerText }));
  ok(initial.cls === '', `default panel state needs no class (class="${initial.cls}")`);
  ok(initial.aria === String(!mobile) && initial.label === (mobile ? 'Show panel' : 'Hide panel'), `toggle reads "${initial.label}", aria-expanded=${initial.aria}`);
  const west = await page.evaluate(() => {
    const p = map.latLngToContainerPoint([48.39, -4.49]); const r = document.querySelector('#sidebar').getBoundingClientRect(); const m = map.getSize();
    return { x: Math.round(p.x), y: Math.round(p.y), panelRight: Math.round(r.right), panelTop: Math.round(r.top), w: m.x, h: m.y };
  });
  ok(west.x > (mobile ? 8 : west.panelRight + 8) && west.y > 8 && west.y < west.h - 8, `Brest (west-most incident) in view, clear of panel (${JSON.stringify(west)})`);
  if (mobile) {
    ok(await page.locator('#panel').isHidden(), 'sheet collapsed by default');
    await page.click('#toggle');
    ok(await page.locator('#panel').isVisible(), 'sheet expands');
    const h = await page.locator('#sidebar').boundingBox();
    ok(h.height <= viewport.height * 0.72, `sheet height ${Math.round(h.height)}px <= ~70vh`);
  }

  await page.selectOption('#f-city', 'Paris');
  await expectCount(/^Showing 37 of 151/, 'city filter Paris');
  await page.click('#reset');
  await page.uncheck('#f-sev input[value="0"]');
  await expectCount(/^Showing (?!151 )\d+ of 151/, 'severity filter changes count');
  await page.click('#reset');
  await page.uncheck('#f-type input[value="looting"]');
  await expectCount(/^Showing (?!151 )\d+ of 151/, 'type filter changes count');
  await page.click('#reset');
  await page.fill('#f-from', '2026-10-18');
  await page.dispatchEvent('#f-from', 'change');
  await expectCount(/^Showing (?!151 )\d+ of 151/, 'date From changes count');
  await page.fill('#f-to', '2026-10-05');
  await page.dispatchEvent('#f-to', 'change');
  await expectCount(/^Showing 0 of 151/, 'From > To shows 0');
  ok(await page.locator('#date-warn[role=alert]').isVisible(), 'From > To warning visible');
  ok(await page.getAttribute('#f-from', 'aria-invalid') === 'true', 'date inputs marked invalid');
  await page.click('#top-list button >> nth=0').catch(() => {});
  await page.click('#reset');
  await expectCount(/^Showing 151 of 151/, 'reset back to 151');
  ok(await page.locator('#date-warn').isHidden(), 'warning cleared after reset');
  await page.click('#top-list button >> nth=0');
  await expectCount(/^Showing 37 of 151/, 'top-cities click sets city filter (Paris)');
  ok(await page.inputValue('#f-city') === 'Paris', 'city select follows top-cities click');
  await page.click('#reset');

  const bg = () => page.evaluate(() => getComputedStyle(document.querySelector('#sidebar')).backgroundColor);
  const before = await bg();
  await page.click('#theme');
  ok(await page.getAttribute('html', 'data-theme') === 'dark' && (await bg()) !== before, 'theme toggle switches to dark');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-tile-pane')).filter.includes('invert')), 'dark basemap filter applied');
  ok(await page.getAttribute('#theme', 'aria-pressed') === 'true', 'theme aria-pressed=true');

  if (mobile) {
    await page.click('#toggle');
    ok(await page.locator('#panel').isHidden(), 'sheet collapses');
  }
  const clusters = await page.locator('.cluster').count();
  ok(clusters > 0, `${clusters} clusters rendered`);
  ok(await page.locator('.cluster.sev-5, .cluster.sev-4').count() > 0, 'clusters coloured by max severity');
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
  await page.screenshot({ path: `/tmp/fpm-check-${name}.png` });
  ok(errors.length === 0, `no console errors / CSP violations / failed requests${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1440, height: 900 });
  await run('mobile', { width: 390, height: 844 });
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
