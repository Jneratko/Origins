# Origins · World History Atlas

The prototype includes a geographic map, 24 synthetic sites, theme filters, search, a cumulative timeline, playback, a six-stop guided journey, and Mapbox setup.

## Run the app

Extract atlas-prototype.zip and serve its folder using a local HTTP server. For example, if Python is installed, run `python -m http.server 8000` from that folder and open http://localhost:8000. Opening index.html directly will not load the JSON dataset because browsers restrict local file requests.

The demo basemap uses MapLibre with CARTO / OpenStreetMap tiles. Map settings accepts a public Mapbox token and switches to Mapbox GL JS with the dark basemap and globe projection. The token is saved only in the browser. A public token is visible to visitors by design; restrict it to the app's origin. Do not enter secret tokens.

## Replace the sample data

Edit sites.json inside the app folder. atlas-sites.json is a separate copy of the same initial dataset. Each record has:

- id: unique string; retain stable IDs when possible.
- title and region: labels shown in the UI.
- coordinates: [longitude, latitude] in decimal degrees.
- ageOlder and ageYounger: positive years ago, with ageOlder >= ageYounger. These are age ranges, not BCE dates; define the reference year explicitly when adding research data.
- theme: Origins, Migration, or Culture.
- journeyOrder: 1 through 6 for the six guided stops, otherwise null. Keep exactly six ordered stops with the current journey UI.
- description: the site's visible detail text.
- isTestData: true for the current synthetic records.
- sources: reserved array for future citations. The current prototype does not render source links.

The time slider shows records whose older age is at or before the selected moment in chronological history. It is cumulative, rather than a claim that each site remained occupied at that moment. All time restores all records.

Before switching to real data, update the app's test-data notices and detail-card wording, add rendered citations, and define dating uncertainty and the age reference convention. Current dates, interpretations, and guided stops are illustrative, not historical claims. The basemap shows modern geography, not reconstructed coastlines or ancient borders. No migration routes or historical territorial boundaries are drawn.

## Validation and publication

JavaScript syntax, local HTTP serving, unique IDs, coordinate structure, age ordering, and six journey records were checked. Mapbox integration needs a valid user token for live verification. The optional WebMCP site-selection tool is feature-detected; supported-browser validation was unavailable. Automated browser interaction testing was not performed.

Private publishing was attempted but the source-upload stdin operation was rejected by the session's automatic approval policy. No live deployed URL has been confirmed.
