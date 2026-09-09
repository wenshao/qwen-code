#!/usr/bin/env bash
# shot.sh <name> <title> <command...>   — run in an isolated tmux, screenshot the pane.
set -uo pipefail
SOCK=pr11412
NAME=$1; TITLE=$2; shift 2
CMD="$*"
OUT=/root/git/h11412/shots
RAW=/root/git/h11412/logs/raw
mkdir -p "$OUT" "$RAW"
DONE="/tmp/.shot-$SOCK-$NAME.done"
rm -f "$DONE"
COLS=${SHOT_COLS:-150}; ROWS=${SHOT_ROWS:-46}
tmux -L "$SOCK" kill-session -t "$NAME" 2>/dev/null
tmux -L "$SOCK" new-session -d -s "$NAME" -x "$COLS" -y "$ROWS" -c /root/git/pr11412
# The sentinel is a FILE touched by a wrapper script: if the sentinel string appeared
# in the send-keys line, the poll below would match the echoed command instead.
WRAP=$(mktemp /tmp/.shot-wrap-XXXX.sh)
{ echo '#!/usr/bin/env bash'; echo "cd /root/git/pr11412"; echo "$CMD"; echo "touch '$DONE'"; } > "$WRAP"
chmod +x "$WRAP"
tmux -L "$SOCK" send-keys -t "$NAME" "clear && $WRAP" Enter
for _ in $(seq 1 "${SHOT_TIMEOUT:-600}"); do [ -f "$DONE" ] && break; sleep 1; done
sleep 1
tmux -L "$SOCK" capture-pane -e -p -t "$NAME" -S -"${SHOT_SCROLL:-0}" > "$RAW/$NAME.ansi"
tmux -L "$SOCK" kill-session -t "$NAME" 2>/dev/null
rm -f "$WRAP" "$DONE"
# DejaVu Sans Mono has no glyph for vitest's box-drawing separators -> tofu.
sed -i 's/⎯/-/g; s/❯/>/g; s/│/|/g; s/─/-/g' "$RAW/$NAME.ansi"
python3 /root/git/h11412/harness/ansi2png.py "$RAW/$NAME.ansi" "$OUT/$NAME.png" "$TITLE"
echo "shot: $OUT/$NAME.png"
