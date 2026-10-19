# Lighthouse, before and after

## Round 3 (search, timeline, shareable links, list, export, print, accessibility)

Lighthouse 12.8.2, headless Chromium, default simulated throttling (mobile preset and `--preset=desktop`), both runs against a local Caddy 2.10.2 with the repo Caddyfile, in a sandbox where `tile.openstreetmap.org` is blocked. Before is main @ 2ce4f74, after is this branch. No tiles means lower LCP and transfer than production and one best-practices flag (`errors-in-console`, from the failed tile requests) in both runs. Compare before with after, not with the round 2 table below.

| | Perf | A11y | Best practices | SEO | FCP | LCP | TBT | CLS | Transfer |
|---|---|---|---|---|---|---|---|---|---|
| Mobile before | 98 | 100 | 96 | 100 | 1.2 s | 1.8 s | 150 ms | 0 | 94 KiB |
| Mobile after | 99 | 100 | 96 | 100 | 1.1 s | 1.6 s | 70 ms | 0 | 100 KiB |
| Desktop before | 100 | 100 | 96 | 100 | 0.3 s | 0.4 s | 0 ms | 0 | 94 KiB |
| Desktop after | 100 | 100 | 96 | 100 | 0.3 s | 0.4 s | 0 ms | 0 | 100 KiB |

The 6 KiB difference is the larger `app.js` and `style.css` (compressed). No new requests, no new dependencies; the incident list is only rendered when opened or printed, and the new panel sections have fixed heights so CLS stays 0.

Screenshots: `shots/` (1440×900 desktop, 390×844 phone; basemap tiles missing because of the sandbox).

## Round 2 (clustering, self-hosted Leaflet, caching/CSP, dark mode, mobile sheet)

Lighthouse 12, headless Chrome, default simulated throttling (mobile preset and `--preset=desktop`).
Before: live site https://france-protests-map-production.up.railway.app (main @ 3451eae).
After: this branch served by a local Caddy 2.8.4 with the repo Caddyfile (localhost, so TTFB is lower than on Railway).

| | Perf | A11y | Best practices | SEO | FCP | LCP | TBT | CLS | Transfer |
|---|---|---|---|---|---|---|---|---|---|
| Mobile before | 51 | 100 | 89 | 91 | 2.9 s | 5.5 s | 970 ms | 0 | 506 KiB |
| Mobile after | 91 | 100 | 96 | 100 | 1.1 s | 3.4 s | 10–80 ms | 0 | 316 KiB |
| Desktop before | 89 | 100 | 96 | 91 | 1.0 s | 2.0 s | 0 ms | 0.025 | 875 KiB |
| Desktop after | 97 | 100 | 100 | 100 | 0.2 s | 1.2 s | 0 ms | 0 | 901 KiB |

The remaining mobile best-practices flag is `image-size-responsive` on OpenStreetMap tiles (OSM serves 256 px tiles only). Desktop transfer is higher because the fitted view requests more tiles; the site's own JS/CSS/data are smaller and compressed (data/incidents.json 141 KB → ~20 KB with zstd).

Screenshots: `docs/screenshots/` (1440×900 desktop, 390×844 phone).
