#!/bin/bash
cd /Users/wenshao/pr13325-rig
RIG_CFG='{"javaOpts":["-Duser.language=tr","-Duser.country=TR"]}' node run.mjs locale head mysql tr > out/locale-head.out 2>&1
for s in title recovery paging replay; do for a in base head; do node run.mjs $s $a mysql > out/$s-$a.out 2>&1; done; done
for a in base head; do node run.mjs recovery $a mariadb > out/recovery-$a-mariadb.out 2>&1; done
echo BATCH1-DONE
