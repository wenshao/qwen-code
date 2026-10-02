#!/bin/bash
# Round 2: PR head 38bc3865 (main de261243 merged in). Base for A/B = merge-base de261243.
R=$(cd $(dirname $0); pwd); cd $R; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
H=head-38bc3865; B=base-de261243
ok() { grep -q "harness via tap: 200" run/last-restart.log || { echo "RESTART FAILED $*"; tail -5 run/last-restart.log; exit 9; }; }
p() { grep -E "^\[" | cut -c1-900; }
start_aux() { for d in 1 5; do pp=$((24083 + d)); nc -z 127.0.0.1 $pp 2>/dev/null || { nohup $N db-delay.mjs $pp 23084 $d > ../logs/relay-$d.log 2>&1 & echo $! > run/relay$d.pid; }; done
  nc -z 127.0.0.1 25084 2>/dev/null || { nohup $N sqltap.mjs 25084 run/sqltap.jsonl > ../logs/sqltap.log 2>&1 & echo $! > run/sqltap.pid; }; sleep 1; }
start_aux
echo "=== R2-1 smoke + lifecycle"; ./restart.sh $H o41r2a > run/last-restart.log 2>&1; ok a
DB=o41r2a $N s0-smoke.mjs 2>&1 | p; DB=o41r2a LABEL=s1-r2 $N s1-lifecycle.mjs 2>&1 | p
echo "=== R2-2 writer race"; DB_PORT=25084 ./restart.sh $H o41r2race > run/last-restart.log 2>&1; ok race
for m in writer-first deletion-first; do DB=o41r2race ARM=head-r2 JAR=$H MODE=$m ST=st-s1$([ $m = writer-first ] && echo 5 || echo 6) $N s2-race.mjs 2>&1 | p; done
echo "=== R2-3 reads"; ./restart.sh $H o41r2reads > run/last-restart.log 2>&1; ok reads
DB=o41r2reads ARM=head-r2 MODE=expire ST=st-s28 SUFFIX=-2m $N s3-reads.mjs 2>&1 | grep "^\[result" | cut -c1-700
DB=o41r2reads ARM=head-r2 MODE=delete ST=st-s29 $N s3-reads.mjs 2>&1 | grep "^\[result" | cut -c1-700
echo "=== R2-4 OSS transient, admission PUT, legacy delete"; ./restart.sh $H o41r2tr > run/last-restart.log 2>&1; ok tr
DB=o41r2tr ARM=head-r2 ST=st-s32 ST2=st-s33 $N s8-oss-transient.mjs 2>&1 | p
DB=o41r2tr ST=st-s39 $N s12-admission-put.mjs 2>&1 | p
DB=o41r2tr $N s9-legacy-delete.mjs 2>&1 | p
echo "=== R2-5 observer"; rm -f out/s5-state.json; echo '{"shell":true,"capture":2147483648}' > run/tap-mode.json
./restart.sh $B o41r2obs > run/last-restart.log 2>&1; ok legacy
DB=o41r2obs PHASE=legacy $N s5-observer.mjs > /dev/null 2>&1; ls out/s5-state.json > /dev/null || { echo "legacy phase failed"; exit 8; }
./restart.sh $H o41r2obs > run/last-restart.log 2>&1; ok make
grep -o "Migrating schema .* to version \"2[0-9][^\"]*\"\|Successfully applied [0-9]* migration[^,]*, now at version v[0-9]* ([^)]*)" ../logs/spring-$H-o41r2obs.log | head -4
DB=o41r2obs PHASE=make SPRING_LOG=spring-$H-o41r2obs.log $N s5-observer.mjs 2>&1 | p
DB=o41r2obs PHASE=crash $N s5-observer.mjs 2>&1 | p
GRACE=0s ./restart.sh $H o41r2obs > run/last-restart.log 2>&1; ok final
DB=o41r2obs PHASE=final SPRING_LOG=spring-$H-o41r2obs.log $N s5-observer.mjs 2>&1 | p
SPRING_LOG=spring-$H-o41r2obs.log DB=o41r2obs $N s11-reader-active.mjs 2>&1 | p
echo "=== R2-6 cost"; for arm in base:$B head:$H; do a=${arm%%:*}; j=${arm##*:}
  READ_TIMEOUT=10m ./restart.sh $j o41r2cost$a > run/last-restart.log 2>&1; ok cost-$a
  DB=o41r2cost$a ARM=$a-r2 ST=st-s5$([ $a = base ] && echo 0 || echo 1) $N s6-cost.mjs 2>&1 | grep -E "^\[(full|range)\]" | cut -c1-700
  DB=o41r2cost$a ARM=$a-r2 SUFFIX=-direct ST=st-s5$([ $a = base ] && echo 2 || echo 3) $N s7-write.mjs 2>&1 | grep "^\[result" | cut -c1-700
  DB_PORT=24084 READ_TIMEOUT=10m ./restart.sh $j o41r2cost$a > run/last-restart.log 2>&1; ok cost-r1-$a
  DB=o41r2cost$a ARM=$a-r2 SUFFIX=-r1 ST=st-s5$([ $a = base ] && echo 4 || echo 5) $N s7-write.mjs 2>&1 | grep "^\[result" | cut -c1-700
done
./stop.sh harness spring > /dev/null
echo R2-DONE
