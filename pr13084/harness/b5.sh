#!/bin/bash
# batch s5: legacy row (base jar) -> upgrade (head jar) -> evidence + observer classification -> crash -> grace 0
R=$(cd $(dirname $0); pwd); cd $R; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
ok() { grep -q "harness via tap: 200" run/last-restart.log || { echo "RESTART FAILED"; cat run/last-restart.log; exit 9; }; }
rm -f out/s5-state.json; echo '{"shell":true,"capture":2147483648}' > run/tap-mode.json
./restart.sh base-a7deb01b o41obs > run/last-restart.log 2>&1; ok
DB=o41obs PHASE=legacy $N s5-observer.mjs 2>&1 | cut -c1-600
./restart.sh head-90bd1190 o41obs > run/last-restart.log 2>&1; ok
grep -o "Migrating schema .* to version \"27[^\"]*\"\|Successfully applied [0-9]* migration[^,]*, now at version v[0-9]* ([^)]*)" ../logs/spring-head-90bd1190-o41obs.log | head -3
DB=o41obs PHASE=make SPRING_LOG=spring-head-90bd1190-o41obs.log $N s5-observer.mjs 2>&1 | cut -c1-700
DB=o41obs PHASE=crash $N s5-observer.mjs 2>&1 | cut -c1-400
GRACE=0s ./restart.sh head-90bd1190 o41obs > run/last-restart.log 2>&1; ok
DB=o41obs PHASE=final SPRING_LOG=spring-head-90bd1190-o41obs.log $N s5-observer.mjs 2>&1 | cut -c1-700
echo BATCH5-DONE
