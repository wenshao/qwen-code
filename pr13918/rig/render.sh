#!/bin/bash
# render.sh <name>  — fig/<name>.html → fig/<name>.png (2x, cropped)
RIG=/Users/wenshao/pr13918-rig; N=$1
PROF=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/72559975-b19a-488d-af12-329781469334/scratchpad/chrome-prof-13918
rm -f $RIG/fig/$N.raw.png
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --use-mock-keychain --password-store=basic \
  --user-data-dir=$PROF --force-device-scale-factor=2 --window-size=1400,2400 --screenshot=$RIG/fig/$N.raw.png "file://$RIG/fig/$N.html" > /dev/null 2>&1 &
CP=$!
for i in $(seq 1 90); do [ -s $RIG/fig/$N.raw.png ] && break; sleep 1; done
sleep 1; kill $CP 2>/dev/null; pkill -f "user-data-dir=$PROF" 2>/dev/null
python3 - "$RIG/fig/$N.raw.png" "$RIG/fig/$N.png" <<'PY'
import sys
from PIL import Image, ImageChops
im = Image.open(sys.argv[1]).convert('RGB')
bg = Image.new('RGB', im.size, (13, 17, 23))
bbox = ImageChops.difference(im, bg).getbbox()
im = im.crop((0, 0, im.size[0], min(im.size[1], bbox[3] + 40)))
im.save(sys.argv[2], optimize=True)
print(sys.argv[2], im.size)
PY
