# France unrest, Sept–Oct 2026: incident map

Built by Claude Code (Claude CLI, Sonnet)

A static map of 151 incidents (looting, vandalism, arson, break-ins, gatherings) that news outlets named or located during the Sept–Oct 2026 unrest in France. Plain HTML, CSS and vanilla JS with Leaflet 1.9.4 and OpenStreetMap tiles. No build step, no API keys.

Pins are coloured by severity (0 gathering, 1 vandalism, 2 break-in, 3 looted, 4 partially burned, 5 destroyed). Hollow dashed pins are placed at a city centre only. Filter by severity, type, city and date.

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

```sh
python3 -m http.server 8080
```

Open http://localhost:8080. Or with Docker:

```sh
docker build -t france-protests-map .
docker run --rm -e PORT=8080 -p 8080:8080 france-protests-map
```

## Deploy to Railway

Create a new Railway project; do not reuse an existing one.

```sh
railway init
railway up
```

Or in the dashboard: New Project > Deploy from GitHub repo `normausome/france-protests-map`. Railway sets `$PORT`, and the Caddyfile reads it. Then generate a domain under Settings > Networking.

## License

Map tiles and geodata: © OpenStreetMap contributors, available under the [ODbL](https://www.openstreetmap.org/copyright). Geocoding used OSM/Nominatim. Leaflet is BSD-2-Clause.
