#!/usr/bin/env python3
"""Evidence figures for the PR 13936 report: panel crops from the real-stack screenshots + a results card."""
from PIL import Image, ImageDraw, ImageFont
import os

S = '/Users/wenshao/git/pr13936-rig/shots/'
O = '/Users/wenshao/git/pr13936-rig/figs/'
os.makedirs(O, exist_ok=True)
BG = (13, 17, 23)
FG = (230, 237, 243)
DIM = (139, 148, 158)
GREEN = (63, 185, 80)
RED = (248, 81, 73)
AMBER = (210, 153, 34)
BLUE = (88, 166, 255)
F = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
MONO = '/System/Library/Fonts/Menlo.ttc'
font = lambda n: ImageFont.truetype(F, n)
mono = lambda n: ImageFont.truetype(MONO, n)
PANEL = (2130, 105, 2862, 1780)       # right task panel in a 2880x1800 shot
CONVO = (520, 440, 2110, 1100)        # conversation column, middle band


def wrap(text, fnt, width):
    d = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    out, line = [], ''
    for word in text.split(' '):
        cand = (line + ' ' + word).strip()
        if d.textlength(cand, font=fnt) <= width or not line:
            line = cand
        else:
            out.append(line)
            line = word
    out.append(line)
    return out


def tile(path, box, caption, sub, color, height):
    im = Image.open(S + path).convert('RGB').crop(box)
    w = int(im.width * height / im.height)
    im = im.resize((w, height), Image.LANCZOS)
    subs = wrap(sub, font(23), w - 16)
    cap_h = 64 + 31 * len(subs) + 10
    out = Image.new('RGB', (w, height + cap_h), BG)
    d = ImageDraw.Draw(out)
    d.rectangle([0, 0, w, 8], fill=color)
    d.text((8, 18), caption, font=font(30), fill=FG)
    for i, line in enumerate(subs):
        d.text((8, 60 + 31 * i), line, font=font(23), fill=DIM)
    out.paste(im, (0, cap_h))
    return out


def compose(name, title, subtitle, rows, gap=28):
    rendered = [[tile(*t) for t in row] for row in rows]
    width = max(sum(t.width for t in r) + gap * (len(r) - 1) for r in rendered) + 2 * gap
    titles = wrap(title, font(42), width - 2 * gap)
    subs = wrap(subtitle, font(25), width - 2 * gap)
    head = 22 + 54 * len(titles) + 34 * len(subs) + 24
    height = head + sum(max(t.height for t in r) for r in rendered) + gap * (len(rendered) + 1)
    out = Image.new('RGB', (width, height), BG)
    d = ImageDraw.Draw(out)
    y = 22
    for line in titles:
        d.text((gap, y), line, font=font(42), fill=FG); y += 54
    for line in subs:
        d.text((gap, y), line, font=font(25), fill=DIM); y += 34
    y = head
    for r in rendered:
        x = gap
        for t in r:
            out.paste(t, (x, y))
            x += t.width + gap
        y += max(t.height for t in r) + gap
    out.save(O + name, optimize=True)
    print(name, out.size, os.path.getsize(O + name))


H = 1150
compose('02-cancel-flow.png',
        'S1 — real child Agent cancelled from the panel (Spring + Hosted Harness + Broker + MySQL)',
        'One POST: pending/java_durable, then completed/harness_confirmed at +1.3 s. The task stayed running/draining ~9 s more; the panel said Cancelled only after the server did.',
        [[('S1-02-detail.png', PANEL, 'Before: Running / Ready', 'detail view, real task + state history', BLUE, H),
          ('S1-04-stop-requested.png', PANEL, '+1.5 s: "Stop requested"', 'command completed; badge still Running, env Draining', AMBER, H),
          ('S1-05-settled.png', PANEL, '+11.1 s: Cancelled', 'server task cancelled at +10.2 s (public API)', GREEN, H)],
         [('S1-06-continued.png', CONVO, 'Draft kept, parent continues', 'the saved draft is sent; Turn COMPLETED; reply token is the reversed draft token', GREEN, 560)]])

compose('03-lost-reply.png',
        'S3 — lost cancel reply, reload, "Continue confirming" replays the original key',
        'Spring admitted op_aa0a… (pending) but the gateway dropped the reply; after reload nothing was re-sent for 7 s; Continue sent the same idempotencyKey and got the same operation back.',
        [[('S3-01-unconfirmed.png', PANEL, 'Reply lost: unconfirmed', 'intent saved in sessionStorage, no operation id', AMBER, H),
          ('S3-02-after-reload.png', PANEL, 'After reload: still unconfirmed', 'task already Cancelled server-side; 0 POST in 7 s', AMBER, H),
          ('S3-03-after-continue.png', PANEL, 'Continue → same key → same op', 'completed/harness_confirmed; intent cleared; 1 op in DB', GREEN, H)]])

