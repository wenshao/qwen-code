#!/bin/bash
# usage: ab.sh <arm> <web-shell dir>
set -u
ARM=$1; SRC=$2; H=/var/tmp/pr12234-r3; W=${WORKTREE:?set WORKTREE to the merged-tree checkout}
rm -rf $W/dist/web-shell && cp -Rc $SRC $W/dist/web-shell
kill $(cat $H/daemon.pid) 2>/dev/null; sleep 2 # intentional-sleep: daemon exit
tmux -L pr12234r3 kill-window -t main:daemon 2>/dev/null
tmux -L pr12234r3 new-window -t main -n daemon "env -i PATH=$PATH $H/harness/start-daemon.sh 14234 2>&1 | tee -a $H/daemon.log"
for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:14234/health | grep -q 200 && break; sleep 1; done
echo "ARM=$ARM served=$(curl -s 'http://127.0.0.1:14234/?token=verify-token-12234' | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)"
cd $H/harness; export NODE_PATH=$W/node_modules ARM
node seed.mjs http://127.0.0.1:14234 verify-token-12234 /private/var/tmp/pr12234-r3/ws 9 short > seed-short.json 2>/dev/null
node seed.mjs http://127.0.0.1:14234 verify-token-12234 /private/var/tmp/pr12234-r3/ws 6 short6 > seed-short6.json 2>/dev/null
echo "-- threshold-live"; node e2e-threshold-live.cjs 2>&1 | tail -6
echo "-- dup"; node e2e-dup.cjs 2>&1 | grep -E '^D[0-9]' | cut -c1-300
echo "-- live"; node e2e-live.cjs 2>&1 | grep -E '^(PASS|FAIL)|passed' | cut -c1-240
echo "-- toollive"; ONLY=toollive TAG=-toollive-$ARM node e2e-r3.cjs 2>&1 | grep -E '^(PASS|FAIL)|passed' | cut -c1-300
