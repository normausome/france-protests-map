# Lighthouse, before and after

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
