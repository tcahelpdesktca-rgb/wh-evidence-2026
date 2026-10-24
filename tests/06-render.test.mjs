// 06 - Open the real page in a headless browser and check what a viewer sees.
// Plotly is served from the local npm copy (same pinned version as the page's
// CDN link) so the test runs offline.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DATA, DASHBOARD_PATH, INDEX_PATH, HTML } from './lib/data.mjs';

const require = createRequire(import.meta.url);
// Playwright is pre-installed globally in some environments; fall back to that copy.
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('/opt/node-tools/node_modules/playwright'); }
})();

const PLOTLY_JS = readFileSync(require.resolve('plotly.js-dist-min'), 'utf8');
const PAGE_PLOTLY_VERSION = HTML.match(/plotly-(\d+\.\d+\.\d+)\.min\.js/)[1];
const K = DATA.kpi;
const fmt = (n) => n.toLocaleString('en-US');

// Optional knobs for running the same checks under different conditions:
//   BROWSER_CHANNEL=chromium  -> full Chromium build instead of the headless shell
//   BROWSER_TZ=Asia/Tokyo     -> browser timezone
const launch = () => chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});

const openPage = async (browser, path, viewport = { width: 1480, height: 1000 }) => {
  const page = await browser.newPage({ viewport, locale: 'en-US', timezoneId: process.env.BROWSER_TZ || undefined });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.route('**/cdn.plot.ly/**', (route) => route.fulfill({ contentType: 'application/javascript', body: PLOTLY_JS }));
  await page.goto(pathToFileURL(path).href);
  await page.waitForFunction(() => document.querySelectorAll('.js-plotly-plot').length === 9, null, { timeout: 15000 }).catch(() => {});
  return { page, errors };
};

