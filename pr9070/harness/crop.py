import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB'); w,h = im.size; px = im.load()
bg = px[w-3, h-3]
last = 0
for y in range(h):
    if any(abs(px[x,y][0]-bg[0])+abs(px[x,y][1]-bg[1])+abs(px[x,y][2]-bg[2])>18 for x in range(0,w,4)):
        last = y
im.crop((0,0,w,min(h,last+22))).save(dst, optimize=True)
print(Image.open(dst).size)
