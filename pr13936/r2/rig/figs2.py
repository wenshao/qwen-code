#!/usr/bin/env python3
"""Evidence figures for the PR 13936 report: panel crops from the real-stack screenshots + a results card."""
from PIL import Image, ImageDraw, ImageFont
import os

S = '/Users/wenshao/git/pr13936-rig/shots/'
O = '/Users/wenshao/git/pr13936-rig/figs-r2/'
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
OLD = 'PR without 045cd84f'
compose('02-f1-fixed.png',
        'F1 re-run — slow task list (gateway delays /tasks/query by 2.5 s), same backend for both arms',
        'Left two: the PR with the fix commit 045cd84f reverted — Running + enabled "Request cancellation" for 1.35-2.55 s, a click sends a 2nd POST (409). Right: head 045cd84f — 0 ms window, 1 POST (2/2 runs each).',
        [[('S2-cand-1-01-stale-button.png', PANEL, OLD + ': server already cancelled', 'panel still Running/Draining + Request cancellation', RED, H),
          ('S2-cand-1-02-after.png', PANEL, OLD + ': after the click', '409 task_action_unavailable -> Cancelled + "request failed"', RED, H),
          ('S2-merge-1-02-after.png', PANEL, 'Head 045cd84f, same delay', 'Cancelled straight from Stop requested; label/value columns', GREEN, H)]])

compose('03-losing-tab.png',
        'S17 — a stale second tab cancels a task that is already cancelled',
        'Tab B reads are frozen on the last Running snapshot; its POST reaches the real server and gets 409 task_action_unavailable. Reads are unfrozen 2.3 s later.',
        [[('S17-merge-01-refused.png', PANEL, 'Head: refusal while B is stale', 'failure shown 0.1-3.1 s after the click', AMBER, H),
          ('S17-merge-02-after-unfreeze.png', PANEL, 'Head: B reads the terminal task', 'obsolete failure removed at the next poll', GREEN, H),
          ('S17-cand-02-after-unfreeze.png', PANEL, OLD + ': same steps', 'failure still shown 10.8 s later', RED, H)]])

compose('04-language-layout.png',
        'N2 / N3 — zh-CN panel on the real stack',
        'Timestamps now follow the panel language and detail labels sit in their own column.',
        [[('S10-cand-zh.png', (2130, 105, 2862, 1300), OLD, 'browser-locale timestamps; labels and values stacked', DIM, 900),
          ('S10-merge-zh.png', (2130, 105, 2862, 1300), 'Head 045cd84f', '2026/10/12 21:31:24; two columns', GREEN, 900)]])

lines = [
    ('##', 'PR #13936 re-verification — head 045cd84f (= landed b675c974 minus #13964), main e9789d09'),
    ('==', 'Spring jar + Hosted Harness + Broker/local worker + MySQL 8.4.7 + scripted model + Vite + Chromium, rebuilt from the merge'),
    ('==', 'A/B arm: same merge with 045cd84f reverted. Verdicts from server state + per-request browser logs'),
    ('', ''),
    ('++', 'F1  slow list (2.5 s): head 0 ms window, 1 POST (2/2); without fix 1.35-2.55 s, 2nd POST 409 (2/2)'),
    ('++', 'S1  cancel: 1 POST, Stop requested +1.3 s, Cancelled +10.23 s vs server +10.20 s; draft + continuation OK'),
    ('++', 'S11 two tabs: loser 409 session_operation_active; message gone after settlement (without fix: stays)'),
    ('++', 'S17 stale 2nd tab: 409 task_action_unavailable; message cleared ~0.8 s after reads resume (without fix: stays)'),
    ('++', 'S15 stale replica (late nonterminal list/detail replies): 10 runs, 0 regressions, 1 POST each'),
    ('++', 'N1  background polls: 0 "Loading..." / 0 Refresh disables per 30 s (without fix: 10 / 10)'),
    ('++', 'N2/N3 zh-CN timestamps follow the panel language; labels in their own column'),
    ('++', 'S3 lost reply + same-key replay, S4 reload, S5, S7, S8, S9, S12, S13: unchanged, all pass'),
    ('!!', 'S16 read outage: role=alert re-inserted 10x per 30 s (once per poll); 4-line candidate -> 1x'),
    ('', ''),
    ('==', 'tests: managed + i18n 505/505, typecheck clean; mutation: round-1 set 21/28 (was 19), fix set 16/24 killed'),
    ('==', 'transcript JS: main 1,327,402 -> merge 1,327,531 (+129); ceiling 1,326,500 after #13964 -> main red'),
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
