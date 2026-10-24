"""Second opinion on dashboard.html, written in Python with no shared code from the JS suite.

Recomputes the disputed figures and writes a per-day CSV you can open in Excel.
Run:  python3 -I tests/cross_check.py            (from the repo root)
      python3 -I tests/cross_check.py other.html  (any copy of the dashboard)
"""
import csv, json, re, statistics, sys
from collections import Counter
from datetime import date, timedelta
from itertools import groupby
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'dashboard.html'
OUT = ROOT / 'tests' / 'reports' / 'day_by_day.csv'
HOLIDAYS = {date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3)}

html = PAGE.read_text(encoding='utf8')
D = json.loads(re.search(r'const DATA = (\{.*?\});\n', html, re.S).group(1))
K, daily = D['kpi'], D['daily']
dates = [date.fromisoformat(s) for s in daily['dates']]
hrs = dict(zip(dates, daily['hrs']))
first, last = dates[0], dates[-1]
window = [first + timedelta(i) for i in range((last - first).days + 1)]
non_business = lambda d: d.weekday() >= 5 or d in HOLIDAYS

gantt_hrs = Counter()
gantt_rows = Counter()
gantt_events = Counter()
for g in D['gantt']:
    d = date.fromisoformat(g['date'])
    gantt_hrs[d] += g['duration_h']
    gantt_rows[d] += 1
    gantt_events[d] += g['events']
col = {d: i for i, d in enumerate(dates)}
heat_events = {d: sum(row[col[d]] for row in D['heatmap']['z']) for d in dates}

monday = lambda d: d - timedelta(d.weekday())
weeks = [(m, [hrs[d] for d in g]) for m, g in groupby(dates, key=monday)]
complete = [sum(h) for m, h in weeks if m >= first and m + timedelta(6) <= last]
y_top = float(re.search(r"title: 'Active Hours', range: \[0, (\d+(?:\.\d+)?)\]", html).group(1))

checks = [
    ('Avg hrs/week shown', K['avg_per_week']),
    ('  mean of calendar-complete weeks', round(statistics.mean(complete), 1)),
    ('  total / calendar days x 7', round(sum(hrs.values()) / len(window) * 7, 1)),
    ('"Non-business days worked" shown', K['weekend_days']),
    ('  ...with any active time', sum(1 for d in dates if non_business(d) and hrs[d] > 0)),
    ('  ...with 15+ active minutes', sum(1 for d in dates if non_business(d) and hrs[d] * 60 >= 15)),
    ('Events shown', K['n_events']),
    ('  events inside gantt sessions', sum(gantt_events.values())),
    ('Gantt hours minus daily hours', round(sum(gantt_hrs.values()) - sum(hrs.values()), 1)),
    ('Days > 20 active hrs', sum(1 for h in hrs.values() if h > 20)),
    ('Longest session (hrs)', K['longest_session_hrs']),
    ('Daily bars cut off by y-axis', sum(1 for h in hrs.values() if h > y_top)),
    ('Calendar days in data window', len(window)),
    ('NYSE holidays in data window', sum(1 for h in HOLIDAYS if first <= h <= last)),
]
width = max(len(k) for k, _ in checks)
print(f'Cross-check of {PAGE.name}\n')
print('\n'.join(f'{k:<{width}}  {v}' for k, v in checks))

flags = lambda d, i: '; '.join(f for f, hit in [
    ('over 20 hrs', hrs[d] > 20),
    ('cut off on chart', hrs[d] > y_top),
    ('non-business day under 15 min', non_business(d) and hrs[d] * 60 < 15),
    ('gantt hours differ', abs(gantt_hrs[d] - hrs[d]) > 0.05),
    ('gantt session count differs', gantt_rows[d] != daily['n_sessions'][i]),
    ('gantt events differ from heatmap', gantt_events[d] != heat_events[d]),
] if hit)

OUT.parent.mkdir(exist_ok=True)
with OUT.open('w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['date', 'dow', 'non_business', 'active_hrs', 'gantt_hrs', 'first_event', 'last_event',
                'off_hours_min', 'sessions_daily', 'sessions_gantt', 'events_heatmap', 'events_gantt', 'flags'])
    w.writerows([d.isoformat(), daily['dow'][i], non_business(d), hrs[d], round(gantt_hrs[d], 2),
                 daily['first_event'][i], daily['last_event'][i], daily['off_min'][i], daily['n_sessions'][i],
                 gantt_rows[d], heat_events[d], gantt_events[d], flags(d, i)] for i, d in enumerate(dates))
print(f'\nWrote {OUT.relative_to(ROOT)} ({len(dates)} days, {sum(1 for i, d in enumerate(dates) if flags(d, i))} flagged)')
