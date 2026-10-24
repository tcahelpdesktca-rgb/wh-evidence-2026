// 05 - What the page *says* must match what the data *shows*.
// Titles, captions and chart settings are checked against DATA. Leftover text from
// an earlier version of the report (wrong month, wrong window length) is
// an easy target in cross-examination.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA, HTML, readHtml, INDEX_PATH, dailyRows, parseIso, daysBetweenInclusive, NYSE_HOLIDAYS_2026,
  scriptSection, groupBy,
} from './lib/data.mjs';

const rows = dailyRows();
const firstDay = parseIso(rows[0].date);
const lastDay = parseIso(rows.at(-1).date);
const windowLen = daysBetweenInclusive(firstDay, lastDay);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
const text = (re) => (HTML.match(re) || [])[1];

describe('title and header', () => {
  it('<title> covers the months in the data', () => {
    const title = text(/<title>(.*?)<\/title>/);
    const months = [...new Set(rows.map((r) => MONTHS[parseIso(r.date).getUTCMonth()]))];
    const named = MONTHS.filter((m) => title.includes(m));
    assert.ok(named.length === 0 || named.includes(months[0]) && named.includes(months.at(-1)),
      `title "${title}" but data runs ${months[0]} - ${months.at(-1)}`);
  });

  it('header start date = first day in the data', () => {
    const sub = text(/<div class="sub">(.*?)<\/div>/);
    assert.ok(sub.startsWith(longDate(firstDay)), `header "${sub}" vs first data day ${rows[0].date}`);
  });

  it('header end date = last day in the data', () => {
    const sub = text(/<div class="sub">(.*?)<\/div>/);
    assert.ok(sub.includes(`${longDate(lastDay)}, ${lastDay.getUTCFullYear()}`), `header "${sub}" vs last data day ${rows.at(-1).date}`);
  });

  it('header "N calendar days" = days from first to last data day', () => {
    const n = Number(text(/(\d+) calendar days/));
    assert.equal(n, windowLen);
  });
});

describe('captions', () => {
  it('cumulative chart caption states the right window length', () => {
    const n = Number(text(/over the (\d+)-day window/));
    assert.equal(n, windowLen, `caption says ${n}-day window; data covers ${windowLen} days`);
  });

  it('"N market holidays" wording = NYSE holidays inside the data window', () => {
    const n = Number(text(/weekends \+ (\d+) market holidays/));
    const inWindow = NYSE_HOLIDAYS_2026.map(parseIso).filter((d) => d >= firstDay && d <= lastDay);
    assert.equal(n, inWindow.length, `page says ${n}; in window: ${inWindow.map((d) => d.toISOString().slice(0, 10))}`);
  });

  it('gantt caption: same-day sessions are separated by more than 45 minutes', () => {
    const gaps = Object.values(groupBy(DATA.gantt, (g) => g.date))
      .flatMap((day) => day.slice(1).map((g, i) => ({ date: g.date, at: g.start_clock, gapMin: (g.start_h - day[i].start_h - day[i].duration_h) * 60 })))
      .filter((x) => x.gapMin <= 45);
    assert.deepEqual(gaps.map((x) => [x.date, x.at, +x.gapMin.toFixed(1)]), []);
  });

  it('off-hours definition (before 8 AM / from 7 PM) is used consistently in the chart code', () => {
    const hours = scriptSection(HTML, '// ---- 3)', '// ---- 4)');
    const gantt = scriptSection(HTML, '// ---- 4)', '// ---- 5)');
    assert.match(hours, /i < 8 \|\| i >= 19/);
    assert.match(hours, /x0: -0\.5, x1: 7\.5/);
    assert.match(hours, /x0: 18\.5, x1: 23\.5/);
    assert.match(gantt, /x0: 0,\s+x1: 8,/);
    assert.match(gantt, /x0: 19, x1: 24,/);
  });
});

describe('chart settings do not hide data', () => {
  it('daily chart y-axis range is tall enough for the longest day', () => {
    const daily = scriptSection(HTML, '// ---- 1)', '// ---- 2)');
    const top = Number((daily.match(/title: 'Active Hours', range: \[0, (\d+(?:\.\d+)?)\]/) || [])[1]);
    const clipped = rows.filter((r) => r.hrs > top);
    assert.equal(clipped.length, 0, `y-axis stops at ${top} hrs; ${clipped.length} bars are cut off (max ${Math.max(...rows.map((r) => r.hrs))})`);
  });

  it('gantt x-axis covers the full 0-24 hour day', () => {
    assert.match(scriptSection(HTML, '// ---- 4)', '// ---- 5)'), /range: \[0, 24\]/);
  });
});

describe('page wiring', () => {
  it('index.html redirects to dashboard.html', () => {
    assert.match(readHtml(INDEX_PATH), /http-equiv="refresh" content="0; url=dashboard\.html"/);
  });

  it('Plotly is loaded from a pinned, exact version', () => {
    assert.match(HTML, /<script src="https:\/\/cdn\.plot\.ly\/plotly-\d+\.\d+\.\d+\.min\.js"><\/script>/);
  });

  it('every element the script writes to or plots into exists in the HTML', () => {
    const ids = [...HTML.matchAll(/getElementById\('([^']+)'\)|Plotly\.newPlot\('([^']+)'/g)].map((m) => m[1] || m[2]);
    const missing = [...new Set(ids)].filter((id) => !HTML.includes(`id="${id}"`));
    assert.deepEqual(missing, []);
  });

  it('every chart container on the page gets plotted', () => {
    const containers = [...HTML.matchAll(/<div id="([^"]+)" (?:class="chart-[a-z]+"|style="height)/g)].map((m) => m[1]);
    const plotted = new Set([...HTML.matchAll(/Plotly\.newPlot\('([^']+)'/g)].map((m) => m[1]));
    assert.deepEqual(containers.filter((id) => !plotted.has(id)), []);
    assert.equal(containers.length, 9);
  });
});

