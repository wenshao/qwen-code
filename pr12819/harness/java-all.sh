#!/bin/bash
SP=${SCRATCH}
WT=$SP/wt; POM=$WT/packages/sdk-java/managed-agent-server/pom.xml
TD=$WT/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent
SKIPUT="-Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip=true"
echo "### J1 PR POM, Hosted job command (verbatim)"; $SP/java/run.sh J1-pr-hosted hosted
echo "### J2 PR POM, MariaDB job command (verbatim)"; $SP/java/run.sh J2-pr-mariadb mariadb
cp $SP/java/probe/*.java $TD/
echo "### J3 PR POM + probes, Hosted"; $SP/java/run.sh J3-pr-hosted-probe hosted $SKIPUT
echo "### J4 PR POM + probes, MariaDB"; $SP/java/run.sh J4-pr-mariadb-probe mariadb $SKIPUT
cd $WT && git show origin/main:packages/sdk-java/managed-agent-server/pom.xml > $POM
echo "### J5 main POM + probes, main Hosted command (-Dit.test=HostedHarnessMySqlIT)"; $SP/java/run.sh J5-main-hosted-probe hosted -Dit.test=HostedHarnessMySqlIT $SKIPUT
echo "### J6 main POM + probes, MariaDB"; $SP/java/run.sh J6-main-mariadb-probe mariadb $SKIPUT
echo "### J7 main POM + probes, Hosted without -Dit.test"; $SP/java/run.sh J7-main-hosted-noit-probe hosted $SKIPUT
cd $WT && git checkout -- packages/sdk-java/managed-agent-server/pom.xml && rm -f $TD/HostedZzzProbeIT.java $TD/ZzzRoutingProbeIT.java
git -C $WT status --short; echo ALL_DONE
