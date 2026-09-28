#!/bin/bash
# Apply one mutant in wt-mut (via mutate.sh's apply table) and run selected probe methods.
# Usage: mutate-probe.sh <mutant> <surefire -Dtest selector>
set -u
SP=<scratch>
WT=$SP/wt-mut
id=$1; sel=$2
OUT=$SP/r4ev/mutant-probes/$id
mkdir -p "$OUT"
D=packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker
cp $SP/probe-r2/W0eR2ProbeTest.java $SP/probe-r3/W0eR3ProbeTest.java "$WT/$D/"
# Reuse the apply() table from mutate.sh without running its loop.
eval "$(sed -n '/^apply() {/,/^}/p' $SP/mutate.sh)"
PKG=packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker
cd "$WT" && git checkout -q -- packages/sdk-java/runtime-broker/src/main
apply "$id"
n=$(git diff --numstat -- packages/sdk-java/runtime-broker/src/main | wc -l); [ "$n" -gt 0 ] || { echo "$id NOT APPLIED"; exit 1; }; git diff --stat -- packages/sdk-java/runtime-broker/src/main | tail -1| tail -1
cd "$WT/packages/sdk-java/runtime-broker"
W0E_OUT=$OUT JAVA_HOME=~/Install/jdk21 mvn -o -s $SP/m2-settings.xml -Dmaven.repo.local=$SP/m2repo \
  -Dcheckstyle.skip -Djacoco.skip=true -Pfault-gates -Dqwen.cli.entry=$SP/wt-r4/dist/cli.js \
  -Dtest="$sel" -Dsurefire.failIfNoSpecifiedTests=false test > "$OUT/mvn.log" 2>&1
echo "$id probes exit=$? $(grep -E 'Tests run:.*Fail' $OUT/mvn.log | tail -1)"
cd "$WT" && git checkout -q -- packages/sdk-java/runtime-broker/src/main
