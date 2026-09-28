#!/bin/bash
# round-3 mutation re-check: the 6 round-2 survivors + the killed control, at head 8c2b626c.
# env: MUTANTS (default: the round-3 set)
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
TAG=r3; OUT=/rig/out/mut-$TAG; mkdir -p $OUT
TREE=src-v4; CLI=/rig/wt-v4/dist/cli.js; PORT=33306
MUTANTS=${MUTANTS:-BASE M01 M02 M11 M16 M19 M21 M25}
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
W=/w-mutr3; rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
SJ=$W/packages/sdk-java
(cd $SJ/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
printf 'id\tcompile\tunit_broker\tunit_server\tgates\trecovery_it\tmysql_broker\tmysql_server\tverdict\tkilled_by\n' > $OUT/results.tsv
for id in $MUTANTS; do
  file=packages/sdk-java/runtime-broker/pom.xml
  [ "$id" = BASE ] || file=$(node -e "import('/rig/mut/mutants.mjs').then(m=>console.log(m.MUTANTS.find(x=>x.id==='$id').file))")
  cp /rig/$TREE/$file $W/$file
  applied=1
  if [ "$id" != BASE ]; then
    node /rig/mut/apply.mjs $W $id > $OUT/$id.apply.log 2>&1 || applied=0
    cmp -s /rig/$TREE/$file $W/$file && applied=0
    [ $applied = 0 ] && { printf '%s\tNOT-APPLIED\n' "$id" >> $OUT/results.tsv; echo "[$id] NOT APPLIED (anchor drifted)"; continue; }
  fi
  compile=ok; ub=-; us=-; gates=-; it=-; mb=-; ms=-; killers=""; STAMP=$(date +%s)
  (cd $SJ/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $OUT/$id.compile.log 2>&1) || compile=FAIL
  if [ $compile = ok ]; then
    (cd $SJ/runtime-broker && mvn -B -ntp test -Dcheckstyle.skip=true > $OUT/$id.unit-broker.log 2>&1) && ub=pass || ub=FAIL
    killers="$killers$(failing $OUT/$id.unit-broker.log)"
    (cd $SJ/managed-agent-server && mvn -B -ntp test -Dcheckstyle.skip=true > $OUT/$id.unit-server.log 2>&1) && us=pass || us=FAIL
    killers="$killers$(failing $OUT/$id.unit-server.log)"
    (cd $SJ/runtime-broker && mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=$CLI -Dtest='LocalRebootFaultGateTest,DurableLocalRuntimeFaultGateTest' -Dsurefire.failIfNoSpecifiedTests=false > $OUT/$id.gates.log 2>&1) && gates=pass || gates=FAIL
    killers="$killers$(failing $OUT/$id.gates.log)"
    (cd $SJ/runtime-broker && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=JdbcRepositoryTest "-Dmysql.url=jdbc:mysql://127.0.0.1:$PORT/mr3_b_${id}_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rootpw > $OUT/$id.mysql-broker.log 2>&1) && mb=pass || mb=FAIL
    killers="$killers$(failing $OUT/$id.mysql-broker.log)"
    (cd $SJ/managed-agent-server && mvn -B -ntp verify -Phosted-harness-mysql -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceRecoveryWorkerIT -Dqwen.runtime.worker.bundle=$CLI > $OUT/$id.it.log 2>&1) && it=pass || it=FAIL
    killers="$killers$(failing $OUT/$id.it.log)"
    (cd $SJ/managed-agent-server && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false "-Dmysql.url=jdbc:mysql://127.0.0.1:$PORT/mr3_s_${id}_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rootpw > $OUT/$id.mysql-server.log 2>&1) && ms=pass || ms=FAIL
    killers="$killers$(failing $OUT/$id.mysql-server.log)"
  fi
  verdict=SURVIVED; for r in $ub $us $gates $it $mb $ms; do [ $r = FAIL ] && verdict=killed; done; [ $compile = FAIL ] && verdict=compile-error
  [ "$id" = BASE ] && { [ $verdict = SURVIVED ] && verdict=baseline-green || verdict=BASELINE-RED; }
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$compile" "$ub" "$us" "$gates" "$it" "$mb" "$ms" "$verdict" "$killers" >> $OUT/results.tsv
  echo "[$id] $verdict unitBroker=$ub unitServer=$us gates=$gates recoveryIT=$it mysqlBroker=$mb mysqlServer=$ms $killers"
  cp /rig/$TREE/$file $W/$file
done
echo MUT-R3-DONE
