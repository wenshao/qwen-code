#!/bin/bash
# container (dedicated VM, --network host): gate reruns, MySQL ITs, then the mutation matrix on f8bf5d74
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
OUT=/rig/out/mut; mkdir -p $OUT
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1 | sed 's/^\[[A-Z]*\] //'; }
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
W=/w; rm -rf $W && mkdir -p $W && cp -a /rig/src-v2/. $W/
SJ=$W/packages/sdk-java
(cd $SJ/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
(cd $SJ/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $OUT/pre.log 2>&1)
MYSQL="-Dmysql.user=root -Dmysql.password=rootpw"
STAMP=$(date +%s)
if [ "${SKIP_PRE:-0}" != 1 ]; then
  for i in 1 2 3; do
    (cd $SJ/runtime-broker && mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=/rig/src-v2/dist/cli.js -Dtest=ConcurrencyStorageFaultGateTest -Dsurefire.failIfNoSpecifiedTests=false > $OUT/gate-rerun-$i.log 2>&1; echo "[gate rerun $i] ConcurrencyStorageFaultGateTest exit=$? $(summary $OUT/gate-rerun-$i.log) $(failing $OUT/gate-rerun-$i.log)")
  done
  (cd $SJ/runtime-broker && mvn -B -ntp test -Pfault-gates -Dqwen.cli.entry=/rig/src-v2/dist/cli.js > $OUT/gates-full.log 2>&1; echo "[gates full] exit=$? $(summary $OUT/gates-full.log) $(failing $OUT/gates-full.log)")
  (cd $SJ/runtime-broker && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/it_broker_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $OUT/mysql-it-broker.log 2>&1; echo "[mysql IT broker] exit=$? unit: $(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' $OUT/mysql-it-broker.log | sed 's/^\[[A-Z]*\] //' | tr '\n' '|') $(failing $OUT/mysql-it-broker.log)")
  (cd $SJ/managed-agent-server && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/it_server_$STAMP?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $MYSQL > $OUT/mysql-it-server.log 2>&1; echo "[mysql IT server] exit=$? $(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' $OUT/mysql-it-server.log | sed 's/^\[[A-Z]*\] //' | tr '\n' '|') $(failing $OUT/mysql-it-server.log)")
fi
# baseline in this very environment
(cd $SJ/runtime-broker && mvn -B -ntp test -Dcheckstyle.skip=true > $OUT/base-broker.log 2>&1; echo "[baseline] broker exit=$? $(summary $OUT/base-broker.log) $(failing $OUT/base-broker.log)")
(cd $SJ/managed-agent-server && mvn -B -ntp test -Dcheckstyle.skip=true > $OUT/base-server.log 2>&1; echo "[baseline] server exit=$? $(summary $OUT/base-server.log) $(failing $OUT/base-server.log)")
printf 'id\tmodule\tcompile\tbroker\tserver\tverdict\tkilled_by\twhat\n' > $OUT/results.tsv
for id in ${MUTANTS:-$(node -e "import('/rig/mut/mutants.mjs').then(m=>console.log(m.MUTANTS.map(x=>x.id).join(' ')))")}; do
  file=$(node -e "import('/rig/mut/mutants.mjs').then(m=>console.log(m.MUTANTS.find(x=>x.id==='$id').file))")
  what=$(node -e "import('/rig/mut/mutants.mjs').then(m=>console.log(m.MUTANTS.find(x=>x.id==='$id').what))")
  cp /rig/src-v2/$file $W/$file
  node /rig/mut/apply.mjs $W $id > $OUT/$id.apply.log 2>&1 || { echo "[$id] anchor failed"; continue; }
  module=server; case "$file" in *runtime-broker*) module=broker;; esac
  compile=ok; broker=-; server=-; killers=""
  if [ $module = broker ]; then
    (cd $SJ/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install > $OUT/$id.compile.log 2>&1) || compile=FAIL
    if [ $compile = ok ]; then
      (cd $SJ/runtime-broker && mvn -B -ntp test -Dcheckstyle.skip=true > $OUT/$id.broker.log 2>&1) && broker=pass || broker=FAIL
      killers="$killers$(failing $OUT/$id.broker.log)"
    fi
  fi
  if [ $compile = ok ]; then
    (cd $SJ/managed-agent-server && mvn -B -ntp test -Dcheckstyle.skip=true > $OUT/$id.server.log 2>&1) && server=pass || server=FAIL
    killers="$killers$(failing $OUT/$id.server.log)"
    grep -q "COMPILATION ERROR" $OUT/$id.server.log && compile=FAIL
  fi
  verdict=SURVIVED; { [ "$broker" = FAIL ] || [ "$server" = FAIL ]; } && verdict=killed; [ $compile = FAIL ] && verdict=compile-error
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$module" "$compile" "$broker" "$server" "$verdict" "$killers" "$what" >> $OUT/results.tsv
  echo "[$id] $verdict broker=$broker server=$server $killers"
  cp /rig/src-v2/$file $W/$file
done
(cd $SJ/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install >/dev/null 2>&1)
echo MUT-DONE
