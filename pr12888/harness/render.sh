#!/bin/bash
# usage: render.sh <name> <height>
D=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/83b94b04-5287-4c5b-88f4-0baa57846046/scratchpad/figures
PROF=$D/chrome-prof-$1
rm -f "$D/$1-raw.png"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --use-mock-keychain --password-store=basic --user-data-dir=$PROF --force-device-scale-factor=2 --window-size=1500,$2 --screenshot=$D/$1-raw.png "file://$D/$1.html" >/dev/null 2>&1 &
for i in $(seq 1 90); do [ -s "$D/$1-raw.png" ] && break; /bin/sleep 1; done
/bin/sleep 1; pkill -f "user-data-dir=$PROF" 2>/dev/null
ls -la "$D/$1-raw.png"
