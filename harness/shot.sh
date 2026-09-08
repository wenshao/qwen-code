#!/usr/bin/env bash
# shot.sh <name> <title> <script-file>
set -uo pipefail
NAME="$1"; TITLE="$2"; SCRIPT="$3"
S=/root/git/h11406
SENT="/tmp/claude-0/shot-$NAME.done"
rm -f "$SENT"
tmux -L pr11406 kill-session -t "$NAME" 2>/dev/null
tmux -L pr11406 new-session -d -s "$NAME" -x 200 -y 60
tmux -L pr11406 send-keys -t "$NAME" "clear; bash $SCRIPT; touch $SENT" Enter
for _ in $(seq 1 400); do [ -f "$SENT" ] && break; sleep 2; done
tmux -L pr11406 capture-pane -t "$NAME" -e -p -S -400 > "$S/figs/$NAME.ansi"
python3 - "$S/figs/$NAME.ansi" <<'PY'
import sys,re
p=sys.argv[1]
lines=open(p,encoding='utf-8',errors='replace').read().split('\n')
strip=lambda l: re.sub(r'\x1b\[[0-9;:]*[A-Za-z]','',l)
lines=[l.replace('\u23af','-').replace('\u276f','>') for l in lines]
out=[l for l in lines if 'shot-' not in strip(l)]
while out and not strip(out[0]).strip(): out.pop(0)
while out and not strip(out[-1]).strip(): out.pop()
open(p,'w',encoding='utf-8').write('\n'.join(out))
PY
python3 "$S/ansi2png.py" "$S/figs/$NAME.ansi" "$S/figs/$NAME.png" "$TITLE"
tmux -L pr11406 kill-session -t "$NAME" 2>/dev/null
