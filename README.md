# Origins · World History Atlas

An interactive atlas prototype for exploring early Homo sapiens through geography and time, roughly 300,000–10,000 years ago.

The app currently uses 24 synthetic sites. Locations, dates, descriptions, and the guided journey are illustrative examples, not verified historical evidence. Wikipedia/Wikidata discovery is not implemented.

## Features

- Interactive map with a demo basemap and optional Mapbox connection
- Search and filters for Origins, Migration, and Culture
- Cumulative timeline with playback
- Site detail cards and a six-stop illustrative guided journey

## Project files

```text
Origins/
├── index.html   # Page and external map libraries
├── app.js       # Map, filters, timeline, and journey
├── style.css    # Layout and styling
├── sites.json   # Active sample dataset
└── README.md
```

This is a static HTML/CSS/JavaScript app. No build step, package installation, database, or backend is required. Internet access is needed for map libraries and basemap tiles.

## Preview locally in VS Code

1. Open the Origins folder using **File → Open Folder**.
2. Install Microsoft's [Live Preview extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.live-server) if needed.
3. Open `index.html` and use its preview button or context menu to launch Live Preview.
4. Browse the atlas through the extension's local HTTP preview.

Do not double-click `index.html` in File Explorer: browsers restrict the app's request for `sites.json` when opened through `file://`.

Alternatively, if Python is installed, run this in the Origins folder:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open [http://localhost:8000](http://localhost:8000). Stop the server with **Ctrl+C**.

## Save changes to GitHub

Repository: [Jneratko/Origins](https://github.com/Jneratko/Origins)

The local repository uses `main` and is connected to this GitHub repository as `origin`.

1. Edit files in VS Code, save them, and preview locally.
2. Open **Source Control** with **Ctrl+Shift+G**.
3. Review changes and click **+** next to the files you want to stage.
4. Enter a short commit message and click **Commit**.
5. Click **Sync Changes** or **Push** to upload the commit.

A commit records changes locally; pushing uploads them. See [VS Code's source-control guide](https://code.visualstudio.com/docs/sourcecontrol/quickstart).

## Publish with GitHub Pages

The GitHub repository stores the code. GitHub Pages is a separate setting that serves the website. These instructions do not confirm that Pages is currently enabled.

1. Open the repository on GitHub and go to **Settings → Pages**.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Select **main** and **/ (root)**, then click **Save**.
4. Check the Pages deployment in the **Actions** tab.
5. After a successful deployment, open the URL shown in **Settings → Pages**.

The expected default project-site URL is [https://jneratko.github.io/Origins/](https://jneratko.github.io/Origins/). This address has not been verified live; use the URL displayed by GitHub.

Once configured, pushes to `main` trigger website deployment. The app's relative file paths support hosting under `/Origins/`.

If Pages is unavailable for a private repository, check your account's plan and repository eligibility. See [GitHub's publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Connect Mapbox

The demo basemap uses MapLibre with CARTO / OpenStreetMap tiles. To use Mapbox's dark basemap and globe:

1. Open **Map settings** in the app.
2. Enter a public Mapbox token beginning with `pk.`.
3. Select **Use Mapbox**.

The token is stored in that browser's local storage. Entering it on your PC does not configure it for other visitors or browsers. Never enter or commit secret tokens. Configure public-token URL restrictions for the local preview and deployed addresses you use.

Select **Use demo map** to remove the saved token and return to the demo basemap. Mapbox integration still needs testing with a valid token.

## Edit sample data

Edit `sites.json`, preview the app, then commit and push your changes.

| Field | Meaning |
| --- | --- |
| `id` | Unique, stable string |
| `title`, `region` | Display labels |
| `coordinates` | `[longitude, latitude]` in decimal degrees |
| `ageOlder`, `ageYounger` | Positive years ago; `ageOlder >= ageYounger` |
| `theme` | `Origins`, `Migration`, or `Culture` |
| `journeyOrder` | One record for each order 1–6; `null` for other records |
| `description` | Site detail text |
| `isTestData` | Currently `true`; changing it does not change UI disclaimers |
| `sources` | Reserved array; links are not currently displayed |

Keep valid JSON and all required fields. The app does not validate imported records, so malformed data can break rendering or the journey.

The timeline is cumulative: sites appear when `ageOlder` is greater than or equal to the selected age in years ago. They remain visible as time advances. Filtering ignores `ageYounger` and does not indicate continuous occupation. **All time** removes the timeline restriction; search and theme filters still apply.

## Current limitations and checks

- Detail cards always use test-data wording, regardless of `isTestData`. Real records need corresponding UI changes, visible citations, and an explicit age-reference convention.
- The journey assumes exactly six ordered stops.
- The basemap shows modern geography, not ancient coastlines or borders. Migration routes are not drawn.
- There is no online editor or shared data persistence; update records through the repository.
- An optional WebMCP site-selection tool is registered only in browsers exposing the required API. Ordinary atlas use does not require it.

JavaScript syntax and dataset checks confirmed 24 unique IDs, correctly ordered age ranges, and journey orders 1–6. Full browser interaction, Mapbox token integration, and live Pages deployment have not been verified in this review.