compose('04-stale-cancel-control.png',
        'F1 (minor) — cancel state cleared before the panel shows the terminal snapshot',
        'Gateway delays /tasks/query by 2.5 s (a slow list). Head: Running + enabled "Request cancellation" for 1.2–2.6 s; a click sends a 2nd POST (409). Candidate: never.',
        [[('S2AB-merge-01-stale-button.png', PANEL, 'Head: server already cancelled', 'panel still Running/Draining + Request cancellation', RED, H),
          ('S2AB-merge-02-after.png', PANEL, 'Head: after clicking it', '409 task_action_unavailable → "Cancelled" + "request failed"', RED, H),
          ('S11-02-tab2.png', PANEL, 'Head: 2nd tab (contention)', '409 session_operation_active; failure text outlives settlement', AMBER, H),
          ('S2AB-cand-02-after.png', PANEL, 'Candidate patch, same delay', '0 ms stale window, 1 POST (2/2 runs)', GREEN, H)]])

FULL = (0, 0, 2880, 1800)
compose('05-surfaces.png',
        'Entry, layouts and language on the real stack',
        'main (da224e61) has no entry for the same Session; narrow width uses the themed Dialog (Esc returns focus to the trigger); zh-CN copy is complete.',
        [[('S13-base.png', FULL, 'main: no task entry', 'same Session, 0 task requests', DIM, 700),
          ('S13-merge.png', FULL, 'PR: entry + 360 px side panel', 'running child listed', GREEN, 700)],
         [('S7-01-narrow-dialog.png', (0, 0, 1800, 1800), 'Narrow (900 px): Dialog', 'role=dialog; Esc → focus on "Child Agent tasks"', GREEN, 700),
          ('S10-01-zh.png', PANEL, 'zh-CN', 'no raw managed.tasks.* keys', GREEN, 700)]])

# results card
lines = [
    ('##', 'PR #13936 real-stack verification — head 4367e2c3, trial merge with main da224e61'),
    ('==', 'Stack: Spring jar + Hosted Harness + Broker/local worker + MySQL 8.4.7 + scripted model + Vite + Chromium'),
    ('==', 'Verdicts from server state (public task API polled every 100 ms, operation rows), not page text'),
    ('', ''),
    ('++', 'S1  cancel a real child: 1 POST; pending/java_durable -> completed/harness_confirmed (+1.3 s)'),
    ('++', '    task running/draining ~9 s after the command; UI Cancelled at 11.1 s >= server 10.2 s'),
    ('++', '    draft kept; next parent Turn COMPLETED; reply rendered'),
    ('++', 'S3  lost reply after commit: unconfirmed; reload -> 0 POST in 7 s; Continue -> same key, same op'),
    ('++', 'S4  reload with a known operation: /operations/query only, 0 POST'),
    ('++', 'S5  natural completion: Completed, no cancel control, "no viewable Artifacts"'),
    ('++', 'S7  narrow Dialog, Esc restores focus; wide side panel 360 px; Close restores focus'),
    ('++', 'S8  host without productScope: reads work, no cancel control, 0 POST'),
    ('++', 'S9  older server (no capabilities.tasks): no entry, 0 task requests'),
    ('++', 'S10 zh-CN complete;  S12 injected shell row filtered;  S13 main has no entry'),
    ('++', 'S11 two tabs: distinct keys -> 202 + 409 session_operation_active, 1 operation'),
    ('!!', 'S2  F1 minor: Running + enabled "Request cancellation" after settlement (~50 ms; 1.2-2.6 s on a slow list)'),
    ('!!', '    click -> 2nd POST 409 -> "Cancelled" + "Cancellation request failed"'),
    ('++', '    candidate (+24 lines + test): 0 ms window, 1 POST in 2/2 runs; head 2/2 reproduce'),
    ('!!', 'S14 "Loading..." role=status + Refresh disabled on every 3 s poll (10 per 30 s)'),
    ('', ''),
    ('==', 'PR suites 174/174 (merge); lib build + 201/201 on merge with main e9b87acd'),
    ('==', 'transcript JS 1,324,541 (head merge) / 1,323,954 (new main) vs 1,325,000; no managed.tasks.*'),
    ('==', 'mutation 19/28 killed; 3 redundant (M11 M17 M27); gaps M23 M20 M08 M13 M14 M06'),
]
color = {'##': BLUE, '++': GREEN, '!!': AMBER, '--': RED, '==': DIM, '': FG}
f = mono(30)
fb = ImageFont.truetype(MONO, 32, index=1)
probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
w = max(probe.textlength(f'{p} {t}' if p else t, font=fb if p == '##' else f) for p, t in lines) + 80
h = 50 + 46 * len(lines) + 30
img = Image.new('RGB', (int(w), h), BG)
d = ImageDraw.Draw(img)
y = 40
for p, t in lines:
    d.text((40, y), t if p in ('##', '') else f'{p} {t}', font=fb if p == '##' else f, fill=color[p])
    y += 46
img.save(O + '01-summary.png', optimize=True)
print('01-summary.png', img.size)
