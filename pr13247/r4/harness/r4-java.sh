#!/bin/bash
# VERIFICATION RIG ONLY: round-3 Java gates on head (wt3) and head⊕main+V40 (wt3m40).
set -u
RIG=/Users/wenshao/pr13247-rig; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH TZ=UTC
PW=$(grep ^DBPASS= $RIG/rig.env | cut -d= -f2)
for a in wt4:r4; do W=$RIG/${a%%:*}; L=${a##*:}; M2=$RIG/m2-$L
  (cd $W/packages/sdk-java/managed-agent-server && mvn -B -ntp -o -Dmaven.repo.local=$M2 clean verify checkstyle:check > $RIG/out/$L-verify.log 2>&1; echo "exit=$?" >> $RIG/out/$L-verify.log)
  echo "$L verify: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/$L-verify.log | tail -1) $(tail -1 $RIG/out/$L-verify.log)"
  for db in h2 mysql; do
    EXTRA=""; [ $db = mysql ] && EXTRA="-Dmysql.url=jdbc:mysql://127.0.0.1:33247/it4_$L?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false -Dmysql.user=root -Dmysql.password=$PW"
    (cd $W/packages/sdk-java/managed-agent-server && mvn -B -ntp -o -Dmaven.repo.local=$M2 -Phosted-harness-mysql -Dit.test=HostedPublicWorkspaceIT -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip -Dspotbugs.skip=true -Dnode.executable=$N -Dqwen.cli.entry=$RIG/dist/r4/cli.js $EXTRA verify > $RIG/out/$L-it-$db.log 2>&1; echo "exit=$?" >> $RIG/out/$L-it-$db.log)
    echo "$L hosted IT $db: $(grep -E 'Tests run: [0-9]+, Failures' $RIG/out/$L-it-$db.log | tail -1) $(tail -1 $RIG/out/$L-it-$db.log)"
  done
done
