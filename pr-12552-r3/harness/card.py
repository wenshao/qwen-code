import sys
from PIL import Image, ImageDraw, ImageFont
def render(title, sub, lines, out):
    F=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',26)
    FB=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',26,index=1)
    T=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf',38)
    ST=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf',24)
    col={'## ':(88,166,255),'++ ':(63,185,80),'-- ':(248,81,73),'!! ':(210,153,34),'== ':(139,148,158),'.. ':(201,209,217)}
    d0=ImageDraw.Draw(Image.new('RGB',(10,10)))
    w=max([d0.textlength(title,font=T),d0.textlength(sub,font=ST)]+[d0.textlength(l[3:] if l[:3] in col else l,font=F) for l in lines])+80
    lh=36; h=40+50+40+len(lines)*lh+40
    im=Image.new('RGB',(int(w),h),(13,17,23)); d=ImageDraw.Draw(im)
    d.text((40,30),title,font=T,fill=(230,237,243)); d.text((40,82),sub,font=ST,fill=(139,148,158))
    y=130
    for l in lines:
        p=l[:3]; c=col.get(p,(201,209,217)); txt=l[3:] if p in col else l
        d.text((40,y),txt,font=FB if p=='## ' else F,fill=c); y+=lh
    im.save(out,optimize=True); print(out, im.size)
