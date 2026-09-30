#!/bin/bash
# container (VM, --network host): the two W1a Linux/MySQL integration gates on a local-disk copy, unmodified and per mutant.
# usage: java-it.sh <tree> <dist> BASE|<mutant id> ...     (each run uses a fresh database)
set -u
TREE=$1; DIST=$2; shift 2
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/mut-java-it; mkdir -p $O
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
rm -rf /dist && cp -a /rig/dist/$DIST /dist
for ID in "$@"; do
  W=/it-$ID; rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
  if [ "$ID" != BASE ]; then (cd /rig/mut && node java-mutants.mjs apply $ID $W) || { echo "$ID apply failed"; continue; }; fi
  (cd $W/packages/sdk-java/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > /dev/null 2>&1)
  (cd $W/packages/sdk-java/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true install > /dev/null 2>&1)
  for attempt in 1 2; do
    DBN=w1a_it_${ID}_${attempt}_$(date +%s)
    (cd $W/packages/sdk-java/managed-agent-server && mvn -B -ntp $R -Phosted-harness-mysql -Dcheckstyle.skip=true -Dtest=WorkspaceStorageGuardTest \
      -Dit.test='HostedWorkspaceConcurrencyIT,HostedWorkspaceStorageGuardMySqlIT' "-Dnode.executable=$(command -v node)" -Dqwen.cli.entry=/dist/cli.js \
      "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/$DBN?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rootpw \
      clean verify > $O/$ID-$attempt.log 2>&1); rc=$?
    its=$(grep -E "Tests run:.*-- in .*IT$" $O/$ID-$attempt.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed[^-]*-- in com.alibaba.qwen.code.managedagent.store./ /' | tr '\n' ';')
    marker=$(grep -a -E "^W1_TWO_BROKER_A4_OK" $O/$ID-$attempt.log | head -1)
    why=$(grep -a -E "^\[ERROR\]   [A-Za-z]+IT\.|expected|Expecting|AssertionFailedError|to contain|but was" $O/$ID-$attempt.log | head -3 | cut -c1-330 | tr '\n' '|')
    echo "[$ID] run $attempt: exit=$rc | $its | ${marker:-no A4_OK marker} | $why"
    [ "$ID" = BASE ] && break
    [ $rc -eq 0 ] && break
  done
  rm -rf $W
done
echo JAVA-IT-DONE
