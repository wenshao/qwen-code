#!/bin/bash
# tk.sh <session> type <text> | key <keys...> | shot [n]
S=$1; shift; CMD=$1; shift
case $CMD in
  type) tmux -L p12747 send-keys -t $S -l "$1";;
  key) tmux -L p12747 send-keys -t $S "$@";;
  shot) tmux -L p12747 capture-pane -p -t $S | grep -v '^\s*$' | tail -${1:-20};;
  ansi) tmux -L p12747 capture-pane -p -e -t $S;;
esac
