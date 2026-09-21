import sys
from PIL import Image, ImageDraw, ImageFont
OUT='/root/git/h12404-e2e/out'
def font(sz, bold=False):
    for p in (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if bold else [])+['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        try: return ImageFont.truetype(p, sz)
        except Exception: pass
    return ImageFont.load_default()
def grid(theme, rows, cols, title, out, colhdr, cell_w=1000):
    bg,fg,sub,line = ((255,255,255),(20,20,20),(90,90,90),(220,220,220)) if theme=='light' else ((24,24,27),(240,240,240),(170,170,170),(60,60,60))
    imgs=[[Image.open(f'{OUT}/{f}') for f in r[1]] for r in rows]
    row_h=[max(i.size[1] for i in r)+40 for r in imgs]
    lab_w=260; W=lab_w+cell_w*cols+20; H=110+sum(row_h)+20
    c=Image.new('RGB',(W,H),bg); d=ImageDraw.Draw(c)
    d.text((20,18),title,fill=fg,font=font(30,True))
    for j,h in enumerate(colhdr): d.text((lab_w+j*cell_w+10,68),h,fill=sub,font=font(24,True))
    y=110
    for (lab,_),r,h in zip(rows,imgs,row_h):
        d.line([(10,y),(W-10,y)],fill=line,width=2)
        for k,part in enumerate(lab.split('\n')): d.text((20,y+14+k*30),part,fill=fg if k==0 else sub,font=font(24 if k==0 else 20, k==0))
        for j,im in enumerate(r):
            if im.size[0]>cell_w-20: im=im.resize((cell_w-20,int(im.size[1]*(cell_w-20)/im.size[0])))
            c.paste(im,(lab_w+j*cell_w+10,y+20))
        y+=h
    c.save(out); print(out, c.size)
for th in ('light','dark'):
    grid(th,[
      ('Live\n(just sent)',[f'fig-base-{th}-live.png',f'fig-pr-{th}-live.png']),
      ('Browser refresh',[f'fig-base-{th}-refresh.png',f'fig-pr-{th}-refresh.png']),
      ('Daemon restart\n+ reopen',[f'fig-base-{th}-restart.png',f'fig-pr-{th}-restart.png']),
    ],2,'PR #12404 — same message sent via the real @ picker (file / extension / MCP)',f'{OUT}/F1-tags-ab-{th}.png',
    ['Base 065dd351c8 (before)','PR f6d25c84ec (after)'])
grid('light',[('Queued prompt\n(QueuedPromptDisplay)',['fig-base-queued.png','fig-pr-queued.png'])],2,
     'Restyle blast radius: tags in the server-queue panel reuse ReadonlyComposerTag',f'{OUT}/F5-queued-chips-light.png',
     ['Base (before)','PR (after)'])
