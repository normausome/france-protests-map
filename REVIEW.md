# Review by Claude Code (Claude CLI, Sonnet)

Fresh read-only review, 19 Oct 2026, 10:34 AM ET.

## Verdict
**APPROVE**

I found no blockers. All 151 incidents have `https://` source URLs, a valid severity from 0 to 5, a known type, coordinates, and a description. 36 are city-centre only, which matches the README. I read the code and checked the data with a script. I did not run the site in a browser or deploy it.

## Blockers
None.

## Nits
- **Link scheme is not checked.** `app.js:80` sets `href` from `d.source_url` without checking the scheme. The data is clean today, so nothing is exploitable now. A future `javascript:` URL would be a stored-XSS vector. Add a guard such as `/^https?:\/\//.test(url)`.
- **No XSS elsewhere.** Every data string reaches the DOM through `append`, `textContent`, or `Object.assign` props. No data string goes into `innerHTML`.
- **Date filter edge case.** If From is later than To, the map silently shows nothing. Clamp the dates or show a hint.
- **Icon-only legend swatches.** The legend uses colour swatches next to text labels, which is fine. The hollow-pin note is `<small>` text, so screen-reader and colour-blind users still get it. The severity palette runs from yellow to near-black, but the labels carry the meaning. Popups open only on click, with no keyboard path to individual markers. Leaflet's `keyboard` option only partly covers this. Consider `interactive` markers with `keyboard: true`.
- **Unpinned Docker base and missing headers.** `caddy:2-alpine` is not pinned to a version or digest. The Caddyfile sends no security headers, such as a CSP, `X-Content-Type-Options`, or `Referrer-Policy`. Leaflet from unpkg uses SRI, which is good. A CSP is cheap to add.
- **Data files not served.** `data/context.md` and the CSV are copied into the image and so are publicly served, which is probably fine. The header summary is hard-coded in `index.html` rather than loaded from `context.md`. The sources match `context.md`, but the two can drift.

## Follow-up

Applied after review: source links are rendered only for http(s) URLs (rel="noopener noreferrer"), and the Caddyfile now sends `X-Content-Type-Options` and `Referrer-Policy` headers. Other nits are left for later.
