#!/bin/bash
# container: run one runtime-broker test class N times on a tree.  usage: rep-broker.sh <tree> <label> <TestClass> <N>
set -u
TREE=$1; L=$2; T=$3; N=$4; W=/rb-$L; SJ=$W/packages/sdk-java; R="-Dmaven.repo.local=/root/.m2/repository"
rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > /dev/null 2>&1)
cd $SJ/runtime-broker; mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true test-compile > /dev/null 2>&1
for i in $(seq 1 $N); do
  l=$(cut -d' ' -f1 /proc/loadavg)
  mvn -B -ntp $R -Dcheckstyle.skip=true surefire:test -Dtest=$T -Dsurefire.failIfNoSpecifiedTests=false > /tmp/rb-$L-$i.log 2>&1
  echo "[$L] run $i load=$l: $(grep -E 'Tests run: [0-9]+, Failures' /tmp/rb-$L-$i.log | tail -1) $(grep -o 'JdbcSQLTimeoutException\|Concurrent update' /tmp/rb-$L-$i.log | sort -u | tr '\n' ' ')"
done
