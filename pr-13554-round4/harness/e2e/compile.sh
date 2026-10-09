#!/bin/bash
E=/Users/wenshao/pr13554-rig/e2e
for ARM in "$@"; do rm -rf $E/classes-$ARM; mkdir -p $E/classes-$ARM
javac -nowarn -d $E/classes-$ARM -cp $E/app-$ARM/classes:$(cat $E/cp-$ARM.txt) $E/harness/E2EBroker.java $E/harness/E2ETool.java && echo "compiled $ARM"; done
