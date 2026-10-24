// 04 - Forensic plausibility.
// These numbers are internally consistent but would be hard to defend as *human*
// working time. Each failure lists the exact days/sessions an opposing expert
// would point to. A failure here means "review before relying on it", not "the
// math is wrong".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, dailyRows, parseIso, toIso, addDays } from './lib/data.mjs';

const rows = dailyRows();
const show = (xs, n = 10) => JSON.stringify(xs.slice(0, n)) + (xs.length > n ? ` ... (+${xs.length - n} more)` : '');

// Thresholds. Change these if counsel / your expert settles on different limits.
const MAX_HUMAN_DAY_HRS = 20;
const MAX_HUMAN_SESSION_HRS = 16;
const MIN_WORKED_DAY_MIN = 15;

describe('human-plausible workload', () => {
  it(`no day credits more than ${MAX_HUMAN_DAY_HRS} active hours`, () => {
    const bad = rows.filter((r) => r.hrs > MAX_HUMAN_DAY_HRS).map((r) => [r.date, r.dow, r.hrs]);
    assert.deepEqual(bad, [],
      `${bad.length} days exceed ${MAX_HUMAN_DAY_HRS} hrs (near-24-hr days usually mean automated events ` +
      `such as mail sync or browser background activity kept a "session" alive): ${show(bad)}`);
  });

  it(`no single session runs longer than ${MAX_HUMAN_SESSION_HRS} hours (KPI longest_session_hrs)`, () => {
    assert.ok(DATA.kpi.longest_session_hrs <= MAX_HUMAN_SESSION_HRS,
      `longest_session_hrs = ${DATA.kpi.longest_session_hrs} hrs (${(DATA.kpi.longest_session_hrs / 24).toFixed(1)} days with no 45-minute break)`);
  });

  it('no run of consecutive full-day (00:00-24:00) gantt rows', () => {
    const fullDays = DATA.gantt.filter((g) => g.start_h < 1e-3 && g.duration_h > 23.999).map((g) => g.date);
    const runs = fullDays.filter((d) => fullDays.includes(toIso(addDays(parseIso(d), -1))));
    assert.deepEqual(runs, [], `${fullDays.length} days are one unbroken 24-hr session: ${show(fullDays)}`);
  });
});

describe('"non-business days worked" is backed by real activity', () => {
  it(`every non-business day counted as worked has at least ${MIN_WORKED_DAY_MIN} active minutes`, () => {
    const bad = rows
      .filter((r) => r.weekend && r.hrs * 60 < MIN_WORKED_DAY_MIN)
      .map((r) => [r.date, r.dow, `${Math.round(r.hrs * 60)} min`, `${r.first}-${r.last}`]);
    assert.deepEqual(bad, [],
      `${bad.length} of the ${DATA.kpi.weekend_days} "worked" non-business days have under ${MIN_WORKED_DAY_MIN} min ` +
      `of activity (some are a single timestamp): ${show(bad, 12)}`);
  });
});

describe('off-hours accounting', () => {
  it('on non-business days, all active time counts as off-hours (as the headline states)', () => {
    const bad = rows.filter((r) => r.weekend && Math.abs(r.offMin - r.hrs * 60) > 1.5).map((r) => [r.date, r.offMin, r.hrs]);
    assert.deepEqual(bad, []);
  });

  it('on business days, off-hours time is never more than the time outside 08:00-19:00 the day could hold', () => {
    // Before 8 AM: at most (8 - first event); after 7 PM: at most (last event - 19).
    const toH = (s) => s.split(':').map(Number).reduce((h, v, i) => h + v / 60 ** i, 0);
    const cap = (r) => (Math.max(0, 8 - toH(r.first)) + Math.max(0, toH(r.last) - 19)) * 60;
    const bad = rows.filter((r) => !r.weekend && r.offMin > cap(r) + 1).map((r) => [r.date, r.offMin, Math.round(cap(r))]);
    assert.deepEqual(bad, [], show(bad));
  });
});
