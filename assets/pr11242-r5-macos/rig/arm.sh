#!/bin/bash
# usage: arm.sh <tag> <coalesceMs> <scenario>
set -u
export PATH="$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH"
TAG="$1"; COALESCE_MS="$2"; SCENARIO="${3:-claimed}"
SP="$(cd "$(dirname "$0")" && pwd)"
TREE=/Users/wenshao/git/qwen-code-x3-scratch-pr11242-r5
ISO="$SP/iso"
UDD="$ISO/Library/Application Support/Google/Chrome for Testing"
EXT="$TREE/packages/chrome-extension/dist/extension"
CFT="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
PORT=9412

mkdir -p "$UDD"
# no session restore: a SIGTERM-killed Chrome would otherwise reopen old tabs
rm -rf "$UDD/Default/Sessions" "$UDD/Default/Current Session" "$UDD/Default/Current Tabs" "$UDD/Default/Last Session" "$UDD/Default/Last Tabs"

# same profile prefs the repo's own managed-chrome harness writes: Chrome's
# password-leak modal otherwise steals keyboard focus after a saucedemo login
python3 - "$UDD/Default/Preferences" <<'PREF'
import json, os, sys
path = sys.argv[1]
data = {}
if os.path.exists(path):
    try:
        data = json.load(open(path))
    except Exception:
        data = {}
data.setdefault('profile', {})['password_manager_leak_detection'] = False
data['credentials_enable_service'] = False
data['credentials_enable_autosignin'] = False
os.makedirs(os.path.dirname(path), exist_ok=True)
json.dump(data, open(path, 'w'))
PREF

export QWEN_BROWSER_USE_INSTALL_HOME="$ISO"
export RUNTIME_ENTRY="$TREE/packages/browser-use/dist/index.js"
export COALESCE_MS SCENARIO TAG

"$CFT" --user-data-dir="$UDD" \
  --disable-extensions-except="$EXT" --load-extension="$EXT" \
  --no-first-run --no-default-browser-check --disable-features=Translate,TranslateUI --lang=en-US \
  --window-position=40,40 --window-size=1280,900 \
  --remote-debugging-port=$PORT \
  "https://www.saucedemo.com/" > "$SP/logs/chrome-$TAG.log" 2>&1 &
CHROME_PID=$!
echo "chrome pid $CHROME_PID default-socket" >> "$SP/logs/arm-$TAG.log"

# wait for the extension service worker target
for i in $(seq 1 60); do
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/list" 2>/dev/null | grep -q "idkijaaipeeinemigojbjkmfmabokbdk"; then break; fi
  sleep 1
done
curl -s --max-time 3 "http://127.0.0.1:$PORT/json/list" > "$SP/logs/targets-$TAG.json" 2>/dev/null
sleep 3

node "$SP/probe.mjs" 2>> "$SP/logs/arm-$TAG.log" | tee -a "$SP/logs/probe-stdout-$TAG.txt"
RC=${PIPESTATUS[0]}
if [ "${CONTROL:-0}" = "1" ]; then node "$SP/control.mjs" 2>> "$SP/logs/arm-$TAG.log" | tee -a "$SP/logs/probe-stdout-$TAG.txt"; fi
if [ "${CAPTURE:-0}" = "1" ]; then "$SP/capture-window.sh" "$SP/fig/chrome-$TAG.png" >> "$SP/logs/arm-$TAG.log" 2>&1; fi
echo "probe rc=$RC" >> "$SP/logs/arm-$TAG.log"
ps -o pid=,command= -p "$CHROME_PID" > /dev/null 2>&1 && kill "$CHROME_PID" 2>/dev/null
sleep 2
pgrep -f "user-data-dir=$UDD" | while read -r p; do kill "$p" 2>/dev/null; done

exit $RC
