#!/bin/bash
# usage: stamp.sh <log>  -- timestamps each new line of a growing log into <log>.ts (UTC)
f=$1; until [ -f $f ]; do sleep 1; done
tail -n +1 -F $f 2>/dev/null | while IFS= read -r l; do printf "%s %s\n" "$(date -u +%T)" "$l"; done >> $f.ts
