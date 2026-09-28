import sys
from PIL import Image, ImageChops
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
bg = Image.new('RGB', im.size, (13, 17, 23))
box = ImageChops.difference(im, bg).getbbox()
w, h = im.size
bottom = min(h, box[3] + 40) if box else h
right = min(w, box[2] + 48) if box else w
im.crop((0, 0, right, bottom)).save(dst, optimize=True)
print(dst, im.size, '->', (right, bottom), 'content bottom', box[3] if box else None)
