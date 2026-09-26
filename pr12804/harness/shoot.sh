#!/bin/bash
# shoot.sh <html> <png> <width>
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROF="$SP/chrome-prof-$$"
rm -f "$2"
"$CH" --headless=new --disable-gpu --hide-scrollbars --use-mock-keychain --password-store=basic \
  --user-data-dir="$PROF" --force-device-scale-factor=2 --window-size="$3",2400 \
  --screenshot="$2" "file://$1" >/dev/null 2>&1 &
for i in $(seq 1 120); do [ -s "$2" ] && break; sleep 1; done
sleep 1; pkill -f "$PROF" 2>/dev/null; rm -rf "$PROF"
ls -la "$2"
