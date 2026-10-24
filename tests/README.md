# Dashboard integrity tests

Checks that `dashboard.html` holds up to scrutiny as an exhibit: every number
can be recomputed from the data inside the page, the charts agree with each other,
the captions match the data, and the page actually renders.

## Run

```bash
cd tests
npm install      # one time: fetches a local copy of Plotly 2.27.0 for the browser test
npm test
```

Needs Node 18+ and Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`
if your machine doesn't already have them).

## What each file checks

| File | Checks |
|---|---|
| `01-schema` | Data shape: arrays line up, dates/times are valid, no impossible values |
| `02-kpi` | Each KPI card recomputed from the daily data |
| `03-cross-chart` | Each chart agrees with the daily series and with the other charts |
| `04-plausibility` | Hours that would be hard to defend as human work time (thresholds at the top of the file) |
| `05-page-text` | Titles, captions and axis settings vs. the data |
| `06-render` | Headless browser: no JS errors, KPI text, every chart plots every point |

## Other ways to run it

| Command | What it proves |
|---|---|
| `npm run test:control` | Builds a dashboard that is correct by construction (synthetic timestamps run through the page's own stated method) and runs the suite on it. Must be 0 failures; if not, a test is wrong, not the data. |
| `npm run test:mutants` | Plants 24 known defects in copies of the page (edited KPI, edited cell, broken chart, ...) and confirms each one turns at least one test red. |
| `npm run cross-check` | Independent Python recomputation of the disputed figures. Writes `reports/day_by_day.csv`, with one row per day and a flags column, for use in a spreadsheet. |
| `DASHBOARD=path/to/copy.html npm test` | Same suite against any other copy of the page. |
| `TZ=Asia/Tokyo BROWSER_TZ=Asia/Tokyo npm test` | Timezone independence (results must not change). |
| `BROWSER_CHANNEL=chromium npm test` | Full Chromium build instead of the headless shell. |

A failing test means the page contradicts itself or overstates something. It
does not mean the test is broken. The failure message lists the exact days involved.
