#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682 R2): bot finding R2-23. Run ManagedSessionLifecycleTest#renameStoreFailures...
# (3 phases) ROUNDS times on t3 (23316dd7, test before 7105fb1e) and h3 (7105fb1e), interleaved, same JVM/settings.
set -u
V=/root/v13682; L=$V/out/flake; mkdir -p $L; ROUNDS=${ROUNDS:-30}
export JAVA_HOME=/opt/jdk21 PATH=/opt/jdk21/bin:$V/tools/apache-maven-3.9.9/bin:$PATH TZ=UTC
R="-Dmaven.repo.local=$V/m2-h3 -Dmaven.repo.local.tail=/root/.m2/repository"
SEL="-Dtest=ManagedSessionLifecycleTest#renameStoreFailuresPreserveTheOriginalErrorAndAllowRetry -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip=true -Dspotbugs.skip=true -Djacoco.skip=true"
echo "FLAKE-START $(date -u +%T)" > $L/summary.log
for A in t3 h3; do (cd $V/$A/packages/sdk-java/managed-agent-server && nice -n 10 mvn -B -ntp -q $R $SEL test > $L/warm-$A.log 2>&1); echo "warm $A rc=$? $(grep -E 'Tests run:.*Fail' $L/warm-$A.log | tail -1)" >> $L/summary.log; done
for i in $(seq 1 $ROUNDS); do
  if [ $((i % 2)) = 1 ]; then ORDER="t3 h3"; else ORDER="h3 t3"; fi
  for A in $ORDER; do
    D=$V/$A/packages/sdk-java/managed-agent-server
    (cd $D && nice -n 10 mvn -B -ntp -o $R $SEL surefire:test > $L/$A-$i.log 2>&1); rc=$?
    X=$D/target/surefire-reports/TEST-com.alibaba.qwen.code.managedagent.ManagedSessionLifecycleTest.xml
    fails=$(python3 - "$X" <<'PY'
import sys, xml.etree.ElementTree as ET
try:
    t = ET.parse(sys.argv[1]).getroot()
except Exception as e:
    print("noxml"); sys.exit()
out = []
for c in t.iter("testcase"):
    bad = [x for x in c if x.tag in ("failure", "error")]
    if bad:
        msg = (bad[0].get("message") or "").replace("\n", " ")[:120]
        out.append(f"{c.get('name')}::{msg}")
print(f"run={len(list(t.iter('testcase')))} " + (" | ".join(out) if out else "green"))
PY
)
    cp $X $L/$A-$i.xml 2>/dev/null
    echo "$i $A rc=$rc $fails" >> $L/summary.log
  done
done
echo "FLAKE-DONE $(date -u +%T)" >> $L/summary.log
