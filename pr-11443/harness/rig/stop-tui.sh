#!/usr/bin/env bash
pkill -f "rig/tui.sh" ; tmux -L pr11443 kill-session -t tui-pr 2>/dev/null; tmux -L pr11443 kill-session -t tui-base 2>/dev/null
pkill -f "ws-tui-" ; true
