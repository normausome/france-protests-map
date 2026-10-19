# France unrest, Sept–Oct 2026: incident map

Built by Claude Code (Claude CLI, Sonnet). Performance and visual pass by Claude Code (Claude CLI, Opus).

A static map of 151 incidents (looting, vandalism, arson, break-ins, gatherings) that news outlets named or located during the Sept–Oct 2026 unrest in France. Plain HTML, CSS and vanilla JS with Leaflet 1.9.4, Leaflet.markercluster 1.5.3 and OpenStreetMap tiles. No build step, no API keys.

Pins are coloured by severity (0 gathering, 1 vandalism, 2 break-in, 3 looted, 4 partially burned, 5 destroyed). Hollow dashed pins are placed at a city centre only. Nearby pins are grouped into numbered clusters coloured by their most severe incident; select one to zoom in, and pins at the same spot spread out (spiderfy). Filter by severity, type, city and date, or pick a city in the Top cities list.

The theme uses CSS `light-dark()`, which needs Chrome 123+, Safari 17.5+ or Firefox 120+. The Dark map button switches the UI and basemap between light and dark. It follows the system setting until you choose, then remembers the choice in `localStorage`. The dark basemap is the OSM tiles with a CSS invert filter. CARTO Dark Matter now needs an API key.

## Data

`data/incidents.json` is an array of objects with these fields: `id`, `date`, `time`, `city`, `location`, `lat`, `lon`, `geocode_precision` (`address`, `street`, `neighborhood` or `city`), `type` (`looting`, `vandalism`, `break_in`, `fire_business`, `fire_vehicle`, `protest_gathering`, `fire_building`), `business_name`, `business_type`, `severity` (0–5), `description`, `source_url`, `source_name`, `published_at`, `corroboration`, `geocode_note`.

`data/context.md` holds the background and official figures, each with its source URL.

## Caveats

- Only incidents named by outlets are mapped, not the roughly 2,000–3,000 businesses hit.
- Data is as of 19 Oct 2026, about 10:00 AM ET (16:00 Paris).
- No private individuals are named.
- Locations are geocoded approximations; 36 incidents are pinned to the city centre only.
- Some incidents are attempted break-ins. Severity for some rows is uncertain.

## Run locally

With [Caddy](https://caddyserver.com/) (same config as production):

```sh
SITE_ROOT=. PORT=8080 caddy run --config Caddyfile --adapter caddyfile
```

Open http://localhost:8080. Or with Docker:

```sh
docker build -t france-protests-map .
docker run --rm -e PORT=8080 -p 8080:8080 france-protests-map
```

To check the running site (needs Playwright): `NODE_PATH=/path/to/node_modules node tools/check.js http://localhost:8080/`.

## Serving

The Caddyfile compresses responses with zstd or gzip and sets these headers:

- A Content-Security-Policy that allows only same-origin scripts, styles and data, plus images from `tile.openstreetmap.org`. The page has no inline scripts.
- `nosniff`, `Referrer-Policy` and a minimal `Permissions-Policy`.
- Cache-Control: `vendor/*`, `app.js` and `style.css` are immutable for a year. Each vendor directory name holds the library version, and `index.html` loads `app.js?v=N` and `style.css?v=N`. **Bump `?v=` in `index.html` whenever you change `app.js` or `style.css`.** `favicon.svg` caches for 5 minutes. `index.html` and `data/*` use `no-cache`, so the browser revalidates them with the ETag.

The Docker base image is pinned by digest.

## Deploy to Railway

Create a new Railway project; do not reuse an existing one.

```sh
railway init
railway up
```

Or in the dashboard: New Project > Deploy from GitHub repo `normausome/france-protests-map`. Railway sets `$PORT`, and the Caddyfile reads it. Then generate a domain under Settings > Networking.

## License

Map tiles and geodata: © OpenStreetMap contributors, available under the [ODbL](https://www.openstreetmap.org/copyright). Geocoding used OSM/Nominatim. Leaflet (BSD-2-Clause) and Leaflet.markercluster (MIT) are vendored under `vendor/`, each with its LICENSE file.
