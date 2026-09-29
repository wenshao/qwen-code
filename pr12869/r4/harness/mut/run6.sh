#!/bin/bash
# one pipeline per mutant, sequential, quiet VM. A stage counts as a kill only if it fails twice in a row.
# env: TREE, CLI, MUTANTS, MYSQL_PORT, TAG
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
TAG=${TAG:-a}; OUT=/rig/out/mut6$TAG; mkdir -p $OUT
TREE=${TREE:-src-v4}; CLI=${CLI:-/rig/wt-v3/dist/cli.js}; PORT=${MYSQL_PORT:-3306}
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
W=/w6$TAG; rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
SJ=$W/packages/sdk-java
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
url() { echo "-Dmysql.url=jdbc:mysql://127.0.0.1:$PORT/m6_$1_${TAG}_$(date +%s)?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"; }
stage() { # <id> <name>: run once, and once more if it failed
  local id=$1 name=$2 log=$OUT/$1.$2.log rc
  for attempt in 1 2; do
    case $name in
      unit-broker)  (cd $SJ/runtime-broker && mvn -B -ntp $R test -Dcheckstyle.skip=true > $log 2>&1); rc=$? ;;
      unit-server)  (cd $SJ/managed-agent-server && mvn -B -ntp $R test -Dcheckstyle.skip=true > $log 2>&1); rc=$? ;;
      gates)        (cd $SJ/runtime-broker && mvn -B -ntp $R test -Pfault-gates -Dqwen.cli.entry=$CLI -Dtest='LocalRebootFaultGateTest,DurableLocalRuntimeFaultGateTest' -Dsurefire.failIfNoSpecifiedTests=false > $log 2>&1); rc=$? ;;
      mysql-broker) (cd $SJ/runtime-broker && mvn -B -ntp $R verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=JdbcRepositoryTest "$(url b)" -Dmysql.user=root -Dmysql.password=rootpw > $log 2>&1); rc=$? ;;
      recovery-it)  (cd $SJ/managed-agent-server && mvn -B -ntp $R verify -Phosted-harness-mysql -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceRecoveryWorkerIT -Dqwen.runtime.worker.bundle=$CLI > $log 2>&1); rc=$? ;;
      mysql-server) (cd $SJ/managed-agent-server && mvn -B -ntp $R verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false "$(url s)" -Dmysql.user=root -Dmysql.password=rootpw > $log 2>&1); rc=$? ;;
    esac
    [ $rc = 0 ] && { [ $attempt = 2 ] && echo "   [$id] $name failed once, passed on the rerun: $(cat $log.first-failure)"; return 0; }
    failing $log > $log.first-failure; cp $log $log.attempt$attempt
  done
  return 1
}
printf 'id\tcompile\tverdict\tkilled_at\tkilled_by\twhat\n' > $OUT/results.tsv
for id in $MUTANTS; do
  file=packages/sdk-java/runtime-broker/pom.xml; what=baseline
  if [ "$id" != BASE ]; then
    file=$(node -e "import('/rig/mut/mutants.mjs').then(m=>console.log(m.MUTANTS.find(x=>x.id==='$id').file))")
    what=$(node -e "import('/rig/mut/mutants.mjs').then(m=>console.log(m.MUTANTS.find(x=>x.id==='$id').what))")
    cp /rig/$TREE/$file $W/$file
    node /rig/mut/apply.mjs $W $id > $OUT/$id.apply.log 2>&1
    cmp -s /rig/$TREE/$file $W/$file && { echo "[$id] NOT APPLIED"; continue; }
  fi
  compile=ok; verdict=SURVIVED; at=-; by=""
  (cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true install > $OUT/$id.compile.log 2>&1) || compile=FAIL
  if [ $compile = ok ]; then
    for name in unit-broker unit-server gates recovery-it mysql-broker mysql-server; do
      if ! stage $id $name; then verdict=killed; at=$name; by=$(failing $OUT/$id.$name.log); break; fi
    done
  else verdict=compile-error; fi
  [ "$id" = BASE ] && { [ $verdict = SURVIVED ] && verdict=baseline-green || verdict=BASELINE-RED; }
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$compile" "$verdict" "$at" "$by" "$what" >> $OUT/results.tsv
  echo "[$id] $verdict${at:+ at $at} $by"
  [ "$id" != BASE ] && cp /rig/$TREE/$file $W/$file
done
echo MUT6-DONE
