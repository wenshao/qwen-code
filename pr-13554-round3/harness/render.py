import subprocess, os, time, glob, sys
from PIL import Image, ImageChops
D = os.path.dirname(os.path.abspath(__file__))
CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
for h in sorted(glob.glob(D + '/*.html')):
    name = os.path.splitext(os.path.basename(h))[0]
    raw = f'{D}/{name}.raw.png'
    if os.path.exists(raw): os.remove(raw)
    prof = f'/tmp/claude-501/chrome-pr13554-{name}'
    p = subprocess.Popen([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--use-mock-keychain',
                          '--password-store=basic', f'--user-data-dir={prof}', '--force-device-scale-factor=2',
                          '--window-size=1360,2400', f'--screenshot={raw}', 'file://' + h],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(120):
        if os.path.exists(raw) and os.path.getsize(raw) > 0:
            time.sleep(1); break
        time.sleep(0.5)
    p.kill(); p.wait()
    im = Image.open(raw).convert('RGB')
    bg = Image.new('RGB', im.size, (13, 17, 23))
    box = ImageChops.difference(im, bg).getbbox()
    im = im.crop((0, 0, im.size[0], min(im.size[1], box[3] + 40)))
    im.save(f'{D}/{name}.png', optimize=True)
    os.remove(raw)
    print(name, im.size, os.path.getsize(f'{D}/{name}.png'))
