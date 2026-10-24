// 01 - Shape and sanity of the embedded DATA block.
// If these fail, nothing downstream can be trusted: arrays are misaligned,
// values are the wrong type, or numbers are physically impossible.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA, dailyRows, unique, isSortedAsc, parseIso, toIso, dowName, isValidClock, clockToHours, range,
} from './lib/data.mjs';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isNonNegInt = (x) => Number.isInteger(x) && x >= 0;
const show = (xs, n = 8) => JSON.stringify(xs.slice(0, n)) + (xs.length > n ? ` ... (+${xs.length - n} more)` : '');

describe('top-level structure', () => {
  it('has every section the page script reads', () => {
    const expected = ['kpi', 'daily', 'heatmap', 'hour_totals', 'dow_avg', 'sources', 'weekly', 'cumulative', 'top10', 'gantt'];
    assert.deepEqual(expected.filter((k) => !(k in DATA)), []);
  });

  it('has every KPI field the page script reads', () => {
    const expected = ['avg_per_week', 'avg_per_day', 'median_per_day', 'total_hrs', 'off_pct', 'weekend_days',
      'non_business_total', 'longest_hrs', 'longest_date', 'n_events', 'n_sessions', 'pct_above_40'];
    assert.deepEqual(expected.filter((k) => !(k in DATA.kpi)), []);
  });

  it('every numeric KPI is a finite, non-negative number', () => {
    const bad = Object.entries(DATA.kpi).filter(([k, v]) => k !== 'longest_date' && !(isNum(v) && v >= 0));
    assert.deepEqual(bad, []);
  });
});

describe('daily series', () => {
  const D = DATA.daily;
  const n = D.dates.length;

  it('all parallel arrays are the same length', () => {
    const lengths = Object.fromEntries(Object.entries(D).map(([k, v]) => [k, v.length]));
    assert.deepEqual(unique(Object.values(lengths)), [n], JSON.stringify(lengths));
  });

  it('cumulative series has one point per day', () => assert.equal(DATA.cumulative.length, n));

  it('dates are valid ISO YYYY-MM-DD', () => {
    const bad = D.dates.filter((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d) || toIso(parseIso(d)) !== d);
    assert.deepEqual(bad, []);
  });

  it('dates are strictly increasing (sorted, no duplicates)', () => {
    assert.ok(isSortedAsc(D.dates), 'dates not sorted');
    assert.equal(unique(D.dates).length, n, 'duplicate dates');
  });

  it('day-of-week label matches the calendar for every date', () => {
    const bad = dailyRows().filter((r) => dowName(parseIso(r.date)) !== r.dow).map((r) => [r.date, r.dow]);
    assert.deepEqual(bad, []);
  });

  it('weekend flags are booleans', () => assert.ok(D.weekend.every((w) => typeof w === 'boolean')));

  it('active hours are between 0 and 24', () => {
    const bad = dailyRows().filter((r) => !(isNum(r.hrs) && r.hrs >= 0 && r.hrs <= 24)).map((r) => [r.date, r.hrs]);
    assert.deepEqual(bad, []);
  });

  it('first/last event times are valid HH:MM:SS clocks', () => {
    const bad = dailyRows().filter((r) => !isValidClock(r.first) || !isValidClock(r.last)).map((r) => [r.date, r.first, r.last]);
    assert.deepEqual(bad, []);
  });

  it('first event is not after last event', () => {
    const bad = dailyRows().filter((r) => r.first > r.last).map((r) => [r.date, r.first, r.last]);
    assert.deepEqual(bad, []);
  });

  it('span_hrs equals last_event minus first_event (to 0.01 hr)', () => {
    const bad = dailyRows()
      .map((r) => ({ ...r, calc: clockToHours(r.last) - clockToHours(r.first) }))
      .filter((r) => Math.abs(r.calc - r.span) > 0.01)
      .map((r) => [r.date, r.span, +r.calc.toFixed(3)]);
    assert.deepEqual(bad, [], show(bad));
  });

  it('active hours never exceed the first-to-last span', () => {
    const bad = dailyRows().filter((r) => r.hrs > r.span + 0.01).map((r) => [r.date, r.hrs, r.span]);
    assert.deepEqual(bad, []);
  });

  it('off-hours minutes are non-negative and never exceed active minutes', () => {
    const bad = dailyRows().filter((r) => r.offMin < 0 || r.offMin > r.hrs * 60 + 1).map((r) => [r.date, r.offMin, r.hrs]);
    assert.deepEqual(bad, []);
  });

  it('a day with active time has at least one session', () => {
    const bad = dailyRows().filter((r) => !isNonNegInt(r.nSessions) || (r.hrs > 0 && r.nSessions === 0)).map((r) => [r.date, r.nSessions]);
    assert.deepEqual(bad, []);
  });
});

