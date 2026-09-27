#!/bin/bash
# second pass for unit-suite survivors: real-process gates, the real-worker IT and the MySQL ITs
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
OUT=/rig/out/mut2; mkdir -p $OUT
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
W=/w2; rm -rf $W && mkdir -p $W && cp -a /rig/src-v2/. $W/
SJ=$W/packages/sdk-java
(cd $SJ/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
MYSQL="-Dmysql.user=root -Dmysql.password=rootpw"
printf 'id\tcompile\tunit_server\tgates\trecovery_it\tmysql_broker\tmysql_server\tverdict\tkilled_by\n' > $OUT/results.tsv
for id in $MUTANTS; do
  file=packages/sdk-java/runtime-broker/pom.xml
  [ "$id" = BASE ] || file=$(node -e "import('/rig/mut/mutants.mjs').then(m=>console.log(m.MUTANTS.find(x=>x.id==='$id').file))")
  cp /rig/src-v2/$file $W/$file
  [ "$id" = BASE ] || node /rig/mut/apply.mjs $W $id > $OUT/$id.apply.log 2>&1
  compile=ok; us=-; gates=-; it=-; mb=-; ms=-; killers=""; STAMP=$(date +%s)
  (cd $SJ/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $OUT/$id.compile.log 2>&1) || compile=FAIL
  if [ $compile = ok ]; then
    case " ${UNIT_ALSO:-} " in *" $id "*)
      (cd $SJ/managed-agent-server && mvn -B -ntp test -Dcheckstyle.skip=true > $OUT/$id.unit-server.log 2>&1) && us=pass || us=FAIL
      killers="$killers$(failing $OUT/$id.unit-server.log)";;
    esac
    (cd $SJ/runtime-broker && mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=/rig/src-v2/dist/cli.js -Dtest='LocalRebootFaultGateTest,DurableLocalRuntimeFaultGateTest' -Dsurefire.failIfNoSpecifiedTests=false > $OUT/$id.gates.log 2>&1) && gates=pass || gates=FAIL
    killers="$killers$(failing $OUT/$id.gates.log)"
    (cd $SJ/runtime-broker && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=JdbcRepositoryTest "-Dmysql.url=jdbc:mysql://127.0.0.1:${MYSQL_PORT:-3306}/m2_broker_${id}_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $OUT/$id.mysql-broker.log 2>&1) && mb=pass || mb=FAIL
    killers="$killers$(failing $OUT/$id.mysql-broker.log)"
    (cd $SJ/managed-agent-server && mvn -B -ntp verify -Phosted-harness-mysql -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceRecoveryWorkerIT -Dqwen.runtime.worker.bundle=/rig/src-v2/dist/cli.js > $OUT/$id.it.log 2>&1) && it=pass || it=FAIL
    killers="$killers$(failing $OUT/$id.it.log)"
    (cd $SJ/managed-agent-server && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false "-Dmysql.url=jdbc:mysql://127.0.0.1:${MYSQL_PORT:-3306}/m2_server_${id}_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $OUT/$id.mysql-server.log 2>&1) && ms=pass || ms=FAIL
    killers="$killers$(failing $OUT/$id.mysql-server.log)"
  fi
  verdict=SURVIVED; for r in $us $gates $it $mb $ms; do [ $r = FAIL ] && verdict=killed; done; [ $compile = FAIL ] && verdict=compile-error
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$compile" "$us" "$gates" "$it" "$mb" "$ms" "$verdict" "$killers" >> $OUT/results.tsv
  echo "[$id] $verdict unitServer=$us gates=$gates recoveryIT=$it mysqlBroker=$mb mysqlServer=$ms $killers"
  cp /rig/src-v2/$file $W/$file
done
(cd $SJ/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install >/dev/null 2>&1)
echo MUT2-DONE