describe('rendered dashboard', () => {
  let browser;
  let page;
  let errors;
  const textOf = (id) => page.locator(`#${id}`).textContent();
  const plot = (id) => page.evaluate((i) => {
    const el = document.getElementById(i);
    return { data: el.data, layout: el.layout };
  }, id);

  before(async () => {
    browser = await launch();
    ({ page, errors } = await openPage(browser, DASHBOARD_PATH));
  });
  after(async () => browser && browser.close());

  it('local Plotly copy is the same version the page asks for', async () => {
    assert.equal(await page.evaluate(() => Plotly.version), PAGE_PLOTLY_VERSION);
  });

  it('loads with no JavaScript errors', () => assert.deepEqual(errors, []));

  it('all nine charts render an SVG', async () => {
    const ids = ['daily', 'heatmap', 'hours', 'gantt', 'sources', 'dow', 'cumulative', 'top10', 'weekly'];
    const missing = await page.evaluate((list) => list.filter((id) => !document.querySelector(`#${id} .main-svg`)), ids);
    assert.deepEqual(missing, []);
  });

  describe('KPI cards show the DATA values', () => {
    const cases = [
      ['kpi-week', `${K.avg_per_week} hr`],
      ['kpi-week-sub', `+${K.pct_above_40}% vs a 40-hr week`],
      ['kpi-day', `${K.avg_per_day} hr`],
      ['kpi-day-sub', `median ${K.median_per_day} hr`],
      ['kpi-total', fmt(K.total_hrs)],
      ['kpi-total-sub', `across ${fmt(K.n_sessions)} sessions, ${fmt(K.n_events)} events`],
      ['kpi-off', `${K.off_pct}%`],
      ['kpi-long', `${K.longest_hrs} hr`],
      ['kpi-long-sub', K.longest_date],
      ['kpi-wknd', String(K.weekend_days)],
    ];
    cases.forEach(([id, expected]) => it(`#${id} = "${expected}"`, async () => assert.equal(await textOf(id), expected)));

    it('no KPI card is blank or shows undefined/NaN', async () => {
      const bad = await page.evaluate(() => [...document.querySelectorAll('.kpi-value, .kpi-sub')]
        .map((el) => el.textContent.trim()).filter((t) => !t || /undefined|NaN/.test(t)));
      assert.deepEqual(bad, []);
    });
  });

  it('headline quotes the KPI numbers', async () => {
    const t = await textOf('headline');
    [`${K.avg_per_week} hours per week`, `${K.pct_above_40}% above`, `Of ${DATA.daily.dates.length} days analyzed`,
      `${K.off_pct}%`, fmt(K.total_hrs), fmt(K.n_events), `${DATA.sources.labels.length} independent local data sources`]
      .forEach((s) => assert.ok(t.includes(s), `headline missing "${s}"`));
  });

  describe('each chart plots every data point', () => {
    it('daily: one bar per day, heights = daily hours, red exactly on non-business days', async () => {
      const { data } = await plot('daily');
      assert.deepEqual(data[0].y, DATA.daily.hrs);
      assert.deepEqual(data[0].marker.color, DATA.daily.weekend.map((w) => (w ? '#ff6b6b' : '#5ec1ff')));
    });

    it('heatmap: 24 x days grid', async () => {
      const { data } = await plot('heatmap');
      assert.deepEqual(data[0].z, DATA.heatmap.z);
      assert.deepEqual(data[0].x, DATA.heatmap.x);
    });

    it('hour-of-day: 24 bars', async () => assert.deepEqual((await plot('hours')).data[0].y, DATA.hour_totals));

    it('gantt: one bar per session row', async () => {
      const { data } = await plot('gantt');
      assert.equal(data[0].x.length, DATA.gantt.length);
      assert.deepEqual(data[0].base, DATA.gantt.map((g) => g.start_h));
    });

    it('sources: every source slice present', async () => {
      const { data } = await plot('sources');
      assert.deepEqual(data[0].labels, DATA.sources.labels);
      assert.deepEqual(data[0].values, DATA.sources.values);
    });

    it('day-of-week: 7 bars Mon..Sun', async () => {
      const { data } = await plot('dow');
      assert.deepEqual(data[0].x, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
      assert.deepEqual(data[0].y, DATA.dow_avg);
    });

    it('cumulative: one point per day', async () => assert.deepEqual((await plot('cumulative')).data[0].y, DATA.cumulative));

    it('top 10: ten bars', async () => assert.deepEqual((await plot('top10')).data[0].x, DATA.top10.hrs));

    it('weekly: one bar per week', async () => assert.deepEqual((await plot('weekly')).data[0].y, DATA.weekly.hrs));
  });

  it('daily chart does not cut off any bar (rendered y-axis max >= longest day)', async () => {
    const { layout } = await plot('daily');
    assert.ok(layout.yaxis.range[1] >= Math.max(...DATA.daily.hrs),
      `rendered y-axis tops out at ${layout.yaxis.range[1]}, longest day is ${Math.max(...DATA.daily.hrs)}`);
  });
});

describe('other entry points and layouts', () => {
  let browser;
  before(async () => { browser = await launch(); });
  after(async () => browser && browser.close());

  it('index.html forwards to the dashboard', async () => {
    const { page } = await openPage(browser, INDEX_PATH);
    await page.waitForURL(/dashboard\.html$/, { timeout: 5000 });
    assert.match(page.url(), /dashboard\.html$/);
    await page.close();
  });

  it('prints to PDF with every chart present (exhibits get printed)', async () => {
    const { page } = await openPage(browser, DASHBOARD_PATH);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'Letter', printBackground: true });
    const charts = await page.evaluate(() => document.querySelectorAll('.js-plotly-plot .main-svg').length);
    assert.ok(pdf.length > 50_000, `PDF only ${pdf.length} bytes`);
    assert.ok(charts >= 9, `${charts} chart SVGs in print layout`);
    await page.close();
  });

  it('renders on a phone-width screen without errors or sideways scrolling', async () => {
    const { page, errors } = await openPage(browser, DASHBOARD_PATH, { width: 390, height: 844 });
    assert.deepEqual(errors, []);
    const { scrollW, clientW } = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
    assert.ok(scrollW <= clientW + 1, `page is ${scrollW}px wide on a ${clientW}px screen`);
    await page.close();
  });
});
