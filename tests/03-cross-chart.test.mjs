// 03 - Each chart's data must agree with the daily series and with the other charts.
// Two charts showing different numbers for the same day is an internal contradiction
// in the exhibit.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA, dailyRows, sum, mean, round, parseIso, toIso, isoMonday, monDay, dowName, groupBy, calendarDays,
  isNonBusinessDay, isWeekend, clockToHours, range, zip,
} from './lib/data.mjs';

const rows = dailyRows();
const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
const firstDay = parseIso(rows[0].date);
const lastDay = parseIso(rows.at(-1).date);
const show = (xs, n = 8) => JSON.stringify(xs.slice(0, n)) + (xs.length > n ? ` ... (+${xs.length - n} more)` : '');

describe('cumulative chart', () => {
  it('each point = running sum of daily hours (to 0.1)', () => {
    const running = rows.reduce((acc, r) => [...acc, (acc.at(-1) || 0) + r.hrs], []);
    const bad = zip(rows.map((r) => r.date), running, DATA.cumulative)
      .filter(([, calc, shown]) => Math.abs(calc - shown) > 0.06)
      .map(([d, calc, shown]) => [d, +calc.toFixed(2), shown]);
    assert.deepEqual(bad, []);
  });

  it('never decreases', () => {
    assert.ok(DATA.cumulative.every((v, i) => i === 0 || v >= DATA.cumulative[i - 1]));
  });
});

describe('weekend / holiday flags', () => {
  it('every Saturday and Sunday is flagged', () => {
    const bad = rows.filter((r) => isWeekend(parseIso(r.date)) && !r.weekend).map((r) => r.date);
    assert.deepEqual(bad, []);
  });

  it('flags = weekends + NYSE holidays, nothing else', () => {
    const bad = rows.filter((r) => r.weekend !== isNonBusinessDay(parseIso(r.date))).map((r) => [r.date, r.dow, r.weekend]);
    assert.deepEqual(bad, []);
  });
});

describe('day-of-week averages', () => {
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const groups = groupBy(rows, (r) => r.dow);

  it('each bar = mean active hours of that weekday over days with activity (2 dp)', () => {
    assert.deepEqual(DATA.dow_avg, order.map((d) => round(mean(groups[d].map((r) => r.hrs)), 2)));
  });
});

describe('heatmap', () => {
  const H = DATA.heatmap;
  const column = (c) => H.z.map((row) => row[c]);

  it('x-axis dates = daily dates', () => assert.deepEqual(H.x, DATA.daily.dates));

  it('hour_totals[h] = sum of heatmap row h', () => {
    assert.deepEqual(DATA.hour_totals, H.z.map(sum));
  });

  it('every day with active time has at least one event in the heatmap', () => {
    const bad = H.x.filter((d, c) => byDate[d].hrs > 0 && sum(column(c)) === 0);
    assert.deepEqual(bad, []);
  });

  it('no events are recorded before the first event hour or after the last event hour', () => {
    const bad = H.x.flatMap((d, c) => column(c)
      .map((v, h) => [d, h, v])
      .filter(([, h, v]) => v > 0 && (h < Math.floor(clockToHours(byDate[d].first)) || h > Math.floor(clockToHours(byDate[d].last)))));
    assert.deepEqual(bad, [], show(bad));
  });

  it('the hour of the first and last event each show at least one event', () => {
    const bad = H.x.filter((d, c) => {
      const col = column(c);
      return col[Math.floor(clockToHours(byDate[d].first))] === 0 || col[Math.floor(clockToHours(byDate[d].last))] === 0;
    });
    assert.deepEqual(bad, []);
  });
});

describe('weekly totals', () => {
  const W = DATA.weekly;
  const byWeek = groupBy(rows, (r) => toIso(isoMonday(parseIso(r.date))));
  const mondays = Object.keys(byWeek).sort();

  it('one bar per ISO week touched by the data, in order', () => {
    assert.deepEqual(W.dates, mondays.map((m) => monDay(parseIso(m))));
  });

  it('each bar = sum of that week\'s daily hours (to 0.1)', () => {
    const bad = zip(mondays, W.hrs)
      .map(([m, shown]) => [m, shown, round(sum(byWeek[m].map((r) => r.hrs)), 1)])
      .filter(([, shown, calc]) => Math.abs(shown - calc) > 0.11); // allow for rounding of the 2-dp daily values
    assert.deepEqual(bad, []);
  });

  it('n_days = number of days with activity in that week', () => {
    assert.deepEqual(W.n_days, mondays.map((m) => byWeek[m].length));
  });

  it('avg = week hours / n_days (2 dp)', () => {
    const bad = zip(mondays, W.avg)
      .map(([m, shown]) => [m, shown, round(sum(byWeek[m].map((r) => r.hrs)) / byWeek[m].length, 2)])
      .filter(([, shown, calc]) => Math.abs(shown - calc) > 0.011);
    assert.deepEqual(bad, []);
  });

  it('grey "partial" bars are exactly the weeks cut off by the window edges (as the chart caption says)', () => {
    const calendarPartial = mondays.map((m) => parseIso(m) < firstDay || calendarDays(parseIso(m), lastDay).length < 7);
    const shownPartial = W.n_days.map((n) => n !== 7);
    const bad = zip(W.dates, calendarPartial, shownPartial)
      .filter(([, cal, shown]) => cal !== shown)
      .map(([d, cal, shown]) => `${d}: shown ${shown ? 'grey' : 'blue'}, should be ${cal ? 'grey' : 'blue'}`);
    assert.deepEqual(bad, []);
  });
});

