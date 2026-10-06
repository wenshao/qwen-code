#!/bin/bash
R=/Users/wenshao/pr13247-rig
bash $R/build-java.sh r4 $R/wt4 $R/m2-r4 online
L1=$(git -C $R/wt4 rev-parse HEAD:pnpm-lock.yaml); L2=$(git -C $R/wt3m40 rev-parse HEAD:pnpm-lock.yaml)
if [ "$L1" = "$L2" ]; then bash $R/clone-built.sh $R/wt4 $R/wt3m40 | tail -1; else echo "LOCK DIFFERS"; fi
bash $R/build-ts.sh r4 $R/wt4
