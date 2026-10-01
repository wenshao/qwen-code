#!/bin/bash
# VERIFICATION RIG ONLY: stop worker processes orphaned by a SIGKILLed rig server. Only node processes of THIS rig's dist with ppid 1; never java.
ps -axo pid=,ppid=,command= | awk '$2==1 && $3 ~ /\/node$/ && $0 ~ /\/rig\/dist\/[a-z0-9-]+\/cli\.js/ && $0 !~ / serve / {print $1}' | while read -r p; do kill "$p" 2>/dev/null && echo "reaped $p"; done | wc -l | tr -d ' '