describe('top 10 longest days', () => {
  const T = DATA.top10;
  const label = (r) => `${r.dow} ${monDay(parseIso(r.date))}`;
  const top = [...rows].sort((a, b) => b.hrs - a.hrs).slice(0, 10);
  const byLabel = Object.fromEntries(rows.map((r) => [label(r), r]));
  const entries = T.labels.map((l, i) => ({ label: l, hrs: T.hrs[i], weekend: T.weekend[i], first: T.first[i], last: T.last[i], day: byLabel[l] }));

  it('every label names a real day in the series', () => {
    assert.deepEqual(entries.filter((e) => !e.day).map((e) => e.label), []);
  });

  it('lists exactly the ten highest-hour days', () => {
    assert.deepEqual([...T.labels].sort(), top.map(label).sort());
  });

  it('is ordered shortest-first (so the longest sits at the top of the horizontal chart)', () => {
    assert.ok(entries.every((e, i) => i === 0 || e.day.hrs >= entries[i - 1].day.hrs));
  });

  it('hours match the daily series (to 0.05)', () => {
    assert.deepEqual(entries.filter((e) => Math.abs(e.hrs - e.day.hrs) > 0.051).map((e) => [e.label, e.hrs, e.day.hrs]), []);
  });

  it('weekend colour flags match the daily series', () => {
    assert.deepEqual(entries.filter((e) => e.weekend !== e.day.weekend).map((e) => e.label), []);
  });

  it('first/last event times match the daily series', () => {
    assert.deepEqual(entries.filter((e) => e.first !== e.day.first || e.last !== e.day.last).map((e) => e.label), []);
  });
});

describe('gantt vs daily series', () => {
  const G = DATA.gantt;
  const gByDate = groupBy(G, (g) => g.date);

  it('every gantt date is a day in the daily series', () => {
    assert.deepEqual(Object.keys(gByDate).filter((d) => !byDate[d]), []);
  });

  it('every day with active time has gantt sessions', () => {
    assert.deepEqual(rows.filter((r) => r.hrs > 0 && !gByDate[r.date]).map((r) => r.date), []);
  });

  it('sum of session lengths on a day = that day\'s active hours (to 0.05 hr)', () => {
    const bad = rows
      .map((r) => [r.date, r.hrs, round(sum((gByDate[r.date] || []).map((g) => g.duration_h)), 2)])
      .filter(([, hrs, g]) => Math.abs(hrs - g) > 0.05);
    assert.deepEqual(bad, [], `${bad.length} days disagree [date, daily, gantt]: ${show(bad)}`);
  });

  it('number of gantt bars on a day = that day\'s session count', () => {
    const bad = rows
      .map((r) => [r.date, r.nSessions, (gByDate[r.date] || []).length])
      .filter(([, n, g]) => n !== g);
    assert.deepEqual(bad, [], `${bad.length} days disagree [date, daily, gantt]: ${show(bad)}`);
  });

  // A row that starts at 00:00 is the tail of a session carried over from the night
  // before, and a row that ends at 24:00 carries on into the next day; neither has
  // to line up with an event time.
  it('first gantt session starts at the day\'s first event (to 2 min), unless carried over from midnight', () => {
    const bad = rows
      .map((r) => [r.date, r.first, (gByDate[r.date] || [])[0]])
      .filter(([, , g]) => !g || g.start_h > 1e-3)
      .filter(([, first, g]) => !g || Math.abs(g.start_h - clockToHours(first)) > 2 / 60)
      .map(([d, first, g]) => [d, first, g && g.start_clock]);
    assert.deepEqual(bad, [], `${bad.length} days disagree [date, first_event, first gantt start]: ${show(bad)}`);
  });

  it('last gantt session ends at the day\'s last event (to 2 min), unless it runs on past midnight', () => {
    const bad = rows
      .map((r) => [r.date, r.last, (gByDate[r.date] || []).at(-1)])
      .filter(([, , g]) => !g || g.start_h + g.duration_h < 23.999)
      .filter(([, last, g]) => !g || Math.abs(g.start_h + g.duration_h - clockToHours(last)) > 2 / 60)
      .map(([d, last, g]) => [d, last, g && g.end_clock]);
    assert.deepEqual(bad, [], `${bad.length} days disagree [date, last_event, last gantt end]: ${show(bad)}`);
  });

  it('gantt event counts add up to the total event count', () => {
    assert.equal(sum(G.map((g) => g.events)), DATA.kpi.n_events,
      'a session split at midnight should not have its events counted again on each day');
  });

  it('events per day in the gantt = events per day in the heatmap', () => {
    const bad = DATA.heatmap.x
      .map((d, c) => [d, sum(DATA.heatmap.z.map((row) => row[c])), sum((gByDate[d] || []).map((g) => g.events))])
      .filter(([, hm, g]) => hm !== g);
    assert.deepEqual(bad, [], `${bad.length} days disagree [date, heatmap, gantt]: ${show(bad)}`);
  });

  it('every clock hour fully covered by a session has at least one event in the heatmap', () => {
    // Sessions are events no more than 45 minutes apart, so a session cannot
    // cover a whole 60-minute hour that contains zero events.
    const bad = G.flatMap((g) => {
      const c = DATA.heatmap.x.indexOf(g.date);
      return range(24)
        .filter((h) => h >= g.start_h && h + 1 <= g.start_h + g.duration_h + 1e-9)
        .filter((h) => DATA.heatmap.z[h][c] === 0)
        .map((h) => [g.date, `${g.start_clock}-${g.end_clock}`, `empty hour ${h}:00`]);
    });
    assert.deepEqual(bad, [], `${bad.length} covered-but-empty hours: ${show(bad)}`);
  });
});
