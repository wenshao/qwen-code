#!/bin/bash
set -u
D=/Users/wenshao/pr13163-rig; export TZ=UTC JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH
for W in wt-n4 wt-m4; do
  DBN=lane4_$(echo $W | tr -c 'a-z0-9\n' '_')_$(date +%s); S=$(date +%s)
  mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$D/m2 -f $D/$W/packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:33163/$DBN?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig13163 verify checkstyle:check > $D/out/it/lane4-$W.log 2>&1
  echo "RESULT $W exit=$? secs=$(( $(date +%s) - S )) $(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $D/out/it/lane4-$W.log | sed -E 's/^\[[A-Z]+\] //' | tr '\n' '|') $(grep -m1 'Checkstyle violations' $D/out/it/lane4-$W.log | sed 's/\[INFO\] //')"
  grep -E "<<< (FAILURE|ERROR)" $D/out/it/lane4-$W.log | sed -E 's/.*managedagent\.//; s/ -- Time.*//' | sort -u | sed 's/^/   FAIL /'
done
