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

A failing test means the page contradicts itself or overstates something. It
does not mean the test is broken. The failure message lists the exact days involved.
