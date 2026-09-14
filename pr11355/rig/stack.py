#!/usr/bin/env python3
"""Stack editor screenshots vertically with captions (PIL)."""
import sys
from PIL import Image, ImageDraw, ImageFont

RIG = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/747d709e-5c4f-4a19-bf25-d5b033c9dc64/scratchpad/rig'
RUNS = RIG + '/runs'
FIGS = RIG + '/figs'
FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 30)
FONT_B = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 34)
BG = (13, 17, 23)
FG = (230, 237, 243)
DIM = (139, 148, 158)


def wrap(text, font, max_w):
    words, lines, cur = text.split(' '), [], ''
    for w in words:
        trial = (cur + ' ' + w).strip()
        if font.getlength(trial) > max_w and cur:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def stack(out, panels, title):
    imgs = [(Image.open(p), h, s) for p, h, s in panels]
    width = max(1500, max(i.width for i, _, _ in imgs) + 60)
    text_w = width - 60
    blocks = []
    for img, head, sub in imgs:
        hl = wrap(head, FONT_B, text_w)
        sl = wrap(sub, FONT, text_w)
        blocks.append((img, hl, sl, 10 + 42 * len(hl) + 38 * len(sl) + 14))
    title_lines = wrap(title, FONT_B, text_w)
    height = 30 + 44 * len(title_lines) + 20 + sum(i.height + cap_h + 28 for i, _, _, cap_h in blocks)
    canvas = Image.new('RGB', (width, height), BG)
    d = ImageDraw.Draw(canvas)
    y = 26
    for line in title_lines:
        d.text((30, y), line, font=FONT_B, fill=FG)
        y += 44
    y += 20
    for img, hl, sl, cap_h in blocks:
        yy = y
        for line in hl:
            d.text((30, yy), line, font=FONT_B, fill=FG)
            yy += 42
        for line in sl:
            d.text((30, yy), line, font=FONT, fill=DIM)
            yy += 38
        y += cap_h
        canvas.paste(img, (30, y))
        d.rectangle([30, y, 30 + img.width - 1, y + img.height - 1], outline=(48, 54, 61), width=2)
        y += img.height + 28
    canvas.save(out, optimize=True)
    print(out)


stack(FIGS + '/01-editor-access-head-vs-base.png', [
    (RUNS + '/ui-head/shots/04-create-access-section-set.png', 'PR head 025e4bf — managed DWS editor, Access control section',
     'Group policy, Direct message access (new, set to Disabled here) and Sender policy are three separate controls.'),
    (RUNS + '/ui-base/shots/03-create-access-section.png', 'base 4a029e6 — same dialog',
     'No direct-message access control; the sender policy is labelled "Direct message policy", so a group-only channel cannot be configured.'),
], 'Web Shell channel editor (real qwen serve, PR bundle vs base bundle)')

stack(FIGS + '/02-editor-roundtrip-legacy.png', [
    (RUNS + '/ui-head/shots/06-reopen-group-only-access.png', 'Reopen "dws-group-only" after Save',
     'settings.json now has "dmPolicy": "disabled"; the editor reads it back as Disabled.'),
    (RUNS + '/ui-head/shots/07-legacy-access.png', 'Edit "dws-legacy" (saved before dmPolicy existed, no stored value)',
     'Opens with the effective default Open; Save writes "dmPolicy": "open" without touching the other fields.'),
    (RUNS + '/ui-head/shots/08-zh-access-section.png', 'Same dialog with ?lang=zh',
     'Chinese labels for the new control and the relabelled sender policy.'),
], 'PR head 025e4bf — dmPolicy round-trip through <workspace>/.qwen/settings.json')
