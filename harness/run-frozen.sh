#!/bin/bash
# Round 3: make the live session's debug log un-appendable (chmod 0444) so its
# mtime can be pinned past the cutoff deterministically. Only the name-based
# excludeSessionIds can save it then.
set -u
ARM="$1"; DIST="$2"; MAXWAIT="${3:-300}"
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
echo "$LIVE" > "$SP/$ARM/live.txt"; echo "live: $LIVE"
# Freeze it: read-only file => appendFile fails => mtime stays where we put it.
chmod 0444 "$DEBUG_DIR/$LIVE"
DEVELOPER_DIR=/Library/Developer/CommandLineTools python3 -c "
import os,sys,time; p=sys.argv[1]; t=time.time()-60*24*3600; os.utime(p,(t,t))
print('frozen+aged', time.strftime('%Y-%m-%d', time.localtime(os.stat(p).st_mtime)))" "$DEBUG_DIR/$LIVE"
START=$(date +%s); RESULT="timeout"
while [ $(( $(date +%s) - START )) -lt "$MAXWAIT" ]; do
  if ls "$HOME_DIR"/.debug-logs-cleanup-* >/dev/null 2>&1; then RESULT="marker"; break; fi
  sleep 3
done
ELAPSED=$(( $(date +%s) - START )); sleep 8
echo "wait result=$RESULT after ${ELAPSED}s"
# Confirm the freeze held (mtime still 60d old) before judging survival.
DEVELOPER_DIR=/Library/Developer/CommandLineTools python3 -c "
import os,sys,time
p=sys.argv[1]
print('live log exists:', os.path.exists(p), '| mtime:', time.strftime('%Y-%m-%d', time.localtime(os.stat(p).st_mtime)) if os.path.exists(p) else 'n/a')
" "$DEBUG_DIR/$LIVE" | tee "$SP/$ARM/verdict.txt"
node "$SP/snapshot.mjs" "$DEBUG_DIR" > "$SP/$ARM/after.json"
echo "$RESULT ${ELAPSED}s" > "$SP/$ARM/result.txt"
tmux -L "$SOCK" kill-server 2>/dev/null
