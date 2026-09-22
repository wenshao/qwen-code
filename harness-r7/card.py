#!/usr/bin/env python3
# Render a dark "terminal card" PNG from a title + subtitle + monospace body + note lines.
# Pure PIL (no Chrome) per html-card-evidence-figures memory: deterministic, fast, no cropping.
import sys, json
from PIL import Image, ImageDraw, ImageFont
spec = json.load(open(sys.argv[1]))
out = sys.argv[2]
BG=(13,17,23); FG=(201,209,217); DIM=(125,133,144)
BLUE=(88,166,255); GREEN=(63,185,80); RED=(248,81,73); AMBER=(210,153,34); PUR=(188,140,255)
def font(path,sz):
    return ImageFont.truetype(path,sz)
MENLO="/System/Library/Fonts/Menlo.ttc"
ARIAL="/Library/Fonts/Arial Unicode.ttf"
try: title_f=ImageFont.truetype(ARIAL,34)
except: title_f=ImageFont.truetype(MENLO,32)
sub_f=ImageFont.truetype(MENLO,20)
body_f=ImageFont.truetype(MENLO,21)
pad=34; lh=30
lines=spec["body"]
# color per prefix
def color(l):
    if l.startswith("## "): return BLUE,l[3:]
    if l.startswith("++ "): return GREEN,l[3:]
    if l.startswith("-- "): return RED,l[3:]
    if l.startswith("!! "): return AMBER,l[3:]
    if l.startswith("== "): return DIM,l[3:]
    return FG,l
d0=ImageDraw.Draw(Image.new("RGB",(10,10)))
maxw=d0.textlength(spec["title"],font=title_f)
maxw=max(maxw, d0.textlength(spec.get("sub",""),font=sub_f))
for l in lines:
    _,t=color(l); maxw=max(maxw, d0.textlength(t,font=body_f))
W=int(maxw)+pad*2
H=pad + 44 + (28 if spec.get("sub") else 0) + 14 + len(lines)*lh + pad
img=Image.new("RGB",(W,H),BG); d=ImageDraw.Draw(img)
y=pad
d.text((pad,y),spec["title"],font=title_f,fill=FG); y+=44
if spec.get("sub"): d.text((pad,y),spec["sub"],font=sub_f,fill=DIM); y+=28
y+=14
d.line((pad,y-7,W-pad,y-7),fill=(48,54,61),width=1)
for l in lines:
    c,t=color(l)
    d.text((pad,y),t,font=body_f,fill=c); y+=lh
img.save(out); print("wrote",out,img.size)
