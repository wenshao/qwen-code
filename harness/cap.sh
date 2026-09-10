#!/bin/bash
source /root/git/h11576/env.sh
tmux -L "$TMUX_SOCK" capture-pane -t "$1" -e -p > "$H/out/$2.ansi"
grep -n . "$H/out/$2.ansi" | sed -E 's/\x1b\[[0-9;]*m//g' | tail -${3:-45}
