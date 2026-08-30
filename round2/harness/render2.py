#!/usr/bin/env python3
"""Round-2 pages: re-verification of PR #10357 at head 90eb0a9a61.

Usage: render2.py <out-dir-round2> <out-dir-dup> <round1-results-dir> <shots-dir>
"""
import json, os, sys

OUT2, OUTD, R1, SHOTS = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
os.makedirs(SHOTS, exist_ok=True)

def load(d, variant, scenario):
    with open(f'{d}/{variant}-{scenario}.json') as f:
        return json.load(f)

CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { zoom: var(--z, 1.9); margin: 0 auto; max-width: 1180px; padding: 26px; background: #eef0f4; font-family: -apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif; color: #1b1f26; }
h1 { font-size: 21px; margin: 0 0 4px; }
.sub { font-size: 13px; color: #5a6270; margin-bottom: 20px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.lane { background: #fff; border-radius: 12px; padding: 14px 14px 16px; box-shadow: 0 1px 3px rgba(20,25,40,.10); }
.lane.bad { box-shadow: 0 0 0 2px #e0524a, 0 1px 3px rgba(20,25,40,.10); }
.lane.good { box-shadow: 0 0 0 2px #1f9d55, 0 1px 3px rgba(20,25,40,.10); }
.lane.warn { box-shadow: 0 0 0 2px #d99013, 0 1px 3px rgba(20,25,40,.10); }
.lane h2 { font-size: 13px; margin: 0 0 10px; letter-spacing: .02em; text-transform: uppercase; color: #5a6270; }
.tag { display:inline-block; font-size:11px; padding:2px 7px; border-radius:20px; margin-left:8px; vertical-align:1px; }
.tag.bad { background:#fdecea; color:#b4271d; }
.tag.good { background:#e7f6ec; color:#166534; }
.tag.warn { background:#fdf3e2; color:#8a5a09; }
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
.legend { margin-top: 12px; font-size: 12px; color:#5a6270; }
.footer { margin-top: 18px; font-size: 11px; color:#8b93a1; }
table { width:100%; border-collapse:collapse; font-size:12.5px; }
thead tr { color:#5a6270; text-align:left; }
th { padding:4px 0; font-weight:600; }
td { padding:2px 0; }
code { background:#f2f4f8; padding:1px 4px; border-radius:4px; font-size:11.5px; }
"""

def esc(s):
    return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def page(title, sub, body, footer, zoom=1.9, bodyh='auto'):
    return f"""<meta charset="utf-8"><title>{esc(title)}</title>
<style>{CSS}
:root {{ --z: {zoom}; --bodyh: {bodyh}; }}</style>
<h1>{esc(title)}</h1>
<div class="sub">{sub}</div>
{body}
<div class="footer">{footer}</div>"""

def card_html(card, note):
    content = card.get('content','') or '(empty)'
    running = card.get('flowStatus') != '3'
    status = card.get('statusLine','')
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

# ------------------------------------------------------------------ 01 reconnect
def reconnect_page():
    base, head = load(OUT2,'base','reconnect'), load(OUT2,'head','reconnect')
    def lane(d, label, cls, tag):
        rs = d['runningSample']; a_len, b_len = rs['aLen'], rs['bLen']
        stale = b_len - a_len
        note_a = f"client A · reconnected at {d['reconnectAt']/1000:.1f}s · <b>{a_len} chars</b> rendered"
        note_b = f"client B · never disconnected · <b>{b_len} chars</b> rendered"
        verdict = ('frozen on the phase it had when it went offline' if stale > 1000
                   else f'behind by {stale} chars (&lt; one 5 s checkpoint)')
        return f"""
  <div class="lane {cls}">
    <h2>{label}<span class="tag {cls}">{tag}</span></h2>
    <div class="grid">
      <div>{card_html(dict(d['clientAAtSample']), note_a)}</div>
      <div>{card_html(dict(d['clientBAtSample']), note_b)}</div>
    </div>
    <div class="legend">Client A is {verdict}.</div>
  </div>"""
    body = ('<div style="display:grid;gap:18px">'
            + lane(base,'Before — main (4b5396c6)','bad','stale')
            + lane(head,'After — PR #10357 head (90eb0a9a)','good','repaired')
            + '</div>')
    sub = ('Same run, two DingTalk clients on the same status card. Client A drops off the network at '
           't=2.0 s and reconnects at t=5.3 s; client B stays connected. Snapshot at t=11.8 s, task still running.')
    return page('DingTalk status card after a client reconnect', sub, body,
                'Round 2 re-run at PR head 90eb0a9a61 in an isolated worktree. Real presenter + status-card controller + card client over HTTP.',
                zoom=1.32, bodyh='168px')

# ------------------------------------------------------------------ 02 timeline
def timeline_page():
    base, head = load(OUT2,'base','reconnect'), load(OUT2,'head','reconnect')
    W,H,PAD = 980,232,42
    def path(samples,key,maxv,maxt):
        return ' '.join(f"{PAD+(s['t']/maxt)*(W-2*PAD):.1f},{H-PAD-(s[key]/maxv)*(H-2*PAD):.1f}" for s in samples)
    def svg(d,title,colour):
        samples=[s for s in d['samples'] if s['t']<=12000]; maxt=12000
        maxv=max(max(s['b'] for s in samples),1)
        gx=lambda t: PAD+(t/maxt)*(W-2*PAD)
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
            + svg(base,'Before — main: client A never catches up while the task runs','#e0524a')
            + svg(head,'After — PR head 90eb0a9a: the 5 s full-content checkpoint repairs client A','#1f9d55')
            + '</div>')
    return page('Rendered content on a reconnected client', 
                'Characters of the answer actually rendered on each DingTalk client, sampled every 250 ms.',
                body, 'Client A goes offline at 2.0 s and is back at 5.3 s; the task keeps streaming until 11.8 s.', zoom=1.5)

# ------------------------------------------------------------------ 03 terminal
def terminal_page():
    base, head = load(OUT2,'base','terminal-outage'), load(OUT2,'head','terminal-outage')
    def lane(d,label,cls,tag,note):
        return f'<div class="lane {cls}"><h2>{label}<span class="tag {cls}">{tag}</span></h2>{card_html(d["finalCards"]["B"], note)}</div>'
    body = ('<div class="grid">'
            + lane(base,'Before — main','bad','stuck in Running',
                   'The run finished at t=2.4 s during the outage. 10 s later the card still shows Running, a stale body and a live <b>Stop</b> button.')
            + lane(head,'After — PR head 90eb0a9a','good','recovered',
                   f"Terminal write retried after connectivity returned; card reached <b>Completed</b> at t={head.get('terminalAt',0)/1000:.1f} s with the full answer and no Stop action.")
            + '</div>')
    sub = ('The Card OpenAPI is black-holed from t=2.0 s to t=5.0 s. The task completes at t=2.4 s — inside the outage — '
           'so stream finalization and the first terminal instance update both fail. Snapshot at t=12 s.')
    return page('Status card after a host network outage at completion', sub, body,
                'Fault injected at the socket level (connection destroyed), so the real client error classification runs unmodified.')

# ------------------------------------------------------------------ 04 F1 fixed
def f1_page():
    old = load(R1,'head','slow-create')          # f1ce5f317f, round 1
    new = load(OUT2,'head','slow-create')        # 90eb0a9a61, round 2
    def rows(d):
        out=[]; prev=None
        for h in d['clientBHistory'][:6]:
            arrow=''
            if prev is not None and h['len']<prev:
                arrow=' <span style="color:#b4271d;font-weight:600">&#9660; rewind</span>'
            out.append(f"<tr><td>{h['t']} ms</td><td>{h['via']}</td><td style='text-align:right'>{h['len']} chars{arrow}</td></tr>")
            prev=h['len']
        return ''.join(out)
    tbl = ('<table><thead><tr><th>t</th><th>write</th>'
           '<th style="text-align:right">card body</th></tr></thead><tbody>{}</tbody></table>')
    body = ('<div class="grid">'
            f'<div class="lane bad"><h2>Round 1 — head f1ce5f31<span class="tag bad">rewinds 156&#8594;104</span></h2>{tbl.format(rows(old))}'
            '<div class="legend"><code>flush()</code> captured <code>pendingSnapshot</code> before '
            '<code>await record.ready</code>, so the queued write put back a body older than the one '
            '<code>create()</code> had just published.</div></div>'
            f'<div class="lane good"><h2>Round 2 — head 90eb0a9a<span class="tag good">monotonic</span></h2>{tbl.format(rows(new))}'
            '<div class="legend"><code>a2211707e2</code> reads <code>record.content</code> at send time. '
            'The body only grows: 4/4 reproductions clean.</div></div>'
            '</div>')
    sub = ('Same scenario both rounds: no faults, a 700 ms round trip for '
           '<code>POST /v1.0/card/instances/createAndDeliver</code>, output streaming every 300 ms.')
    return page('F1 from round 1 is fixed', sub, body,
                'Round-1 capture replayed from the archived evidence bundle; round-2 capture from the isolated re-run at 90eb0a9a61.')

# ------------------------------------------------------------------ 05 dup writes
def dup_page():
    variants = [('base','main 4b5396c6','good'), ('mid','+ a2211707e2 only','bad'),
                ('head','+ bc35af3fc4 (PR head)','warn'), ('patch','+ candidate follow-up','good')]
    cells=[]
    for v,label,cls in variants:
        try: d=load(OUTD,v,'boundary-slow-create')
        except FileNotFoundError: continue
        ws=d['streamWrites']; dup=d['redundantStreamWrites']
        DUP = '<span style="color:#b4271d;font-weight:600">duplicate</span>'
        NEW = '<span style="color:#9aa2b0">new</span>'
        rows = ''.join(
            "<tr><td>{} ms</td><td style='text-align:right'>{} chars</td>"
            "<td style='text-align:right'>{}</td></tr>".format(
                w['t'], w['len'], DUP if w['dup'] else NEW)
            for w in ws)
        tag = f'{dup} redundant' if dup else 'no redundancy'
        cells.append(
            f'<div class="lane {cls}"><h2>{label}<span class="tag {cls}">{tag}</span></h2>'
            f'<table><thead><tr><th>t</th><th style="text-align:right">payload</th>'
            f'<th style="text-align:right">vs previous</th></tr></thead><tbody>{rows}</tbody></table>'
            f'<div class="legend"><b>{len(ws)}</b> streaming call{"s" if len(ws)!=1 else ""} to the Card OpenAPI.</div></div>')
    body = '<div class="grid4">' + ''.join(cells) + '</div>'
    sub = ('Every <code>PUT /v1.0/card/streaming</code> issued when a response boundary lands right after a '
           'slow (700 ms) card creation. A write that is byte-identical to its predecessor changes nothing on the card.')
    return page('Redundant streaming writes at a boundary after a slow creation', sub, body,
                'bc35af3fc4 removes one of the two redundant writes a2211707e2 introduced; the remaining one is the flush that repeats what create() just published.',
                zoom=1.15)

pages = {'01-reconnect-cards':reconnect_page, '02-reconnect-timeline':timeline_page,
         '03-terminal-outage-cards':terminal_page, '04-f1-fixed':f1_page,
         '05-redundant-writes':dup_page}
for name, fn in pages.items():
    with open(f'{SHOTS}/{name}.html','w') as f: f.write(fn())
    print('wrote', f'{SHOTS}/{name}.html')
