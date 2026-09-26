#!/bin/bash
# render.sh <name>: headless Chrome screenshot of <name>.html at 2x, then crop to content
S=$(cd "$(dirname "$0")" && pwd); N=$1
PROFILE=$S/.chrome-$N; rm -rf $PROFILE $S/$N.raw.png
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --use-mock-keychain --password-store=basic \
  --user-data-dir=$PROFILE --force-device-scale-factor=2 --window-size=1600,1400 --screenshot=$S/$N.raw.png "file://$S/$N.html" >/dev/null 2>&1 &
for i in $(seq 1 240); do [ -s $S/$N.raw.png ] && break; sleep 0.5; done
sleep 1; pkill -f "user-data-dir=$PROFILE" 2>/dev/null; rm -rf $PROFILE
DEVELOPER_DIR=/Library/Developer/CommandLineTools python3 - "$S/$N.raw.png" "$S/$N.png" <<'PY'
import sys
from PIL import Image, ImageChops
im = Image.open(sys.argv[1]).convert('RGB')
bg = Image.new('RGB', im.size, (13, 17, 23))
box = ImageChops.difference(im, bg).getbbox()
l, t, r, b = box
im.crop((0, 0, min(im.width, r + 56), min(im.height, b + 52))).save(sys.argv[2], optimize=True)
print(sys.argv[2], im.size, '->', (min(im.width, r + 56), min(im.height, b + 52)))
PY
rm -f $S/$N.raw.png
