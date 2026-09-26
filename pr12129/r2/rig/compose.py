import sys
from PIL import Image, ImageDraw, ImageFont
S = sys.argv[1]
def font(sz):
    for p in ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/SFNS.ttf', '/Library/Fonts/Arial.ttf']:
        try: return ImageFont.truetype(p, sz)
        except Exception: pass
    return ImageFont.load_default()
def panel(path, label, sub, scale, color):
    im = Image.open(path).convert('RGB'); im = im.resize((int(im.width*scale), int(im.height*scale)), Image.LANCZOS)
    head = 96
    out = Image.new('RGB', (im.width, im.height + head), 'white')
    d = ImageDraw.Draw(out)
    d.rectangle([0, 0, im.width, 10], fill=color)
    d.text((14, 20), label, fill='black', font=font(34))
    d.text((14, 60), sub, fill=(70, 70, 70), font=font(24))
    out.paste(im, (0, head))
    return out
def row(panels, title, dest):
    gap = 24; tw = sum(p.width for p in panels) + gap*(len(panels)+1); th = max(p.height for p in panels) + 90
    out = Image.new('RGB', (tw, th), (245, 245, 245)); d = ImageDraw.Draw(out)
    d.text((gap, 24), title, fill='black', font=font(36))
    x = gap
    for p in panels: out.paste(p, (x, 76)); x += p.width + gap
    out.save(dest, optimize=True); print(dest, out.size)
RED, GREEN, AMBER = (200, 60, 60), (40, 150, 70), (200, 140, 20)
sh = S + '/shots/'
row([panel(sh+'base-touch-f1.0-d440-land.png', 'main 9e60263 (before)', 'error node isVisibleToUser=false, 0 live events', 0.5, RED),
     panel(sh+'pr-touch-f1.0-d440-land.png', 'PR 983f471 (after)', 'error visible, 1 polite live event, cursor still in address field', 0.5, GREEN)],
    'Edit dialog right after a real tap on SAVE: Pixel 5, API 36, default font & display size, landscape', S+'/out/01-editor-error-default-landscape-ab.png')
row([panel(sh+'base-touch-f2.0-d560-port.png', 'main 9e60263 (before)', 'error below the fold', 0.42, RED),
     panel(sh+'pr-touch-f2.0-d560-port.png', 'PR 983f471 (after)', 'dialog scrolled to the error', 0.42, GREEN)],
    'Same, 200% font + display size Largest, portrait', S+'/out/02-editor-error-large-text-portrait-ab.png')
row([panel(sh+'recovery-base.png', 'main 9e60263', 'Reset clipped to 57 px; swipes do nothing', 0.34, RED),
     panel(sh+'recovery-pr.png', 'PR 983f471', 'after 4 real swipes: Reset 190 px', 0.34, GREEN),
     panel(sh+'recovery-b7nested.png', 'PR + nested ScrollView (R2-7 mutant)', 'outer view scrolls: identical to PR', 0.34, AMBER)],
    'Storage recovery page after 4 real swipes: Pixel 5, API 36, 200% font, display size Largest, landscape', S+'/out/03-recovery-page-nested-scrollview.png')
