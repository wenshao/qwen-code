#!/usr/bin/env python3
"""Renders the captured scenario data into HTML pages for screenshotting."""
import json
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out/final'
SHOTS = 'shots'
os.makedirs(SHOTS, exist_ok=True)


def load(variant, scenario):
    with open(f'{OUT}/{variant}-{scenario}.json') as f:
        return json.load(f)


CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { zoom: var(--z, 1.9); margin: 0 auto; max-width: 1180px; padding: 26px; background: #eef0f4; font-family: -apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif; color: #1b1f26; }
h1 { font-size: 21px; margin: 0 0 4px; }
.sub { font-size: 13px; color: #5a6270; margin-bottom: 20px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.lane { background: #fff; border-radius: 12px; padding: 14px 14px 16px; box-shadow: 0 1px 3px rgba(20,25,40,.10); }
.lane.bad { box-shadow: 0 0 0 2px #e0524a, 0 1px 3px rgba(20,25,40,.10); }
.lane.good { box-shadow: 0 0 0 2px #1f9d55, 0 1px 3px rgba(20,25,40,.10); }
.lane h2 { font-size: 13px; margin: 0 0 10px; letter-spacing: .02em; text-transform: uppercase; color: #5a6270; }
.tag { display:inline-block; font-size:11px; padding:2px 7px; border-radius:20px; margin-left:8px; vertical-align:1px; }
.tag.bad { background:#fdecea; color:#b4271d; }
.tag.good { background:#e7f6ec; color:#166534; }
.card { border: 1px solid #e3e6ec; border-radius: 10px; overflow: hidden; background: #fff; }
.card .hdr { display:flex; align-items:center; gap:8px; padding: 9px 12px; background: #f7f8fa; border-bottom: 1px solid #eceef3; }
.avatar { width: 20px; height: 20px; border-radius: 5px; background: linear-gradient(135deg,#6f5bf6,#3b82f6); }
.bot { font-size: 12.5px; font-weight: 600; }
.body { padding: 10px 12px; height: var(--bodyh, auto); min-height: 96px; font: 11.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; color: #222; max-height: 250px; overflow: hidden; position: relative; }
.body .fade { position:absolute; left:0; right:0; bottom:0; height:34px; background:linear-gradient(to bottom, rgba(255,255,255,0), #fff); }
.status { display:flex; align-items:center; justify-content:space-between; padding: 8px 12px; border-top: 1px solid #eceef3; font-size: 12px; color:#4b5361; }
.dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:6px; }
.dot.run { background:#f59e0b; }
.dot.done { background:#22c55e; }
.stop { border:1px solid #d6dae2; border-radius:6px; padding:3px 11px; font-size:11.5px; color:#3f4855; background:#fff; }
.meta { margin-top: 9px; font-size: 11.5px; color: #5a6270; }
.meta b { color:#1b1f26; }
.legend { margin-top: 16px; font-size: 12px; color:#5a6270; }
.footer { margin-top: 18px; font-size: 11px; color:#8b93a1; }
"""


def card_html(card, note):
    content = card.get('content', '') or '(empty)'
    running = card.get('flowStatus') != '3'
    status = card.get('statusLine', '')
    stop = card.get('stop_action') == 'true'
    return f"""
  <div class="card">
    <div class="hdr"><span class="avatar"></span><span class="bot">Qwen Code</span></div>
    <div class="body">{esc(content)}<span class="fade"></span></div>
    <div class="status">
      <span><span class="dot {'run' if running else 'done'}"></span>{esc(status)}</span>
      {'<span class="stop">Stop</span>' if stop else '<span style="color:#9aa2b0">no action</span>'}
    </div>
  </div>
  <div class="meta">{note}</div>"""


def esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def page(title, sub, body, footer, zoom=1.9, bodyh='auto'):
    return f"""<meta charset="utf-8"><title>{esc(title)}</title>
<style>{CSS}
:root {{ --z: {zoom}; --bodyh: {bodyh}; }}</style>
<h1>{esc(title)}</h1>
<div class="sub">{sub}</div>
{body}
<div class="footer">{footer}</div>"""


# ---------------------------------------------------------------- reconnect
def reconnect_page():
    base, head = load('base', 'reconnect'), load('head', 'reconnect')
    def lane(d, label, tag_cls, tag_text):
        rs = d['runningSample']
        a_len, b_len = rs['aLen'], rs['bLen']
        a_card = dict(d['clientAAtSample'])
        b_card = dict(d['clientBAtSample'])
        stale = b_len - a_len
        note_a = (f"client A · reconnected at {d['reconnectAt']/1000:.1f}s · "
                  f"<b>{a_len} chars</b> rendered")
        note_b = f"client B · never disconnected · <b>{b_len} chars</b> rendered"
        verdict = ('frozen on the phase it had when it went offline'
                   if stale > 1000 else
                   f'behind by {stale} chars (&lt; one 5s checkpoint)')
        return f"""
  <div class="lane {tag_cls}">
    <h2>{label}<span class="tag {tag_cls}">{tag_text}</span></h2>
    <div class="grid">
      <div>{card_html(a_card, note_a)}</div>
      <div>{card_html(b_card, note_b)}</div>
    </div>
    <div class="legend">Client A is {verdict}.</div>
  </div>"""

    body = ('<div style="display:grid;gap:18px">'
            + lane(base, 'Before — main @ 4b5396c69a', 'bad', 'stale')
            + lane(head, 'After — PR #10357 @ b7f629a7b5', 'good', 'repaired')
            + '</div>')
    sub = ('Same run, two DingTalk clients on the same status card. Client A drops off the '
           'network at t=2.0s and reconnects at t=5.3s; client B stays connected. '
           'Snapshot taken at t=11.8s, while the task is still running.')
    return page('DingTalk status card after a client reconnect', sub, body,
                'Captured from the local fault-injection harness: real presenter + status-card controller + card client over HTTP.',
                zoom=1.32, bodyh='168px')


# ------------------------------------------------------------ terminal outage
def terminal_page():
    base, head = load('base', 'terminal-outage'), load('head', 'terminal-outage')
    def lane(d, label, tag_cls, tag_text, note):
        return f"""
  <div class="lane {tag_cls}">
    <h2>{label}<span class="tag {tag_cls}">{tag_text}</span></h2>
    {card_html(d['finalCards']['B'], note)}
  </div>"""
    body = ('<div class="grid">'
            + lane(base, 'Before — main', 'bad', 'stuck in Running',
                   'The run finished at t=2.4s during the outage. 10s later the card '
                   'still shows Running, a stale body and a live <b>Stop</b> button.')
            + lane(head, 'After — PR #10357', 'good', 'recovered',
                   f"Terminal write retried after connectivity returned; card reached "
                   f"<b>Completed</b> at t={head.get('terminalAt', 0)/1000:.1f}s with the full answer and no Stop action.")
            + '</div>')
    sub = ('The Card OpenAPI is black-holed from t=2.0s to t=5.0s. The task completes at '
           't=2.4s — inside the outage — so stream finalization and the first terminal '
           'instance update both fail. Snapshot taken at t=12s.')
    return page('Status card after a host network outage at completion', sub, body,
                'Fault injected at the socket level (connection destroyed), so the real client error classification runs unmodified.')


# ------------------------------------------------------------------- timeline
def timeline_page():
    base, head = load('base', 'reconnect'), load('head', 'reconnect')
    W, H, PAD = 980, 232, 42

    def path(samples, key, maxv, maxt):
        pts = []
        for s in samples:
            x = PAD + (s['t'] / maxt) * (W - 2 * PAD)
            y = H - PAD - (s[key] / maxv) * (H - 2 * PAD)
            pts.append(f'{x:.1f},{y:.1f}')
        return ' '.join(pts)

    def svg(d, title, colour):
        samples = [s for s in d['samples'] if s['t'] <= 12000]
        maxt = 12000
        maxv = max(max(s['b'] for s in samples), 1)
        gx = lambda t: PAD + (t / maxt) * (W - 2 * PAD)
        return f"""
<div class="lane">
  <h2>{title}</h2>
  <svg viewBox="0 0 {W} {H}" width="100%" style="display:block">
    <rect x="{gx(2000):.0f}" y="{PAD-14}" width="{gx(5300)-gx(2000):.0f}" height="{H-PAD-PAD+14}" fill="#f1f3f8"/>
    <text x="{(gx(2000)+gx(5300))/2:.0f}" y="{PAD-20}" font-size="12" fill="#7b8494" text-anchor="middle">client A offline</text>
    <line x1="{PAD}" y1="{H-PAD}" x2="{W-PAD}" y2="{H-PAD}" stroke="#c9cfd9"/>
    <line x1="{PAD}" y1="{PAD-14}" x2="{PAD}" y2="{H-PAD}" stroke="#c9cfd9"/>
    <polyline fill="none" stroke="#9aa2b0" stroke-width="2.5" stroke-dasharray="5 4" points="{path(samples,'b',maxv,maxt)}"/>
    <polyline fill="none" stroke="{colour}" stroke-width="3" points="{path(samples,'a',maxv,maxt)}"/>
    {''.join(f'<text x="{gx(t):.0f}" y="{H-PAD+18}" font-size="11" fill="#7b8494" text-anchor="middle">{t//1000}s</text>' for t in range(0,12001,2000))}
    <text x="{PAD-8}" y="{PAD-2}" font-size="11" fill="#7b8494" text-anchor="end">{maxv}</text>
    <text x="{PAD-8}" y="{H-PAD}" font-size="11" fill="#7b8494" text-anchor="end">0</text>
  </svg>
  <div class="legend"><span style="color:{colour}">&#9644;</span> characters rendered on client A &nbsp;&nbsp;
     <span style="color:#9aa2b0">&#9644;</span> characters rendered on client B (always online)</div>
</div>"""

    body = ('<div style="display:grid;gap:18px">'
            + svg(base, 'Before — main: client A never catches up while the task runs', '#e0524a')
            + svg(head, 'After — PR #10357: the 5s full-content checkpoint repairs client A', '#1f9d55')
            + '</div>')
    sub = ('Characters of the answer actually rendered on each DingTalk client, sampled every 250 ms.')
    return page('Rendered content on a reconnected client', sub, body,
                'Client A goes offline at 2.0s and is back at 5.3s; the task keeps streaming until 11.8s.',
                zoom=1.5)


# ------------------------------------------------------------- rewind finding
def rewind_page():
    base, head = load('base', 'slow-create'), load('head', 'slow-create')
    def rows(d):
        out = []
        prev = None
        for h in d['clientBHistory'][:6]:
            arrow = ''
            if prev is not None and h['len'] < prev:
                arrow = ' <span style="color:#b4271d;font-weight:600">&#9660; rewind</span>'
            out.append(f"<tr><td>{h['t']} ms</td><td>{h['via']}</td>"
                       f"<td style='text-align:right'>{h['len']} chars{arrow}</td></tr>")
            prev = h['len']
        return ''.join(out)
    tbl = """<table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead><tr style="color:#5a6270;text-align:left">
      <th style="padding:4px 0">t</th><th>write</th><th style="text-align:right">card body</th></tr></thead>
      <tbody>{}</tbody></table>"""
    body = ('<div class="grid">'
            f'<div class="lane good"><h2>Before — main<span class="tag good">monotonic</span></h2>{tbl.format(rows(base))}'
            '<div class="legend">The first streaming frame repeats the content that '
            '<code>createAndDeliver</code> already carried, so the body only grows.</div></div>'
            f'<div class="lane bad"><h2>After — PR #10357<span class="tag bad">rewinds 156&#8594;104</span></h2>{tbl.format(rows(head))}'
            '<div class="legend"><code>create()</code> now publishes the freshest snapshot (156 chars), '
            'but the flush queued behind <code>record.ready</code> still writes the 104-char snapshot it '
            'captured before the wait. The card body shrinks for ~500 ms.</div></div>'
            '</div>')
    sub = ('No faults at all — the only change is a realistic 700 ms round trip for '
           '<code>POST /v1.0/card/instances/createAndDeliver</code>, with output streaming every 300 ms.')
    return page('Card body rewinds after a slow card creation', sub, body,
                'Reproduced 3/3 on the PR head; 0/3 on main. Unpinned by the suite: all 435 DingTalk tests still pass with the rewind fixed.')


pages = {
    'reconnect-cards': reconnect_page,
    'reconnect-timeline': timeline_page,
    'terminal-outage-cards': terminal_page,
    'slow-create-rewind': rewind_page,
}

for name, fn in pages.items():
    with open(f'{SHOTS}/{name}.html', 'w') as f:
        f.write(fn())
    print(f'wrote {SHOTS}/{name}.html')
