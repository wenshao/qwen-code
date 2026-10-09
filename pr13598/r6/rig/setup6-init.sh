#!/bin/bash
cd /Users/wenshao/git/pr13598-rig
for spec in "a6 36230" "s6 36240" "f6 36250"; do
  set -- $spec
  ./init6.sh $1 $2 > runs/init-$1.log 2>&1 &
  sleep 20
done
wait
for d in a6 s6 f6; do tail -1 runs/init-$d.log; done
