#!/bin/bash
R=/Users/wenshao/pr13247-rig
bash $R/build-java.sh r5 $R/wt5 $R/m2-r5 online
cp -Rc $R/m2-r5 $R/m2-r5m
bash $R/build-java.sh r5m $R/wt5m $R/m2-r5m online
L1=$(git -C $R/wt5m rev-parse HEAD:pnpm-lock.yaml); L2=$(git -C $R/wt4 rev-parse HEAD:pnpm-lock.yaml)
if [ "$L1" = "$L2" ]; then bash $R/clone-built.sh $R/wt5m $R/wt4 | tail -1; else echo "LOCK DIFFERS"; fi
bash $R/build-ts.sh m5 $R/wt5m
