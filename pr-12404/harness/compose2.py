from PIL import Image, ImageDraw, ImageFont
OUT='/root/git/h12404-e2e/out'
F=lambda sz,b=False: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if b else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', sz)
def crop_main(path, box):  # box in CSS px at DSF=2 -> image px
    im=Image.open(path); x0,y0,x1,y1=[v*2 for v in box]; return im.crop((x0,y0,min(x1*1,im.size[0]),min(y1,im.size[1])))
def side(title, left, right, lhdr, rhdr, out, notes=None):
    w=max(left.size[0],right.size[0]); scale=lambda im: im.resize((1100,int(im.size[1]*1100/im.size[0])))
    l,r=scale(left),scale(right); H=120+max(l.size[1],r.size[1])+(70 if notes else 20)
    c=Image.new('RGB',(2260,H),(24,24,27)); d=ImageDraw.Draw(c)
    d.text((20,16),title,fill=(240,240,240),font=F(30,True))
    d.text((20,66),lhdr,fill=(170,170,170),font=F(24,True)); d.text((1150,66),rhdr,fill=(170,170,170),font=F(24,True))
    c.paste(l,(20,110)); c.paste(r,(1140,110))
    if notes: d.text((20,H-50),notes,fill=(170,170,170),font=F(22))
    c.save(out); print(out,c.size)
# F3: edit restored message after daemon restart, then reload
b=Image.open(f'{OUT}/base-s6-edit-reload.png'); p=Image.open(f'{OUT}/pr-s6-edit-reload.png')
bx=(545,110,2540,640)
side('Edit a restored message after daemon restart ("Review" -> "Recheck"), then refresh', b.crop(bx), p.crop(bx),
     'Base: edited prompt sent with 0 annotations', 'PR: 4 annotations remapped (+1 offset), tags kept',
     f'{OUT}/F3-edit-after-restart.png')
# F4: malformed [null, valid] annotation sent over raw HTTP; after reload
b=Image.open(f'{OUT}/base-s5-livenull-reload.png'); p=Image.open(f'{OUT}/pr-s5-livenull-reload.png')
bx=(545,110,2540,500)
side('Raw HTTP prompt with inputAnnotations: [null, valid] — view after a browser reload', b.crop(bx), p.crop(bx),
     'Base: annotations not persisted -> plain text', 'PR: [null] persisted -> message fails to render on every load',
     f'{OUT}/F4-null-annotation-durable.png', 'Both arms show the same live failure before reload (pre-existing live path); only the PR makes it durable.')
# F2: file preview
im=Image.open(f'{OUT}/pr-4-file-preview.png'); im.resize((im.size[0]//2*1, im.size[1]//2*1)).save(f'{OUT}/F2-file-preview-after-restart.png'); print('F2 ok')
