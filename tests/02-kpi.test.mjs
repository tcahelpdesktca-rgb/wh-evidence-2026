// 02 - Every headline KPI recomputed from the underlying daily / event data.
// A KPI card that can't be reproduced from the data next to it is the first
// thing an opposing expert will attack.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA, dailyRows, sum, mean, median, round, parseIso, calendarDays, isNonBusinessDay, isoMonday, toIso,
  groupBy, monDay, dowName,
} from './lib/data.mjs';

const K = DATA.kpi;
const rows = dailyRows();
const totalHrs = sum(rows.map((r) => r.hrs));
const firstDay = parseIso(rows[0].date);
const lastDay = parseIso(rows.at(-1).date);
const windowDays = calendarDays(firstDay, lastDay);

// Re-join gantt rows that were split at midnight: a row starting at 00:00 right after
// a row on the previous date that ran to 24:00 is the same session.
const joinedSessions = DATA.gantt.reduce((acc, g) => {
  const prev = acc.at(-1);
  const continues = prev && g.start_h < 1e-3 && prev.endsAtMidnight
    && toIso(new Date(parseIso(prev.lastDate).getTime() + 86_400_000)) === g.date;
  const piece = { lastDate: g.date, endsAtMidnight: g.start_h + g.duration_h > 23.999 };
  return continues
    ? [...acc.slice(0, -1), { ...prev, ...piece, hours: prev.hours + g.duration_h }]
    : [...acc, { firstDate: g.date, ...piece, hours: g.duration_h }];
}, []);

describe('totals', () => {
  it('total_hrs = sum of daily active hours (rounded to whole hours)', () => {
    assert.equal(K.total_hrs, round(totalHrs));
  });

  it('final cumulative point = total hours', () => {
    assert.ok(Math.abs(DATA.cumulative.at(-1) - totalHrs) < 0.1, `${DATA.cumulative.at(-1)} vs ${totalHrs}`);
  });

  it('n_events = sum of source counts', () => {
    assert.equal(K.n_events, sum(DATA.sources.values));
  });

  it('n_events = sum of every heatmap cell', () => {
    assert.equal(K.n_events, sum(DATA.heatmap.z.flat()));
  });

  it('n_events = sum of hour-of-day totals', () => {
    assert.equal(K.n_events, sum(DATA.hour_totals));
  });
});

describe('per-day averages', () => {
  it('avg_per_day = mean active hours over days with activity (1 dp)', () => {
    assert.equal(K.avg_per_day, round(mean(rows.map((r) => r.hrs)), 1));
  });

  it('median_per_day = median active hours (1 dp)', () => {
    assert.equal(K.median_per_day, round(median(rows.map((r) => r.hrs)), 1));
  });

  it('off_pct = off-hours minutes / active minutes (1 dp)', () => {
    assert.equal(K.off_pct, round((sum(rows.map((r) => r.offMin)) / (totalHrs * 60)) * 100, 1));
  });
});

describe('weekly average', () => {
  // A "complete" week = all 7 calendar days fall inside the analysis window,
  // whether or not every day had activity. Weeks are ISO (Mon-Sun).
  const byWeek = groupBy(rows, (r) => toIso(isoMonday(parseIso(r.date))));
  const completeWeeks = Object.entries(byWeek)
    .filter(([monday]) => parseIso(monday) >= firstDay && calendarDays(parseIso(monday), lastDay).length >= 7)
    .map(([monday, days]) => ({ monday, hrs: sum(days.map((d) => d.hrs)) }));

  it('avg_per_week = mean of calendar-complete ISO weeks (1 dp)', () => {
    const expected = round(mean(completeWeeks.map((w) => w.hrs)), 1);
    assert.equal(K.avg_per_week, expected,
      `KPI shows ${K.avg_per_week}; the ${completeWeeks.length} complete weeks average ${expected}. ` +
      `(${K.avg_per_week} is what you get by keeping only weeks with activity on all 7 days, which drops ` +
      'lighter weeks just because a weekend day was empty.)');
  });

  it('avg_per_week is consistent with total hours / calendar weeks in the window (within 10%)', () => {
    const perCalendarWeek = (totalHrs / windowDays.length) * 7;
    assert.ok(Math.abs(K.avg_per_week - perCalendarWeek) / perCalendarWeek <= 0.10,
      `KPI ${K.avg_per_week} vs ${perCalendarWeek.toFixed(1)} (= ${round(totalHrs)} hrs / ${windowDays.length} days x 7)`);
  });

  it('pct_above_40 = (avg_per_week / 40 - 1) as a whole percent', () => {
    assert.equal(K.pct_above_40, round((K.avg_per_week / 40 - 1) * 100));
  });
});

describe('longest day', () => {
  const longest = rows.reduce((a, b) => (b.hrs > a.hrs ? b : a));

  it('longest_hrs = max daily active hours (1 dp)', () => {
    assert.equal(K.longest_hrs, round(longest.hrs, 1));
  });

  it('longest_date names that day as "Mon DD (Dow)"', () => {
    const d = parseIso(longest.date);
    assert.equal(K.longest_date, `${monDay(d)} (${dowName(d)})`);
  });
});

describe('non-business days', () => {
  it('weekend_days = days flagged non-business that have activity', () => {
    assert.equal(K.weekend_days, rows.filter((r) => r.weekend && r.hrs > 0).length);
  });

  it('non_business_total = weekends + NYSE holidays between first and last data date', () => {
    assert.equal(K.non_business_total, windowDays.filter(isNonBusinessDay).length);
  });

  it('weekend_days does not exceed non_business_total', () => {
    assert.ok(K.weekend_days <= K.non_business_total);
  });
});

describe('sessions', () => {
  it('n_sessions = sum of per-day session counts', () => {
    assert.equal(K.n_sessions, sum(rows.map((r) => r.nSessions)));
  });

  it('n_sessions = number of gantt sessions after re-joining midnight splits', () => {
    assert.equal(K.n_sessions, joinedSessions.length);
  });

  it('longest_session_hrs = longest re-joined gantt session (1 dp)', () => {
    const longest = Math.max(...joinedSessions.map((s) => s.hours));
    assert.ok(Math.abs(K.longest_session_hrs - longest) <= 0.1, `${K.longest_session_hrs} vs ${longest.toFixed(2)}`);
  });
});
