// Run from tests/:  npm run test:mutants
// Plant one known defect per copy of dashboard.html, run the suite on each copy,
// and report which tests newly fail. A mutant nobody catches = a blind spot.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SRC = join(ROOT, 'dashboard.html');
const TESTS = join(ROOT, 'tests');
const WORK = mkdtempSync(join(tmpdir(), 'wh-mutants-'));
const html = readFileSync(SRC, 'utf8');
const m = html.match(/const DATA = (\{.*?\});\n/s);
const base = JSON.parse(m[1]);
const withData = (fn) => {
  const d = structuredClone(base); fn(d);
  return html.replace(m[1], JSON.stringify(d));
};
const withText = (from, to) => { if (!html.includes(from)) throw new Error('missing ' + from); return html.replace(from, to); };

const mutants = [
  ['KPI total hours inflated', withData((d) => { d.kpi.total_hrs = 1300; })],
  ['KPI off-hours % changed', withData((d) => { d.kpi.off_pct = 60.1; })],
  ['KPI median changed', withData((d) => { d.kpi.median_per_day = 8.0; })],
  ['KPI longest date wrong', withData((d) => { d.kpi.longest_date = 'Feb 17 (Tue)'; })],
  ['KPI event count off by one', withData((d) => { d.kpi.n_events += 1; })],
  ['one daily value edited (+2 hrs)', withData((d) => { d.daily.hrs[50] += 2; })],
  ['day-of-week label swapped', withData((d) => { d.daily.dow[10] = 'Sun'; })],
  ['weekday wrongly flagged weekend', withData((d) => { d.daily.weekend[1] = true; })],
  ['first event time moved later', withData((d) => { d.daily.first_event[5] = '09:00:00'; })],
  ['off-hours minutes exceed active', withData((d) => { d.daily.off_min[3] = 9999; })],
  ['heatmap cell edited', withData((d) => { d.heatmap.z[12][40] += 5; })],
  ['source count edited', withData((d) => { d.sources.values[0] += 100; })],
  ['cumulative point edited', withData((d) => { d.cumulative[60] += 5; })],
  ['weekly bar edited', withData((d) => { d.weekly.hrs[7] += 3; })],
  ['day-of-week average edited', withData((d) => { d.dow_avg[2] += 0.5; })],
  ['top-10 entry swapped for a smaller day', withData((d) => { d.top10.labels[0] = 'Mon Jan 05'; })],
  ['duplicate date inserted', withData((d) => { d.daily.dates[2] = d.daily.dates[1]; })],
  ['gantt session dropped', withData((d) => { d.gantt.splice(100, 1); })],
  ['gantt sessions overlap', withData((d) => { d.gantt[1].start_h = d.gantt[0].start_h + d.gantt[0].duration_h / 2; })],
  ['header end date wrong', withText('January 1 - May 18, 2026', 'January 1 - May 31, 2026')],
  ['chart broken in JS', withText("Plotly.newPlot('weekly'", "Plotly.newPlotX('weekly'")],
  ['KPI element removed', withText('id="kpi-off"', 'id="kpi-offx"')],
  ['index redirect broken', null], // handled via INDEX override below
  ['daily colours flipped', withText("w ? '#ff6b6b' : '#5ec1ff'", "w ? '#5ec1ff' : '#ff6b6b'")],
];

const failing = (env) => {
  let out = '';
  try { out = execFileSync('node', ['--test', '--test-reporter=spec', ...['01', '02', '03', '04', '05', '06'].map((n) => `${n}-${{ '01': 'schema', '02': 'kpi', '03': 'cross-chart', '04': 'plausibility', '05': 'page-text', '06': 'render' }[n]}.test.mjs`)],
    { cwd: TESTS, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = e.stdout; }
  const tail = out.slice(out.indexOf('✖ failing tests:'));
  return new Set([...tail.matchAll(/^✖ (.*?) \([\d.]+ms\)$/gm)].map((x) => x[1]));
};

const baseline = failing({});
console.log(`baseline: ${baseline.size} failing\n`);
const results = mutants.map(([name, page], i) => {
  const env = page === null
    ? (writeFileSync(`${WORK}/index_${i}.html`, '<html><body>no redirect</body></html>'), { INDEX: `${WORK}/index_${i}.html` })
    : (writeFileSync(`${WORK}/m${i}.html`, page), { DASHBOARD: `${WORK}/m${i}.html` });
  const now = failing(env);
  const caught = [...now].filter((t) => !baseline.has(t));
  console.log(`${caught.length ? 'CAUGHT ' : 'MISSED '} ${name}${caught.length ? ` -> ${caught.length} new failure(s), e.g. "${caught[0]}"` : ''}`);
  return caught.length > 0;
});
console.log(`\n${results.filter(Boolean).length}/${results.length} planted defects caught`);
