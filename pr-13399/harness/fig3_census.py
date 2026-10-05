#!/usr/bin/env python3
"""Fig 3: main-CI census, slowest requested()-using test per ubuntu Test job."""
import json, math, datetime as dt, html
rows = json.load(open('/root/verify/pr13399/census/census.json'))
for r in rows: r['t'] = dt.datetime.fromisoformat(r['started'].replace('Z', '+00:00'))
rows.sort(key=lambda r: r['t'])
BLUE, GRID, INK, INK2, MUTED, SURF, CRIT, SER = '#2a78d6', '#e4e3df', '#0b0b0b', '#52514e', '#8a8984', '#fcfcfb', '#d03b3b', '#ec835a'
W, H, L, Rm, T, B = 1160, 490, 84, 40, 78, 112
t0 = dt.datetime(2026, 10, 2, 0, 0, tzinfo=dt.timezone.utc); t1 = dt.datetime(2026, 10, 4, 21, 0, tzinfo=dt.timezone.utc)
x = lambda t: L + (W - L - Rm) * (t - t0).total_seconds() / (t1 - t0).total_seconds()
ymin, ymax = 200, 20000
y = lambda v: T + (H - T - B) * (1 - (math.log10(max(v, ymin)) - math.log10(ymin)) / (math.log10(ymax) - math.log10(ymin)))
s = [f'<svg id="fig" width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif">',
     f'<rect width="{W}" height="{H}" fill="{SURF}"/>',
     f'<text x="{L}" y="24" font-size="16" font-weight="600" fill="{INK}">Main CI: the approval tests in hosted-workspace-tool-turn.test.ts across {len(rows)} post-merge ubuntu Test jobs</text>',
     f'<text x="{L}" y="44" font-size="12" fill="{INK2}">Every Qwen Code CI push run on main with a Test (ubuntu-latest) job, 2026-10-02 01:05Z → 10-04 18:25Z (coverage on, --retry=2, 60 s test timeout).</text>',
     f'<text x="{L}" y="60" font-size="12" fill="{INK2}">One dot = the slowest test in that job that calls requested() (vitest lists only tests ≥300 ms; hollow = none listed). Log scale. Duration includes the whole test, not just the wait.</text>']
for v in (300, 1000, 3000, 10000):
    yy = y(v)
    s.append(f'<line x1="{L}" x2="{W-Rm}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{GRID}"/>')
    s.append(f'<text x="{L-8}" y="{yy+4:.1f}" font-size="11.5" fill="{MUTED}" text-anchor="end">{v/1000:g} s</text>')
d = t0
while d <= t1:
    xx = x(d)
    s.append(f'<line x1="{xx:.1f}" x2="{xx:.1f}" y1="{T}" y2="{H-B}" stroke="{GRID}"/>')
    s.append(f'<text x="{xx:.1f}" y="{H-B+18}" font-size="11.5" fill="{MUTED}" text-anchor="middle">{d.strftime("%m-%d %H:%M")}Z</text>')
    d += dt.timedelta(hours=12)
m = dt.datetime(2026, 10, 4, 17, 51, tzinfo=dt.timezone.utc); xm = x(m)
s.append(f'<line x1="{xm:.1f}" x2="{xm:.1f}" y1="{T-4}" y2="{H-B}" stroke="{INK}" stroke-width="1.5" stroke-dasharray="4 3"/>')
s.append(f'<text x="{xm-6:.1f}" y="{y(560):.1f}" font-size="11.5" font-weight="600" fill="{INK}" text-anchor="end">#13380 merged → 5 s</text>')
s.append(f'<text x="{xm-6:.1f}" y="{y(560)+15:.1f}" font-size="11" fill="{INK2}" text-anchor="end">2 jobs since, both green here</text>')
for r in rows:
    xx = x(r['t'])
    flake = r['fails'] or r['retries']
    if r['req_listed'] == 0:
        s.append(f'<circle cx="{xx:.1f}" cy="{y(ymin):.1f}" r="4.5" fill="none" stroke="{BLUE}" stroke-width="1.8"/>')
        continue
    col = CRIT if r['fails'] else (SER if r['retries'] else BLUE)
    s.append(f'<circle cx="{xx:.1f}" cy="{y(r["req_max"]):.1f}" r="{6.5 if flake else 4.5}" fill="{col}" stroke="{SURF}" stroke-width="2"/>')
    if r['fails']:
        ax, ay = x(dt.datetime(2026, 10, 3, 16, 0, tzinfo=dt.timezone.utc)), y(4200)
        s.append(f'<line x1="{ax+4:.1f}" y1="{ay-4:.1f}" x2="{xx-8:.1f}" y2="{y(r["req_max"]):.1f}" stroke="{MUTED}" stroke-width="1"/>')
        s.append(f'<text x="{ax:.1f}" y="{ay-8:.1f}" font-size="11.5" font-weight="700" fill="{INK}" text-anchor="end">✕ #13397 ({r["sha"][:8]}): failed after retry x2, 7.1 s</text>')
        s.append(f'<text x="{ax:.1f}" y="{ay+7:.1f}" font-size="11" fill="{INK2}" text-anchor="end">3 attempts, each cut off at the 1 s budget; the other 33 approval tests in that job passed</text>')
    elif r['retries']:
        ax, ay = x(dt.datetime(2026, 10, 3, 16, 0, tzinfo=dt.timezone.utc)), y(11500)
        s.append(f'<line x1="{ax+4:.1f}" y1="{ay-4:.1f}" x2="{xx-8:.1f}" y2="{y(r["req_max"]):.1f}" stroke="{MUTED}" stroke-width="1"/>')
        s.append(f'<text x="{ax:.1f}" y="{ay-8:.1f}" font-size="11.5" font-weight="700" fill="{INK}" text-anchor="end">⚠ {r["sha"][:8]}: passed only on retry x2, 10.7 s</text>')
        s.append(f'<text x="{ax:.1f}" y="{ay+7:.1f}" font-size="11" fill="{INK2}" text-anchor="end">"…the expiry waits in the queue" (has requested() and the bare :2852 wait)</text>')
ok = sum(1 for r in rows if not r['fails'] and not r['retries'])
s.append(f'<text x="{L}" y="{H-48}" font-size="11.5" fill="{INK2}"><tspan fill="{BLUE}" font-weight="700">●</tspan> clean ({ok})   <tspan fill="{SER}" font-weight="700">●</tspan> passed only on retry (1)   <tspan fill="{CRIT}" font-weight="700">●</tspan> failed (1)   ·   The two flaky ones were cut off by the 1 s budget, so their true wait is unknown.</text>')
s.append(f'<text x="{L}" y="{H-30}" font-size="11.5" fill="{INK2}">Every other approval test finished in ≤ 2.1 s in total (≤ 3.7 s beside the failure; the 1.05 s floor is one test with a built-in 1 s wait).</text>')
s.append(f'<text x="{L}" y="{H-12}" font-size="11.5" fill="{INK2}">Nothing in this window shows a wait near 5 s; 10 s is headroom beyond what was observed.</text>')
s.append('</svg>')
open('fig3.html', 'w').write('<!doctype html><html><body style="margin:0;background:#fcfcfb">' + '\n'.join(s) + '</body></html>')
print(ok, len(rows))
