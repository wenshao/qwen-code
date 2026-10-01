#!/bin/bash
# Round 2, upgrade batch: main (937ed13a15) → PR (db01133aec) in place on schema o3f, then enable O3.
R=$(cd $(dirname $0); pwd); cd $R
export DB=o3h
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
B=$R/out/batch-c.log
step() { echo "$(date +%T) START $1" >> $B; shift; "$@" > /dev/null 2>> $B; echo "$(date +%T) END rc=$?" >> $B; }
rs() { local arm=$1; shift; ./stop.sh harness spring >> $B 2>&1; env "$@" ./start.sh $arm $DB > $R/run/last-restart.log 2>&1; cat $R/run/last-restart.log >> $B; grep -q "harness via tap: 200" $R/run/last-restart.log || { echo "RESTART FAILED - aborting" >> $B; exit 9; }; }
rm -f out/s8-upgrade.json
rs base
step s8-main env PHASE=main $N s8-upgrade.mjs
step b5-base sh -c "ARM=base NAMES=main-pretty,main-shell-notstarted $N b5-before.mjs > out/b5-base.log 2>&1"
rs pr
step s8-pr-off env PHASE=pr-off $N s8-upgrade.mjs
rs pr ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true
step s8-pr-on env PHASE=pr-on $N s8-upgrade.mjs
step b5-pr sh -c "ARM=pr NAMES=main-pretty,main-shell-notstarted $N b5-before.mjs > out/b5-pr.log 2>&1"
grep -o "Current version of schema.*\|Migrating schema.*\|Successfully applied.*" $R/../logs/spring-pr-$DB.log | head -4 >> out/s8-flyway.log
echo "$(date +%T) BATCH C DONE" >> $B
