from PIL import Image
from render import render, BG
def side_by_side(title_items, cols, foot_items, out, gap=24):
    render(title_items, '_t.png'); render(foot_items, '_f.png')
    imgs = []
    for i, c in enumerate(cols): render(c, f'_c{i}.png'); imgs.append(Image.open(f'_c{i}.png'))
    t, f = Image.open('_t.png'), Image.open('_f.png')
    W = max(t.width, f.width, sum(i.width for i in imgs) + gap * (len(imgs) - 1))
    H = t.height + max(i.height for i in imgs) + f.height - 60
    img = Image.new('RGB', (W, H), BG); img.paste(t, (0, 0)); x = 0
    for i in imgs: img.paste(i, (x, t.height - 36)); x += i.width + gap
    img.paste(f, (0, t.height - 36 + max(i.height for i in imgs) - 30)); img.save(out, optimize=True); print(out, img.size)
