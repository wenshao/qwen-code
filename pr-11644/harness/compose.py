"""Compose labelled before/after evidence panels with PIL.
usage: compose.py out.png "Title" left.png "Left label" right.png "Right label" [--crop x,y,w,h]
Crop box is in source pixels (screenshots are deviceScaleFactor 2)."""
import sys
from PIL import Image, ImageDraw, ImageFont
args = sys.argv[1:]
crop = None
scale = 1.0
if '--scale' in args:
    i = args.index('--scale'); scale = float(args[i + 1]); del args[i:i + 2]
if '--crop' in args:
    i = args.index('--crop'); crop = tuple(int(v) for v in args[i + 1].split(',')); del args[i:i + 2]
out, title, panels = args[0], args[1], list(zip(args[2::2], args[3::2]))
def font(sz):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        try: return ImageFont.truetype(p, sz)
        except OSError: pass
    return ImageFont.load_default()
imgs = []
for path, label in panels:
    im = Image.open(path).convert('RGB')
    if crop: im = im.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
    if scale != 1.0: im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    imgs.append((im, label))
H = max(im.height for im, _ in imgs); gap, pad, head, lab = 24, 24, 70, 52
W = sum(im.width for im, _ in imgs) + gap * (len(imgs) - 1) + pad * 2
canvas = Image.new('RGB', (W, H + head + lab + pad), (246, 247, 249))
d = ImageDraw.Draw(canvas)
d.text((pad, 20), title, fill=(20, 20, 20), font=font(32))
x = pad
for idx, (im, label) in enumerate(imgs):
    color = (176, 58, 46) if label.lower().startswith('base') else ((30, 132, 73) if label.startswith('PR') else (87, 96, 106))
    d.rectangle([x, head, x + im.width, head + lab - 8], fill=color)
    d.text((x + 12, head + 8), label, fill=(255, 255, 255), font=font(26))
    canvas.paste(im, (x, head + lab))
    d.rectangle([x - 1, head + lab - 1, x + im.width, head + lab + im.height], outline=(200, 200, 200))
    x += im.width + gap
canvas.save(out)
print(out, canvas.size)
