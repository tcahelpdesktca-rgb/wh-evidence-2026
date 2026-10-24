"""Positive control: build a dashboard whose numbers are correct by construction.

Generates synthetic raw timestamps, applies the methodology the page describes
(45-minute session gap, off-hours = before 8 AM / from 7 PM or any time on a
non-business day, midnight splits), and writes a copy of dashboard.html with that
DATA and corrected wording. If the test suite flags this copy, the test is wrong,
not the data. Written independently of the JS suite (different language, no shared code).
"""
import json, random, re, statistics, sys
from datetime import date, datetime, timedelta
from itertools import groupby, accumulate

SRC, OUT = sys.argv[1], sys.argv[2]
rng = random.Random(20260101)
START, END = date(2026, 1, 2), date(2026, 5, 18)
HOLIDAYS = {date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3)}
GAP = timedelta(minutes=45)
SOURCES = ['activity', 'chrome', 'file', 'git', 'outlook', 'vscode']

days = [START + timedelta(i) for i in range((END - START).days + 1)]
non_business = lambda d: d.weekday() >= 5 or d in HOLIDAYS

def day_events(d):
    """A busy but human day: a morning block, an afternoon block, sometimes a late block across midnight."""
    def block(start_h, length_h, n):
        t0 = datetime(d.year, d.month, d.day) + timedelta(hours=start_h)
        steps = [timedelta(minutes=rng.uniform(1, 30)) for _ in range(n)]
        return [t for t in accumulate(steps, initial=t0) if t <= t0 + timedelta(hours=length_h)]
    if non_business(d):
        return block(rng.uniform(9, 14), rng.uniform(0.5, 3), 30)
    late = block(23.2, 1.5, 12) if rng.random() < 0.15 else []
    return block(rng.uniform(6.5, 8.5), rng.uniform(3, 5), 60) + block(rng.uniform(13, 14), rng.uniform(3, 5), 60) + late

events = sorted(t for d in days for t in day_events(d) if START <= t.date() <= END)
event_src = {t: rng.choice(SOURCES) for t in events}

# --- sessions: consecutive events no more than 45 minutes apart ---
def split_sessions(ts):
    breaks = [0] + [i for i in range(1, len(ts)) if ts[i] - ts[i - 1] > GAP] + [len(ts)]
    return [ts[a:b] for a, b in zip(breaks, breaks[1:])]
sessions = split_sessions(events)

# --- cut each session at midnight into per-day pieces ---
def pieces(sess):
    by_day = [(d, list(g)) for d, g in groupby(sess, key=lambda t: t.date())]
    def piece(i, d, evs):
        start = evs[0] if i == 0 else datetime(d.year, d.month, d.day)
        end = evs[-1] if i == len(by_day) - 1 else datetime(d.year, d.month, d.day) + timedelta(days=1)
        return {'date': d, 'start': start, 'end': end, 'events': len(evs)}
    return [piece(i, d, evs) for i, (d, evs) in enumerate(by_day)]
rows = [p for s in sessions for p in pieces(s)]

hours_of = lambda dt: dt.hour + dt.minute / 60 + dt.second / 3600
def secs_outside_business(p):
    if non_business(p['date']):
        return (p['end'] - p['start']).total_seconds()
    base = datetime(p['date'].year, p['date'].month, p['date'].day)
    b0, b1 = base + timedelta(hours=8), base + timedelta(hours=19)
    inside = max(timedelta(0), min(p['end'], b1) - max(p['start'], b0)).total_seconds()
    return (p['end'] - p['start']).total_seconds() - inside

active_days = sorted({t.date() for t in events})
evs_on = {d: [t for t in events if t.date() == d] for d in active_days}
rows_on = {d: [p for p in rows if p['date'] == d] for d in active_days}
hrs = {d: round(sum((p['end'] - p['start']).total_seconds() for p in rows_on[d]) / 3600, 2) for d in active_days}
DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
clock = lambda t: t.strftime('%H:%M:%S')

daily = {
    'dates': [d.isoformat() for d in active_days],
    'hrs': [hrs[d] for d in active_days],
    'weekend': [non_business(d) for d in active_days],
    'first_event': [clock(evs_on[d][0]) for d in active_days],
    'last_event': [clock(evs_on[d][-1]) for d in active_days],
    'off_min': [round(sum(secs_outside_business(p) for p in rows_on[d]) / 60, 1) for d in active_days],
    'dow': [DOW[d.weekday()] for d in active_days],
    'span_hrs': [round((evs_on[d][-1] - evs_on[d][0]).total_seconds() / 3600, 2) for d in active_days],
    'n_sessions': [len(rows_on[d]) for d in active_days],
}
z = [[sum(1 for t in evs_on[d] if t.hour == h) for d in active_days] for h in range(24)]

