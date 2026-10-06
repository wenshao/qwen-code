#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): rerun the lifecycle class after the stub moved to the 8-argument completion.
until grep -q JPROTO-DONE /root/v13163/out/jproto/ledger.txt; do sleep 10; done
export JAVA_HOME=/opt/jdk21 PATH=/opt/jdk21/bin:/root/v13163/tools/apache-maven-3.9.9/bin:$PATH TZ=UTC
O=/root/v13163/out/jproto; M="-B -ntp -Dmaven.repo.local=/root/v13163/m2-proto -Dmaven.repo.local.tail=/root/v13163/m2-head3,/root/.m2/repository"
cd /root/v13163/jproto/repo/packages/sdk-java/managed-agent-server
mvn $M -Djacoco.skip=true -Dtest="ManagedSessionLifecycleTest,ManagedWorkspaceAdmissionTest,ManagedAgentServerIntegrationTest,ManagedCwdChangeOperationTest" -Dsurefire.failIfNoSpecifiedTests=false test > $O/lifecycle2.log 2>&1; echo "lifecycle2 exit=$? $(grep -E "Tests run: [0-9]+, Failures" $O/lifecycle2.log | tail -1) $(date -u +%T)" >> $O/ledger.txt
grep -E "<<< (FAILURE|ERROR)" $O/lifecycle2.log | head >> $O/ledger.txt
mvn $M -Dcheckstyle.skip=false -DskipTests -Dspotbugs.skip=true checkstyle:check > $O/checkstyle.log 2>&1; echo "checkstyle exit=$? $(date -u +%T)" >> $O/ledger.txt
echo "JPROTO2-DONE $(date -u +%T)" >> $O/ledger.txt