describe('heatmap', () => {
  const H = DATA.heatmap;

  it('has 24 rows (hours 0..23) in order', () => {
    assert.equal(H.z.length, 24);
    assert.deepEqual(H.y, range(24));
  });

  it('every row has one column per heatmap date', () => {
    const bad = H.z.map((row, h) => [h, row.length]).filter(([, len]) => len !== H.x.length);
    assert.deepEqual(bad, []);
  });

  it('every cell is a non-negative integer event count', () => {
    const bad = H.z.flatMap((row, h) => row.map((v, c) => [h, H.x[c], v])).filter(([, , v]) => !isNonNegInt(v));
    assert.deepEqual(bad, [], show(bad));
  });
});

describe('other series', () => {
  it('hour_totals has 24 non-negative integers', () => {
    assert.equal(DATA.hour_totals.length, 24);
    assert.ok(DATA.hour_totals.every(isNonNegInt));
  });

  it('dow_avg has 7 non-negative numbers (Mon..Sun)', () => {
    assert.equal(DATA.dow_avg.length, 7);
    assert.ok(DATA.dow_avg.every((v) => isNum(v) && v >= 0));
  });

  it('sources: labels unique, values non-negative integers, arrays aligned', () => {
    const S = DATA.sources;
    assert.equal(S.labels.length, S.values.length);
    assert.equal(unique(S.labels).length, S.labels.length);
    assert.ok(S.values.every(isNonNegInt));
  });

  it('every source has a dedicated pie colour (none fall back to grey #888)', () => {
    const known = ['file', 'git', 'outlook', 'chrome', 'vscode', 'activity'];
    assert.deepEqual(DATA.sources.labels.filter((l) => !known.includes(l)), []);
  });

  it('weekly arrays are aligned and n_days is 1..7', () => {
    const W = DATA.weekly;
    assert.deepEqual(unique([W.dates.length, W.hrs.length, W.n_days.length, W.avg.length]), [W.dates.length]);
    assert.deepEqual(W.n_days.filter((d) => !(Number.isInteger(d) && d >= 1 && d <= 7)), []);
  });

  it('top10 arrays all have exactly 10 entries', () => {
    const T = DATA.top10;
    assert.deepEqual(Object.fromEntries(Object.entries(T).map(([k, v]) => [k, v.length])),
      { labels: 10, hrs: 10, weekend: 10, first: 10, last: 10 });
  });
});

describe('gantt sessions', () => {
  const G = DATA.gantt;

  it('every row has the expected fields with sane types', () => {
    const bad = G.filter((g) => !(typeof g.date === 'string' && isNum(g.start_h) && isNum(g.duration_h)
      && isNonNegInt(g.events) && isValidClock(g.start_clock) && (isValidClock(g.end_clock) || g.end_clock === '24:00')));
    assert.deepEqual(bad, []);
  });

  it('every session starts in [0,24), has non-negative length and ends by midnight', () => {
    const bad = G.filter((g) => g.start_h < 0 || g.start_h >= 24 || g.duration_h < 0 || g.start_h + g.duration_h > 24.001);
    assert.deepEqual(bad, [], show(bad));
  });

  it('every session has at least one event (a midnight continuation row may carry 0)', () => {
    const isContinuation = (g, i) => i > 0 && g.start_h < 1e-3 && G[i - 1].start_h + G[i - 1].duration_h > 23.999;
    assert.deepEqual(G.filter((g, i) => g.events < 1 && !isContinuation(g, i)), []);
  });

  it('start_clock matches start_h (to the minute)', () => {
    const bad = G.filter((g) => Math.abs(clockToHours(g.start_clock) - g.start_h) > 1 / 60 + 1e-9);
    assert.deepEqual(bad, [], show(bad));
  });

  it('end_clock matches start_h + duration_h (to ~1 minute)', () => {
    const endH = (g) => clockToHours(g.end_clock); // '24:00' parses to 24
    const bad = G.filter((g) => Math.abs(endH(g) - (g.start_h + g.duration_h)) > 1.5 / 60);
    assert.deepEqual(bad, [], show(bad));
  });

  it('rows are sorted by date then start time', () => {
    const keys = G.map((g) => `${g.date} ${g.start_h.toFixed(4).padStart(8, '0')}`);
    assert.ok(isSortedAsc(keys));
  });

  it('sessions on the same date never overlap', () => {
    const bad = G.slice(1)
      .map((g, i) => [G[i], g])
      .filter(([a, b]) => a.date === b.date && a.start_h + a.duration_h > b.start_h + 1e-3)
      .map(([a, b]) => [a.date, a.start_clock, a.end_clock, b.start_clock]);
    assert.deepEqual(bad, []);
  });
});
