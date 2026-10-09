#!/bin/bash
# Replace the scripted model on 18598 with fakemodel7.mjs (adds SHELLBG::); stops the old one by its PID only.
cd /rig
P=$(pgrep -f "node /rig/fakemodel" | head -1)
[ -n "$P" ] && kill $P && echo "stopped model pid $P"
sleep 1
FAKE_PORT=18598 setsid node /rig/fakemodel7.mjs > /rig/runs/model7.log 2>&1 < /dev/null &
sleep 2; head -1 /rig/runs/model7.log
