#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): per-attempt rename boundary prototype (no V48) on top of 13df2a65:
# build the server jar for the real stack, run the lifecycle class, then the full managed-agent-server suite.
export JAVA_HOME=/opt/jdk21 PATH=/opt/jdk21/bin:/root/v13163/tools/apache-maven-3.9.9/bin:$PATH TZ=UTC
O=/root/v13163/out/jproto; M="-B -ntp -Dmaven.repo.local=/root/v13163/m2-proto -Dmaven.repo.local.tail=/root/v13163/m2-head3,/root/.m2/repository"
cd /root/v13163/jproto/repo/packages/sdk-java/managed-agent-server
mvn $M -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean package > $O/package.log 2>&1; echo "package exit=$? $(date -u +%T)" >> $O/ledger.txt
cp target/qwen-managed-agent-server-0.1.0-alpha.jar /root/v13163/rig/server/proto-server.jar && echo "jar $(sha256sum /root/v13163/rig/server/proto-server.jar | cut -c1-16)" >> $O/ledger.txt
mvn $M -Djacoco.skip=true -Dtest=ManagedSessionLifecycleTest -Dsurefire.failIfNoSpecifiedTests=false test > $O/lifecycle.log 2>&1; echo "lifecycle exit=$? $(grep -E "Tests run: [0-9]+, Failures" $O/lifecycle.log | tail -1) $(date -u +%T)" >> $O/ledger.txt
mvn $M -Djacoco.skip=true test > $O/full.log 2>&1; echo "full exit=$? $(grep -E "^\[(ERROR|WARNING)\] Tests run: [0-9]+, Failures|^Tests run: [0-9]+, Failures" $O/full.log | tail -1) $(date -u +%T)" >> $O/ledger.txt
grep -E "<<< (FAILURE|ERROR)" $O/full.log | head -10 >> $O/ledger.txt
echo "JPROTO-DONE $(date -u +%T)" >> $O/ledger.txt
