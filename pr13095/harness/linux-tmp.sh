#!/bin/bash
# Inside the Linux container: run HostedPublicWorkspaceIT (H2) for one arm while watching /tmp.
# The Maven and failsafe JVMs get java.io.tmpdir=/jvmtmp, so the JUnit @TempDir and Tomcat's scratch
# directories are NOT under /tmp; whatever appears under /tmp is written by a process that resolved the
# OS default, i.e. a child whose environment carries no TMPDIR.
# usage: linux-tmp.sh <arm: head|base>
set -u
ARM=$1; touch /rig-linux
O=/rig/out/linux; mkdir -p $O /jvmtmp /b
cp -a /rig/linux/src-$ARM /b/$ARM
cp -a /rig/m2-linux /m2
printf 'LOG=%s\nFAULT=\n' "$O/$ARM-probe.log" > /rig/probe/ctl; : > $O/$ARM-probe.log
ls -la /tmp > $O/$ARM-tmp-before.txt
node /rig/scripts/tmp-watch.mjs /tmp $O/$ARM-tmp-events.log & WPID=$!
node /rig/scripts/tmp-watch.mjs /jvmtmp $O/$ARM-jvmtmp-events.log & WPID2=$!
sleep 1
export MAVEN_OPTS="-Djava.io.tmpdir=/jvmtmp"
mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=/m2 -f /b/$ARM/packages/sdk-java/managed-agent-server/pom.xml \
  -Phosted-harness-mysql -Dtest=NoUnitTestsInThisLane -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=HostedPublicWorkspaceIT \
  -Dnode.executable=/rig/scripts/node-probe.sh -Dqwen.cli.entry=/rig/wt/dist/cli.js "-DargLine=-Djava.io.tmpdir=/jvmtmp" verify > $O/$ARM-mvn.log 2>&1
RC=$?
sleep 1; kill $WPID $WPID2
T=$(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+.*HostedPublicWorkspaceIT' $O/$ARM-mvn.log | tail -1 | sed -E 's/^\[[A-Z]+\] //')
echo "RESULT linux-tmp $ARM exit=$RC ${T:-no-totals} $(java -version 2>&1 | head -1) node=$(node -v) kernel=$(uname -sr)"
find /tmp -mindepth 1 | sort > $O/$ARM-tmp-after.txt
echo "  /tmp entries after run: $(wc -l < $O/$ARM-tmp-after.txt)   /tmp events: $(wc -l < $O/$ARM-tmp-events.log)   /jvmtmp events: $(wc -l < $O/$ARM-jvmtmp-events.log)"
echo "  distinct top-level names seen under /tmp:"; awk '{print $3}' $O/$ARM-tmp-events.log | cut -d/ -f1 | sort | uniq -c | sed 's/^/    /'
echo "  harness probe:"; grep -E '^(=== .*role=harness|TMPDIR=|TMP=|TEMP=|os.tmpdir)' $O/$ARM-probe.log | head -6 | sed 's/^/    /'
