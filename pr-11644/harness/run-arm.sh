#!/bin/bash
# run-arm.sh <arm> — swap the web-shell bundle, restart the daemon, run every A/B scenario.
set -uo pipefail
ARM=$1
cd /root/git/h11644
./killd.sh; sleep 2
./start-daemon.sh "$ARM" || exit 1
sleep 3
echo "== batch A $(date +%T)"
node s1-idle.mjs "$ARM" > out/s1-$ARM.log 2>&1 &
node s2-hover.mjs "$ARM" > out/s2-$ARM-beta.log 2>&1 &
TARGET=alpha-app node s2-hover.mjs "$ARM" > out/s2-$ARM-alpha.log 2>&1 &
node s3-menu.mjs "$ARM" > out/s3-$ARM-beta.log 2>&1 &
wait
echo "== batch B $(date +%T)"
node s4-settings.mjs "$ARM" > out/s4-$ARM.log 2>&1 &
node s5-skills.mjs "$ARM" > out/s5-$ARM.log 2>&1 &
timeout 150 node s8-attach.mjs "$ARM" > out/s8-$ARM.log 2>&1 &
timeout 260 node s10-chatgit.mjs "$ARM" > out/s10-$ARM.log 2>&1 &
wait
echo "== done $(date +%T)"
for f in out/s*-$ARM*.log; do echo "--- $f: $(grep -c pageerror $f) pageerrors, $(wc -c < $f) bytes"; done
