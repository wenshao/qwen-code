#!/bin/bash
# Usage: run-arm.sh <armName> <repoRoot> <maxWaitSeconds>
# Isolation: dedicated tmux socket (the shared server's environment leaks
# QWEN_RUNTIME_DIR from an unrelated agent session) + env -i + both
# QWEN_HOME and QWEN_RUNTIME_DIR pointed at the arm's private home.
set -u
ARM="$1"; REPO="$2"; MAXWAIT="${3:-420}"
SP="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$SP/$ARM/qwen-home"
WORKDIR="$SP/$ARM/project"
SOCK="qwen12374-$ARM"
rm -rf "$SP/$ARM"; mkdir -p "$HOME_DIR" "$WORKDIR"
( cd "$WORKDIR" && git init -q . )

DEVELOPER_DIR=/Library/Developer/CommandLineTools python3 - "$HOME_DIR" <<'PY'
import json, os, sys
home = sys.argv[1]
d = json.load(open(os.path.expanduser('~/.qwen/settings.json')))
d.setdefault('general', {})['cleanupPeriodDays'] = 30
d.setdefault('security', {}).setdefault('folderTrust', {})['enabled'] = False
d.pop('mcpServers', None)
json.dump(d, open(os.path.join(home, 'settings.json'), 'w'), indent=2)
PY

node "$SP/seed.mjs" "$HOME_DIR" > "$SP/$ARM/fixture.json"
DEBUG_DIR="$HOME_DIR/debug"
node "$SP/snapshot.mjs" "$DEBUG_DIR" > "$SP/$ARM/before.json"

tmux -L "$SOCK" kill-server 2>/dev/null
env -i PATH="$PATH" HOME="$HOME" TERM=xterm-256color LANG=en_US.UTF-8 \
  tmux -L "$SOCK" new-session -d -s main -x 200 -y 50 \
  "cd '$WORKDIR' && QWEN_HOME='$HOME_DIR' QWEN_RUNTIME_DIR='$HOME_DIR' QWEN_DEBUG_LOG_FILE=1 node '$REPO/dist/cli.js'"
sleep 3
tmux -L "$SOCK" list-panes -t main -F '#{pane_pid}' > "$SP/$ARM/pids.txt" 2>/dev/null
echo "pane pid: $(cat "$SP/$ARM/pids.txt")"

LIVE=""
for i in $(seq 1 30); do
  LIVE=$(ls "$DEBUG_DIR"/*.txt 2>/dev/null | xargs -n1 basename 2>/dev/null \
         | grep -v -E '^(11111111|22222222|33333333|44444444|notes)' | head -1)
  [ -n "$LIVE" ] && break
  sleep 2
done
echo "live session log: ${LIVE:-<none>}" | tee "$SP/$ARM/live.txt"

# Growth-rate sample on the live log (debug logging is on).
if [ -n "$LIVE" ]; then
  S1=$(stat -f%z "$DEBUG_DIR/$LIVE"); T1=$(date +%s)
  sleep 30
  S2=$(stat -f%z "$DEBUG_DIR/$LIVE"); T2=$(date +%s)
  echo "growth: ${S1}B -> ${S2}B over $((T2-T1))s" > "$SP/$ARM/growth.txt"
  # Age it past the cutoff: only the name-based exclusion can save it now.
  DEVELOPER_DIR=/Library/Developer/CommandLineTools python3 - "$DEBUG_DIR/$LIVE" <<'PY'
import os, sys, time
p = sys.argv[1]; t = time.time() - 60*24*3600
os.utime(p, (t, t)); print('aged live log 60d')
PY
fi

START=$(date +%s); RESULT="timeout"
while [ $(( $(date +%s) - START )) -lt "$MAXWAIT" ]; do
  if ls "$HOME_DIR"/.debug-logs-cleanup-* >/dev/null 2>&1; then RESULT="marker"; break; fi
  if [ ! -e "$DEBUG_DIR/11111111-1111-4111-8111-111111111111.txt" ]; then RESULT="swept"; break; fi
  sleep 5
done
ELAPSED=$(( $(date +%s) - START ))
echo "wait result=$RESULT after ${ELAPSED}s"
sleep 8

node "$SP/snapshot.mjs" "$DEBUG_DIR" > "$SP/$ARM/after.json"
ls -a "$HOME_DIR" | grep -E '^\.' > "$SP/$ARM/markers.txt" 2>/dev/null
tmux -L "$SOCK" capture-pane -t main -p > "$SP/$ARM/tui.txt" 2>/dev/null
echo "$RESULT ${ELAPSED}s" > "$SP/$ARM/result.txt"
