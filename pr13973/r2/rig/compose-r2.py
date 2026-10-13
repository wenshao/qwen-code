from PIL import Image, ImageDraw, ImageFont
import os
R='raw/'; OUT='out-r2/'; os.makedirs(OUT, exist_ok=True)
def font(sz, bold=True):
    for f in (['/System/Library/Fonts/Supplemental/Arial Bold.ttf'] if bold else []) + ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        try: return ImageFont.truetype(f, sz)
        except: pass
    return ImageFont.load_default()
def panel(path, label, w, crop=None, boxes=(), sub=None):
    im = Image.open(R+path).convert('RGB')
    if crop: im = im.crop(crop)
    d0 = ImageDraw.Draw(im)
    for b in boxes: d0.rectangle(b, outline=(255, 70, 70), width=6)
    im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    head = 84 if sub else 52
    c = Image.new('RGB', (im.width, im.height + head), (245, 246, 248))
    d = ImageDraw.Draw(c); d.text((14, 12), label, fill=(20, 20, 24), font=font(25))
    if sub: d.text((14, 46), sub, fill=(90, 90, 100), font=font(21, False))
    c.paste(im, (0, head)); return c
def grid(rows, name, gap=20, title=None):
    W = max(sum(p.width for p in r) + gap * (len(r) - 1) for r in rows)
    th = 58 if title else 0
    H = th + sum(max(p.height for p in r) for r in rows) + gap * (len(rows) - 1)
    c = Image.new('RGB', (W, H), (255, 255, 255)); y = th
    if title: ImageDraw.Draw(c).text((10, 12), title, fill=(10, 10, 14), font=font(30))
    for r in rows:
        x = 0
        for p in r: c.paste(p, (x, y)); x += p.width + gap
        y += max(p.height for p in r) + gap
    c.save(OUT + name, optimize=True); print(name, c.size, os.path.getsize(OUT + name))
W = 1100
grid([
  [panel('head-f1a-before-abandon.png', 'Previous head e97617cf: lost first-input create', W, sub='Server already ran the Turn (1 Session, 1 Turn, 1 model call); copy says "empty session"'),
   panel('head-f1a-after-abandon.png', 'Previous head: after Abandon', W, sub='sessions/query not re-sent: admitted Session 85cccfbe is not listed; Enter would run it again')],
  [panel('merge-f1a-before-abandon.png', 'This head 5c90f489 (+ main 6373fc4e): same lost create', W, sub='New copy: may already exist or be running / does not cancel / may repeat its effects'),
   panel('merge-f1a-after-abandon.png', 'This head: after Abandon', W, boxes=[(4, 102, 462, 176)], sub='List refreshed (+1 sessions/query, 69 ms): admitted Session d344a60f listed; draft restored')],
], 'r2-01-f1-abandon.png', title='F1: Abandon after a lost first-input create (real Spring + Harness + MySQL)')
grid([
  [panel('head-n2a-in-flight.png', 'Previous head e97617cf: create in flight', W, sub='Response held 2.5 s: "Creation is unconfirmed" + Retry/Abandon on every normal create'),
   panel('merge-n2a-in-flight.png', 'This head: create in flight', W, sub='No recovery UI; composer disabled with the input; 3/3 runs, 1 Session + 1 Turn each')],
], 'r2-02-n2-in-flight.png', title='N2: recovery controls only after the request settles')
grid([
  [panel('merge-n2b-retry-in-flight.png', 'This head: direct-input Retry in flight (after reload)', W, sub='Composer disabled showing the pending input and Workspace (Project Beta); same key; 1 Session'),
   panel('merge-n2c-legacy-retry-in-flight.png', 'This head: legacy empty-only Retry in flight (N4)', W, boxes=[(520, 230, 2552, 310)], sub='Form re-renders disabled with "Choose a Workspace" while the W2 retry runs; Session still bound to W2')],
], 'r2-03-retry-in-flight.png', title='Retry while the request is in flight')
grid([
  [panel('merge-f1z-zh-warning.png', 'zh-CN input warning', W, crop=(0, 0, 2560, 560)),
   panel('merge-f1d-legacy-before-abandon.png', 'Legacy empty-only provider keeps its copy', W, crop=(0, 0, 2560, 560))],
], 'r2-04-copy.png', title='Copy: zh-CN, and the empty-only provider')
