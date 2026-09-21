#!/bin/bash
# Round 2: prove the current-session name exclusion is load-bearing in the real
# binary, and show what happens to the `latest` alias when its target is swept.
# Usage: run-race.sh <armName> <distDir> <maxWaitSeconds>
set -u
ARM="$1"; DIST="$2"; MAXWAIT="${3:-420}"
SP="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$SP/$ARM/qwen-home"; WORKDIR="$SP/$ARM/project"; SOCK="qwen12374-$ARM"
rm -rf "$SP/$ARM"; mkdir -p "$HOME_DIR" "$WORKDIR"; ( cd "$WORKDIR" && git init -q . )

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
  "cd '$WORKDIR' && QWEN_HOME='$HOME_DIR' QWEN_RUNTIME_DIR='$HOME_DIR' QWEN_DEBUG_LOG_FILE=1 node '$DIST/cli.js'"
sleep 3

LIVE=""
for i in $(seq 1 30); do
  LIVE=$(ls "$DEBUG_DIR"/*.txt 2>/dev/null | xargs -n1 basename 2>/dev/null \
         | grep -v -E '^(11111111|22222222|33333333|44444444|notes)' | head -1)
  [ -n "$LIVE" ] && break
  sleep 2
done
echo "live: $LIVE" | tee "$SP/$ARM/live.txt"

# Re-point `latest` at a stale fixture AFTER the CLI wrote its own alias, so
# the sweep's effect on a symlink whose target ages out is observable.
rm -f "$DEBUG_DIR/latest"
ln -s "44444444-4444-4444-8444-444444444444.txt" "$DEBUG_DIR/latest"

# Race-age the live log continuously: whatever the session appends, its mtime
# is stale again within 200ms, so the sweep almost certainly stats it as stale.
DEVELOPER_DIR=/Library/Developer/CommandLineTools python3 "$SP/ager.py" "$DEBUG_DIR/$LIVE" "$SP/$ARM/age.log" &
AGER=$!
sleep 1

START=$(date +%s); RESULT="timeout"
while [ $(( $(date +%s) - START )) -lt "$MAXWAIT" ]; do
  if ls "$HOME_DIR"/.debug-logs-cleanup-* >/dev/null 2>&1; then RESULT="marker"; break; fi
  sleep 3
done
ELAPSED=$(( $(date +%s) - START ))
sleep 8
kill $AGER 2>/dev/null
echo "wait result=$RESULT after ${ELAPSED}s"
node "$SP/snapshot.mjs" "$DEBUG_DIR" > "$SP/$ARM/after.json"
echo "$RESULT ${ELAPSED}s" > "$SP/$ARM/result.txt"
tmux -L "$SOCK" kill-server 2>/dev/null
