#!/bin/sh
cd ~/pr13140/ws
export QWEN_HOME=~/pr13140/qhome
for a in head base; do
  C=~/pr13140/$a-inst/lib/node_modules/@qwen-code/qwen-code/cli-entry.js
  node $C sandbox --verify 2>&1 | tail -1
  python3 ~/pr13140/rig-stdio.py $a-54 $C
done
