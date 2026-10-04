#!/bin/bash
R=/Users/wenshao/pr13247-rig
bash $R/build-java.sh r3 $R/wt3 $R/m2-r3 online
cp -Rc $R/m2-r3 $R/m2-r3m; cp -Rc $R/m2-r3 $R/m2-r3m40
bash $R/build-java.sh r3m $R/wt3m $R/m2-r3m online
bash $R/build-java.sh r3m40 $R/wt3m40 $R/m2-r3m40 online
bash $R/clone-built.sh $R/wt3m40 $R/wt2 | tail -1
bash $R/build-ts.sh m40 $R/wt3m40