monday = lambda d: d - timedelta(d.weekday())
weeks = [(m, list(g)) for m, g in groupby(active_days, key=monday)]
week_hrs = [round(sum(hrs[d] for d in g), 1) for _, g in weeks]
complete = [sum(hrs[d] for d in g) for m, g in weeks if m >= START and m + timedelta(6) <= END]
avg_week = round(statistics.mean(complete), 1)
longest = max(active_days, key=lambda d: hrs[d])
top = sorted(sorted(active_days, key=lambda d: -hrs[d])[:10], key=lambda d: hrs[d])
label = lambda d: f"{DOW[d.weekday()]} {d.strftime('%b %d')}"
total = sum(hrs.values())
fmt_h = lambda t: f'{t.hour:02d}:{t.minute:02d}'

data = {
    'kpi': {
        'avg_per_week': avg_week, 'avg_per_day': round(statistics.mean(hrs.values()), 1),
        'median_per_day': round(statistics.median(hrs.values()), 1), 'total_hrs': round(total),
        'off_pct': round(sum(daily['off_min']) / (total * 60) * 100, 1),
        'weekend_days': sum(1 for d in active_days if non_business(d) and hrs[d] > 0),
        'non_business_total': sum(1 for d in days if non_business(d)),
        'longest_hrs': round(hrs[longest], 1), 'longest_date': f"{longest.strftime('%b %d')} ({DOW[longest.weekday()]})",
        'longest_session_hrs': round(max((s[-1] - s[0]).total_seconds() for s in sessions) / 3600, 1),
        'n_events': len(events), 'n_sessions': len(sessions), 'pct_above_40': round((avg_week / 40 - 1) * 100),
    },
    'daily': daily,
    'heatmap': {'z': z, 'x': daily['dates'], 'y': list(range(24))},
    'hour_totals': [sum(r) for r in z],
    'dow_avg': [round(statistics.mean(hrs[d] for d in active_days if d.weekday() == i), 2) for i in range(7)],
    'sources': {'labels': SOURCES, 'values': [sum(1 for t in events if event_src[t] == s) for s in SOURCES]},
    'weekly': {'dates': [m.strftime('%b %d') for m, _ in weeks], 'hrs': week_hrs,
               'n_days': [len(g) for _, g in weeks], 'avg': [round(sum(hrs[d] for d in g) / len(g), 2) for _, g in weeks]},
    'cumulative': [round(c, 1) for c in accumulate(hrs[d] for d in active_days)],
    'top10': {'labels': [label(d) for d in top], 'hrs': [round(hrs[d], 1) for d in top], 'weekend': [non_business(d) for d in top],
              'first': [clock(evs_on[d][0]) for d in top], 'last': [clock(evs_on[d][-1]) for d in top]},
    'gantt': [{'date': p['date'].isoformat(), 'start_h': round(hours_of(p['start']), 3),
               'duration_h': round((p['end'] - p['start']).total_seconds() / 3600, 3), 'events': p['events'],
               'start_clock': fmt_h(p['start']),
               'end_clock': '24:00' if p['end'].date() > p['date'] else fmt_h(p['end'])} for p in rows],
}

html = open(SRC, encoding='utf8').read()
old = re.search(r'const DATA = (\{.*?\});\n', html, re.S).group(1)
n_days = (END - START).days + 1
holidays_in = sum(1 for h in HOLIDAYS if START <= h <= END)
fixes = [
    (old, json.dumps(data)),
    ('Work Hours Dashboard - April 2026', 'Work Hours Dashboard - January to May 2026'),
    ('January 1 - May 18, 2026  &middot;  138 calendar days', f'January 2 - May 18, 2026  &middot;  {n_days} calendar days'),
    ('over the 35-day window', f'over the {n_days}-day window'),
    ('weekends + 4 market holidays', f'weekends + {holidays_in} market holidays'),
    ("title: 'Active Hours', range: [0, 20]", "title: 'Active Hours', range: [0, 24]"),
]
for a, b in fixes:
    assert a in html, a[:60]
    html = html.replace(a, b)
open(OUT, 'w', encoding='utf8').write(html)
print(f'wrote {OUT}: {len(events)} events, {len(sessions)} sessions, {len(rows)} gantt rows, '
      f'{sum(1 for s in sessions if s[0].date() != s[-1].date())} cross midnight, avg/week {avg_week}')
