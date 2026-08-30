#!/usr/bin/env python3
"""Renders the full-stack rig captures into HTML pages for screenshotting."""
import json, os, sys

RIG = '/Users/wenshao/git/rig-10357'
OUT = f'{RIG}/out'
SHOTS = f'{RIG}/shots'
os.makedirs(SHOTS, exist_ok=True)


def load(v, s):
    with open(f'{OUT}/{v}-{s}.json') as f:
        return json.load(f)


def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { zoom: var(--z, 1.9); margin: 0 auto; max-width: 1180px; padding: 24px; background: #eef0f4;
       font-family: -apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif; color: #1b1f26; }
h1 { font-size: 20px; margin: 0 0 4px; }
.sub { font-size: 12.5px; color: #5a6270; margin-bottom: 18px; line-height:1.5; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.lane { background: #fff; border-radius: 12px; padding: 13px 14px 15px; box-shadow: 0 1px 3px rgba(20,25,40,.10); }
.lane.bad { box-shadow: 0 0 0 2px #e0524a, 0 1px 3px rgba(20,25,40,.10); }
.lane.good { box-shadow: 0 0 0 2px #1f9d55, 0 1px 3px rgba(20,25,40,.10); }
.lane h2 { font-size: 12px; margin: 0 0 9px; letter-spacing:.03em; text-transform: uppercase; color:#5a6270; }
.tag { display:inline-block; font-size:10.5px; padding:2px 7px; border-radius:20px; margin-left:7px; vertical-align:1px; }
.tag.bad { background:#fdecea; color:#b4271d; }
.tag.good { background:#e7f6ec; color:#166534; }
.card { border: 1px solid #e3e6ec; border-radius: 10px; overflow: hidden; background: #fff; }
.card .hdr { display:flex; align-items:center; gap:8px; padding: 8px 12px; background:#f7f8fa; border-bottom:1px solid #eceef3; }
.avatar { width: 19px; height: 19px; border-radius: 5px; background: linear-gradient(135deg,#6f5bf6,#3b82f6); }
.bot { font-size: 12px; font-weight: 600; }
.body { padding: 9px 12px; font: 10.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: pre-wrap; color:#222; height: 150px; overflow:hidden; position:relative; }
.body .fade { position:absolute; left:0; right:0; bottom:0; height:30px; background:linear-gradient(to bottom, rgba(255,255,255,0), #fff); }
.status { display:flex; align-items:center; justify-content:space-between; padding:7px 12px; border-top:1px solid #eceef3; font-size:11.5px; color:#4b5361; }
.dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:6px; }
.dot.run { background:#f59e0b; } .dot.done { background:#22c55e; }
.stop { border:1px solid #d6dae2; border-radius:6px; padding:2px 10px; font-size:11px; color:#3f4855; background:#fff; }
.meta { margin-top:8px; font-size:11px; color:#5a6270; line-height:1.55; }
.meta b { color:#1b1f26; }
table.trace { width:100%; border-collapse:collapse; font: 10.5px/1.5 ui-monospace, Menlo, monospace; margin-top:8px; }
table.trace td { padding:1.5px 5px; border-bottom:1px solid #f1f3f6; }
td.ok { color:#166534; } td.fail { color:#b4271d; font-weight:600; }
.footer { margin-top:16px; font-size:10.5px; color:#8b93a1; }
.legend { font-size:11px; color:#5a6270; margin-top:6px; }
.sw { display:inline-block; width:9px; height:9px; border-radius:2px; margin:0 4px 0 12px; vertical-align:0; }
"""


def page(title, sub, body, footer, zoom=1.9):
    return (f'<meta charset="utf-8"><title>{esc(title)}</title>\n'
            f'<style>{CSS}\n:root {{ --z: {zoom}; }}</style>\n'
            f'<h1>{esc(title)}</h1>\n<div class="sub">{sub}</div>\n{body}\n'
            f'<div class="footer">{footer}</div>')


def card_html(card, note):
    content = card.get('content') or '(empty)'
    running = card.get('flowStatus') != '3'
    return f"""
  <div class="card">
    <div class="hdr"><span class="avatar"></span><span class="bot">Qwen Code</span></div>
    <div class="body">{esc(content)}<span class="fade"></span></div>
    <div class="status">
      <span><span class="dot {'run' if running else 'done'}"></span>{esc(card.get('statusLine',''))}</span>
      {'<span class="stop">Stop</span>' if card.get('stop_action') == 'true' else '<span style="color:#9aa2b0">no action</span>'}
    </div>
  </div>
  <div class="meta">{note}</div>"""


def chart(series, width=1050, height=250, xmax=None, ymax=None, bands=None, marks=None,
          xlabel='seconds since the card was created', ylabel='characters on the card'):
    """series: list of dict(name, color, points=[(x,y)], dash=bool)"""
    xs = [p[0] for s in series for p in s['points']] or [0]
    ys = [p[1] for s in series for p in s['points']] or [0]
    xmax = xmax or max(xs) * 1.02 or 1
    ymax = ymax or max(ys) * 1.12 or 1
    L, R, T, B = 52, 14, 12, 30
    w, h = width - L - R, height - T - B
    def X(x): return L + (x / xmax) * w
    def Y(y): return T + h - (y / ymax) * h
    out = [f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}">']
    for b in (bands or []):
        out.append(f'<rect x="{X(b["from"]):.1f}" y="{T}" width="{max(1,X(b["to"])-X(b["from"])):.1f}" '
                   f'height="{h}" fill="{b.get("color","#fdecea")}"/>')
        if b.get('label'):
            out.append(f'<text x="{X(b["from"])+4:.1f}" y="{T+12}" font-size="10" fill="{b.get("labelColor","#b4271d")}" '
                       f'font-family="-apple-system,Helvetica,Arial">{esc(b["label"])}</text>')
    for i in range(6):
        y = T + h * i / 5
        out.append(f'<line x1="{L}" y1="{y:.1f}" x2="{L+w}" y2="{y:.1f}" stroke="#e6e9ef" stroke-width="1"/>')
        out.append(f'<text x="{L-6}" y="{y+3.5:.1f}" font-size="9.5" fill="#8b93a1" text-anchor="end" '
                   f'font-family="-apple-system,Helvetica,Arial">{int(ymax*(5-i)/5)}</text>')
    ticks = 8
    for i in range(ticks + 1):
        x = L + w * i / ticks
        out.append(f'<text x="{x:.1f}" y="{T+h+15}" font-size="9.5" fill="#8b93a1" text-anchor="middle" '
                   f'font-family="-apple-system,Helvetica,Arial">{xmax*i/ticks:.0f}</text>')
    for m in (marks or []):
        out.append(f'<line x1="{X(m["x"]):.1f}" y1="{T}" x2="{X(m["x"]):.1f}" y2="{T+h}" '
                   f'stroke="{m.get("color","#6b7280")}" stroke-width="1" stroke-dasharray="3 3"/>')
        out.append(f'<text x="{X(m["x"])+4:.1f}" y="{T+h-6}" font-size="9.5" fill="{m.get("color","#6b7280")}" '
                   f'font-family="-apple-system,Helvetica,Arial">{esc(m["label"])}</text>')
    for s in series:
        pts = ' '.join(f'{X(x):.1f},{Y(y):.1f}' for x, y in s['points'])
        dash = ' stroke-dasharray="5 3"' if s.get('dash') else ''
        out.append(f'<polyline points="{pts}" fill="none" stroke="{s["color"]}" stroke-width="{s.get("w",2)}"{dash}/>')
    out.append(f'<text x="{L+w/2:.0f}" y="{height-2}" font-size="9.5" fill="#8b93a1" text-anchor="middle" '
               f'font-family="-apple-system,Helvetica,Arial">{esc(xlabel)}</text>')
    out.append('</svg>')
    return ''.join(out)


def step_points(history, t0, tmax):
    pts, last = [], 0
    for h in history:
        if h['via'] in ('disconnect', 'reconnect'):
            continue
        x = (h['t'] - t0) / 1000
        pts.append((x, last))
        pts.append((x, h['len']))
        last = h['len']
    pts.append(((tmax - t0) / 1000, last))
    return pts


def write(name, html):
    with open(f'{SHOTS}/{name}.html', 'w') as f:
        f.write(html)
    print('wrote', name)


# ------------------------------------------------ 1. outage across completion
def p_terminal():
    b, h = load('base', 'terminal-outage'), load('head', 'terminal-outage')
    def lane(r, title, klass, tag):
        c = r['clients'][1]
        card = {'content': c['finalContent'], 'flowStatus': c['finalFlowStatus'],
                'statusLine': c['finalStatusLine'], 'stop_action': c['finalStopAction']}
        reqs = [q for q in r['requests'] if str(q['path']).startswith('/v1.0/card') and q['t'] > 18500]
        rows = ''.join(
            f'<tr><td>{q["t"]/1000:.2f}s</td><td>{esc(q["method"])} {esc(q["path"])}</td>'
            f'<td class="{"fail" if q["status"] != 200 else "ok"}">{esc(q["status"])}</td></tr>'
            for q in reqs[:14])
        note = (f'final card body <b>{c["finalContentLen"]}</b> / 2604 chars &middot; '
                f'flowStatus <b>{c["finalFlowStatus"]}</b> &middot; Stop action <b>{c["finalStopAction"]}</b>')
        return (f'<div class="lane {klass}"><h2>{title}<span class="tag {klass}">{tag}</span></h2>'
                f'{card_html(card, note)}<table class="trace">{rows}</table></div>')
    body = ('<div class="grid">'
            + lane(b, 'main @ 168a88c02e', 'bad', 'stuck in Running, forever')
            + lane(h, 'PR #10357 @ 90eb0a9a61', 'good', 'Completed after the outage')
            + '</div>')
    write('01-terminal-outage-cards', page(
        'Card OpenAPI outage spanning task completion — real `qwen channel start` run',
        'Every Card OpenAPI request is black-holed (socket destroyed) from 19.3s to 24.3s, which covers the stream '
        'finalize and the terminal instance update. Both trees run the same bundled CLI against the same fake '
        'DingTalk gateway; the cards below are what a connected DingTalk client renders when the run is over.',
        body,
        'Traces show the last Card OpenAPI requests of each run. `destroyed` = connection reset by the injected fault.'))


# ------------------------------------------------------- 2. mid-stream outage
def p_content():
    b, h = load('base', 'content-outage'), load('head', 'content-outage')
    def series(r, color):
        t0 = next(e['t'] for e in r['events'] if e['type'] == 'create')
        tmax = max(x['t'] for x in r['requests'])
        return t0, step_points(r['clients'][1]['history'], t0, tmax)
    tb, pb = series(b, '#e0524a')
    th, ph = series(h, '#1f9d55')
    band = [{'from': 2.0, 'to': 5.0, 'label': 'Card OpenAPI black-holed (3s)'}]
    ch = chart([{'name': 'main', 'color': '#e0524a', 'points': pb},
                {'name': 'PR #10357', 'color': '#1f9d55', 'points': ph}],
               bands=band, height=270)
    fb = [q for q in b['requests'] if str(q['path']).startswith('/v1.0/card')]
    fh = [q for q in h['requests'] if str(q['path']).startswith('/v1.0/card')]
    gap_b = max((fb[i+1]['t'] - fb[i]['t']) for i in range(len(fb)-1)) / 1000
    gap_h = max((fh[i+1]['t'] - fh[i]['t']) for i in range(len(fh)-1)) / 1000
    body = (f'<div class="lane"><h2>characters rendered on a continuously connected client</h2>{ch}'
            f'<div class="legend"><span class="sw" style="background:#e0524a"></span>main @ 168a88c02e'
            f'<span class="sw" style="background:#1f9d55"></span>PR #10357</div></div>'
            f'<div class="grid" style="margin-top:14px">'
            f'<div class="lane bad"><h2>main<span class="tag bad">latched</span></h2><div class="meta">'
            f'One destroyed socket at 2.0s latches <code>streamFailed</code>. The card issues '
            f'<b>{len(fb)}</b> Card OpenAPI requests for the whole run and then stops: the longest gap with no '
            f'request at all is <b>{gap_b:.1f}s</b>. The body is frozen at 207/2604 chars and the status line at '
            f'<b>"{esc(b["clients"][1]["history"][-2]["statusLine"])}"</b> until the terminal write.'
            f'</div></div>'
            f'<div class="lane good"><h2>PR #10357<span class="tag good">recovers</span></h2><div class="meta">'
            f'Retries through the outage ({len([q for q in h["requests"] if q["status"] != 200])} failed requests), '
            f'then resumes <b>60 ms</b> after connectivity returns. '
            f'<b>{len(fh)}</b> Card OpenAPI requests over the run, longest gap <b>{gap_h:.1f}s</b>. The status line '
            f'keeps ticking through 5s…17s.</div></div></div>')
    write('02-content-outage-trace', page(
        'Host outage while the answer is streaming — real `qwen channel start` run',
        'The Card OpenAPI is black-holed for 3 seconds starting 2 s after the card is created. '
        'The model keeps producing output the whole time.', body,
        'Both lanes: the same bundled CLI, the same fake DingTalk gateway, the same injected fault window.'))


# --------------------------------------------------------- 3. client reconnect
def p_reconnect():
    out = []
    for v, label, klass in (('base', 'main @ 168a88c02e', 'bad'), ('head', 'PR #10357 @ 90eb0a9a61', 'good')):
        r = load(v, 'client-reconnect')
        t0 = next(e['t'] for e in r['events'] if e['type'] == 'create')
        tmax = max(x['t'] for x in r['requests'])
        A = r['clients'][0]; B = r['clients'][1]
        off = next(x['t'] for x in A['history'] if x['via'] == 'disconnect')
        on = next(x['t'] for x in A['history'] if x['via'] == 'reconnect')
        ch = chart([{'name': 'B', 'color': '#3b82f6', 'points': step_points(B['history'], t0, tmax)},
                    {'name': 'A', 'color': '#e0524a' if v == 'base' else '#1f9d55',
                     'points': step_points(A['history'], t0, tmax)}],
                   bands=[{'from': (off - t0) / 1000, 'to': (on - t0) / 1000,
                           'label': 'client A offline', 'color': '#eef1f6', 'labelColor': '#6b7280'}],
                   height=230, ymax=2800, xmax=(tmax - t0) / 1000)
        # lag at the moment just before the terminal write
        def at(hist, t):
            last = 0
            for x in hist:
                if x['t'] <= t: last = x['len']
            return last
        probe = tmax - 1500
        lag = at(B['history'], probe) - at(A['history'], probe)
        repair = next((x['t'] for x in A['history'] if x['t'] > on and x['len'] > at(A['history'], on)), None)
        rtxt = f'{(repair-on)/1000:.1f}s after reconnect' if repair else 'never while the task ran'
        out.append(f'<div class="lane {klass}"><h2>{label}</h2>{ch}'
                   f'<div class="meta">client A first sees newer content <b>{rtxt}</b>; '
                   f'still behind by <b>{lag}</b> chars just before the run ends.</div></div>')
    body = ('<div class="lane" style="margin-bottom:14px"><div class="legend" style="margin:0">'
            '<span class="sw" style="background:#3b82f6"></span>client B (never disconnects)'
            '<span class="sw" style="background:#e0524a"></span>client A on main'
            '<span class="sw" style="background:#1f9d55"></span>client A on the PR</div></div>'
            + out[0] + '<div style="height:14px"></div>' + out[1])
    write('03-reconnect-timeline', page(
        'One DingTalk client drops off and reconnects mid-run — real `qwen channel start` run',
        'Client A goes offline 2 s after the card is created and comes back 3.3 s later. '
        'Client model <b>m2</b>: a client that was offline does not get the streaming frames it missed, so only a '
        'later <i>instance</i> update can repair it. This is the model implied by issue #10354 — see the caveat in the report.',
        body,
        'Y axis: characters rendered on that client. Both runs stream the same 2604-character answer.'))


# ---------------------------------------------------- 4. gettoken classification
def p_token():
    rows = []
    for v, s, label in (('base', 'token-permanent', 'main / invalid appkey (errcode 40001)'),
                        ('head', 'token-permanent', 'PR / invalid appkey (errcode 40001)'),
                        ('base', 'token-transient', 'main / system busy (errcode -1)'),
                        ('head', 'token-transient', 'PR / system busy (errcode -1)')):
        r = load(v, s)
        ts = [t['t'] for t in r['tokenRequests']]
        t0 = ts[0]
        dots = ''.join(
            f'<span style="display:inline-block;position:absolute;left:{(t-t0)/22000*100:.2f}%;'
            f'width:8px;height:8px;border-radius:50%;background:{"#1f9d55" if v=="head" else "#e0524a"};'
            f'top:6px" title="{t}ms"></span>' for t in ts)
        gaps = ', '.join(f'{(ts[i+1]-ts[i])/1000:.1f}s' for i in range(len(ts) - 1))
        rows.append(
            f'<div class="lane {"good" if v=="head" else "bad"}" style="margin-bottom:10px">'
            f'<h2>{esc(label)}<span class="tag {"good" if v=="head" else "bad"}">{len(ts)} gettoken calls</span></h2>'
            f'<div style="position:relative;height:20px;background:#f4f6f9;border-radius:4px">{dots}</div>'
            f'<div class="meta">gaps between calls: {esc(gaps)}</div></div>')
    body = ''.join(rows)
    write('04-token-classification', page(
        'gettoken error classification — real `qwen channel start` run',
        'The Stream connection is established normally, then every <code>oapi.dingtalk.com/gettoken</code> reply is '
        'switched to an error and a task is started. The card can never be created; the question is whether the '
        'channel keeps retrying. Window: 22 s.',
        body,
        'Each dot is one gettoken request. On the PR the transient code retries on the 1/2/4/8 s backoff, '
        'the permanent credential error does not.'))


# ------------------------------------------------------------ 5. the F1 rewind
def p_slowcreate():
    old = json.load(open('/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/'
                         '06531f3c-ed78-4482-909b-43146b375ad4/scratchpad/assets/repo/results/head-slow-create.json'))
    new = json.load(open(f'{RIG}/harness/out/r2/head-slow-create.json'))
    def lane(r, label, klass, tag):
        rows = ''.join(
            f'<tr><td>{x["t"]}ms</td><td>{esc(x["via"])}</td>'
            f'<td class="{"fail" if i and x["len"] < r["clientBHistory"][i-1]["len"] else "ok"}">{x["len"]} chars</td></tr>'
            for i, x in enumerate(r['clientBHistory'][:9]))
        reg = r['regressions']
        note = (f'<b style="color:#b4271d">body rewinds {reg[0]["from"]} → {reg[0]["to"]} chars, '
                f'restored after {r["rewindMs"][0]} ms</b>' if reg else '<b style="color:#166534">no rewind</b>')
        return (f'<div class="lane {klass}"><h2>{label}<span class="tag {klass}">{tag}</span></h2>'
                f'<table class="trace">{rows}</table><div class="meta">{note}</div></div>')
    body = ('<div class="grid">'
            + lane(old, 'PR head f1ce5f317f (round 1)', 'bad', 'rewind')
            + lane(new, 'PR head 90eb0a9a61 (now)', 'good', 'fixed')
            + '</div>')
    write('05-slow-create-rewind-fixed', page(
        'F1 from the round-1 review: the card body no longer rewinds after a slow creation',
        'No faults injected. <code>POST /v1.0/card/instances/createAndDeliver</code> takes 700 ms; output is '
        'appended every 300 ms. First writes a connected client sees, in order.',
        body,
        'Fixed by a2211707e2 — `flush()` now reads `record.content` after `await record.ready` instead of a '
        'snapshot captured before it.'))


if __name__ == '__main__':
    p_terminal(); p_content(); p_reconnect(); p_token(); p_slowcreate()
