#!/bin/bash
# Round 7: the 13 round-6 stack scenarios on the landed squash 9f14e7d9 (jar r7land, worker = -merge worktree at 9f14e7d9), fresh DB p654r11.
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad/rig
[ "$(git -C $HOME/git/qwen-code-pr13654-merge rev-parse HEAD)" = 9f14e7d9bba39873e39893ece967f4a04964d2ff ] || { echo "worker worktree not at 9f14e7d9"; exit 1; }
$R/r11.sh "UP1 F1 A1"
N0=8 $R/r11.sh "Q QC"
N0=12 AS1=0 $R/r11.sh "UP1 QS"
LANE=1 $R/stop-l.sh
