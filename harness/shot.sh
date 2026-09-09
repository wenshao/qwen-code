#!/usr/bin/env bash
# shot.sh <name> <title> <script-file> [cols] [rows]
set -uo pipefail
NAME="$1"; TITLE="$2"; SCRIPT="$3"; COLS="${4:-200}"; ROWS="${5:-60}"
S=/root/git/h11483
SENT="/tmp/claude-0/shot-11483-$NAME.done"
rm -f "$SENT"
tmux -L pr11483 kill-session -t "$NAME" 2>/dev/null
tmux -L pr11483 new-session -d -s "$NAME" -x "$COLS" -y "$ROWS"
tmux -L pr11483 send-keys -t "$NAME" "clear; bash $SCRIPT; touch $SENT" Enter
for _ in $(seq 1 900); do [ -f "$SENT" ] && break; sleep 2; done
tmux -L pr11483 capture-pane -t "$NAME" -e -p -S -400 > "$S/figs/$NAME.ansi"
python3 - "$S/figs/$NAME.ansi" <<'PY'
import sys,re
p=sys.argv[1]
lines=open(p,encoding='utf-8',errors='replace').read().split('\n')
strip=lambda l: re.sub(r'\x1b\[[0-9;:]*[A-Za-z]','',l)
lines=[l.replace('\u23af','-').replace('\u276f','>').replace('\u2500','-') for l in lines]
out=[l for l in lines if 'shot-11483' not in strip(l) and not strip(l).startswith('root@')]
while out and not strip(out[0]).strip(): out.pop(0)
while out and not strip(out[-1]).strip(): out.pop()
open(p,'w',encoding='utf-8').write('\n'.join(out))
PY
python3 "$S/ansi2png.py" "$S/figs/$NAME.ansi" "$S/figs/$NAME.png" "$TITLE"
tmux -L pr11483 kill-session -t "$NAME" 2>/dev/null
