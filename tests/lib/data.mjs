// Shared helpers for the dashboard test suite.
// Everything here is a pure function: input in, value out, nothing mutated.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DASHBOARD_PATH = join(REPO_ROOT, 'dashboard.html');
export const INDEX_PATH = join(REPO_ROOT, 'index.html');

export const readHtml = (path = DASHBOARD_PATH) => readFileSync(path, 'utf8');

// Pull the `const DATA = {...};` line out of the page and parse it as JSON.
export const extractData = (html) => {
  const match = html.match(/const DATA = (\{.*?\});\n/s);
  if (!match) throw new Error('Could not find `const DATA = {...};` in dashboard.html');
  return JSON.parse(match[1]);
};

export const HTML = readHtml();
export const DATA = extractData(HTML);

// ---------- small numeric helpers ----------
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs) => sum(xs) / xs.length;
export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
export const round = (x, dp = 0) => Math.round(x * 10 ** dp) / 10 ** dp;
export const range = (n) => Array.from({ length: n }, (_, i) => i);
export const zip = (...cols) => range(Math.min(...cols.map((c) => c.length))).map((i) => cols.map((c) => c[i]));
export const unique = (xs) => [...new Set(xs)];
export const groupBy = (xs, keyFn) =>
  xs.reduce((acc, x) => ({ ...acc, [keyFn(x)]: [...(acc[keyFn(x)] || []), x] }), {});
export const isSortedAsc = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] <= x);
export const nearlyEqual = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------- date / time helpers (all UTC so results never depend on the machine's timezone) ----------
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const parseIso = (s) => new Date(`${s}T00:00:00Z`);
export const toIso = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
export const dowName = (d) => DOW[d.getUTCDay()];
export const monDay = (d) => `${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}`;
export const isWeekend = (d) => [0, 6].includes(d.getUTCDay());
export const daysBetweenInclusive = (a, b) => Math.round((b - a) / 86_400_000) + 1;
export const calendarDays = (a, b) => range(daysBetweenInclusive(a, b)).map((i) => addDays(a, i));
// Monday of the ISO week that contains d.
export const isoMonday = (d) => addDays(d, -((d.getUTCDay() + 6) % 7));

// "HH:MM:SS" or "HH:MM" -> decimal hours
export const clockToHours = (s) => {
  const [h, m, sec = 0] = s.split(':').map(Number);
  return h + m / 60 + sec / 3600;
};
export const isValidClock = (s) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);

// NYSE full-day closures that fall in Jan-May 2026 (source: NYSE published holiday calendar).
// Memorial Day (May 25) is outside the window.
export const NYSE_HOLIDAYS_2026 = ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03'];
export const isNonBusinessDay = (d) => isWeekend(d) || NYSE_HOLIDAYS_2026.includes(toIso(d));

// Off-hours as the dashboard defines it: before 8 AM, at/after 7 PM.
export const isOffHour = (h) => h < 8 || h >= 19;

// ---------- derived views of DATA used by several test files ----------
// One object per day instead of parallel arrays - easier to reason about.
export const dailyRows = (data = DATA) =>
  data.daily.dates.map((date, i) => ({
    date,
    hrs: data.daily.hrs[i],
    weekend: data.daily.weekend[i],
    first: data.daily.first_event[i],
    last: data.daily.last_event[i],
    offMin: data.daily.off_min[i],
    dow: data.daily.dow[i],
    span: data.daily.span_hrs[i],
    nSessions: data.daily.n_sessions[i],
  }));

// Find values in a small text snippet of the page script, e.g. the y-axis range of a chart.
export const scriptSection = (html, startMarker, endMarker) => {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  return start < 0 ? '' : html.slice(start, end < 0 ? undefined : end);
};
