#!/bin/bash
cd /Users/wenshao/pr13325-rig
run() { echo "=== $(date +%T) $*"; node run2.mjs "$@" > out/r2-$(echo "$@" | tr ' ' '-').out 2>&1; grep -c RESULT out/r2-$(echo "$@" | tr ' ' '-').out; }
for a in mb h2; do RIG_CFG='{"javaOpts":["-Duser.language=tr","-Duser.country=TR"]}' run locale $a mysql tr; done
for s in dispatch recovery paging replay title wstitle; do for a in mb h2; do run $s $a mysql; done; done
for a in mb h2; do run recovery $a mariadb; done
for e in mysql mariadb; do for a in mb h2; do REPS=5 run lockorder $a $e r5; done; done
for e in mysql mariadb; do run upgrade2 x $e; done
echo "=== $(date +%T) BATCH-R2-DONE"
