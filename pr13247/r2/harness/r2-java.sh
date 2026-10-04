#!/bin/bash
# VERIFICATION RIG ONLY: round-2 Java gates on head (wt2) and head⊕main (wt2m).
set -u
RIG=/Users/wenshao/pr13247-rig; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH TZ=UTC
for a in 2:r2 2m:r2m; do W=$RIG/wt${a%%:*}; L=${a##*:}; M2=$RIG/m2-$L
  (cd $W/packages/sdk-java/managed-agent-server && mvn -B -ntp -o -Dmaven.repo.local=$M2 clean verify checkstyle:check > $RIG/out/$L-verify.log 2>&1; echo "exit=$?" >> $RIG/out/$L-verify.log)
  echo "$L verify: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/$L-verify.log | tail -1) $(grep -c 'BugInstance\|SpotBugs.*violation' $RIG/out/$L-verify.log) $(tail -1 $RIG/out/$L-verify.log)"
  (cd $W/packages/sdk-java/managed-agent-server && mvn -B -ntp -o -Dmaven.repo.local=$M2 -Phosted-harness-mysql -Dit.test=HostedPublicWorkspaceIT -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip -Dspotbugs.skip=true -Dnode.executable=$N -Dqwen.cli.entry=$RIG/dist/$([ $L = r2 ] && echo head2 || echo main2)/cli.js verify > $RIG/out/$L-it-h2.log 2>&1; echo "exit=$?" >> $RIG/out/$L-it-h2.log)
  echo "$L hosted IT H2: $(grep -E 'Tests run: [0-9]+, Failures' $RIG/out/$L-it-h2.log | tail -1) $(tail -1 $RIG/out/$L-it-h2.log)"
  (cd $W/packages/sdk-java/managed-agent-server && mvn -B -ntp -o -Dmaven.repo.local=$M2 -Phosted-harness-mysql -Dit.test=HostedPublicWorkspaceIT -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip -Dspotbugs.skip=true -Dnode.executable=$N -Dqwen.cli.entry=$RIG/dist/$([ $L = r2 ] && echo head2 || echo main2)/cli.js "-Dmysql.url=jdbc:mysql://127.0.0.1:33247/it_$L?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=$(grep ^DBPASS= $RIG/rig.env | cut -d= -f2) verify > $RIG/out/$L-it-mysql.log 2>&1; echo "exit=$?" >> $RIG/out/$L-it-mysql.log)
  echo "$L hosted IT MySQL: $(grep -E 'Tests run: [0-9]+, Failures' $RIG/out/$L-it-mysql.log | tail -1) $(tail -1 $RIG/out/$L-it-mysql.log)"
done
