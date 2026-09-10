#!/bin/bash
source /root/git/h11576/env.sh
tmux -L "$TMUX_SOCK" send-keys -t "$1" -l "$2"
sleep 0.4
tmux -L "$TMUX_SOCK" send-keys -t "$1" Enter
