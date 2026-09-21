#!/usr/bin/env bash
# Module gates (CI parity: Temurin 21 container) on the PR head and on the PR merged into current main.
set -u
H=/root/verify/pr12391-harness
L=$H/logs
rm -rf $H/trees && mkdir -p $H/trees/head $H/trees/merged
cp -a /root/verify/pr12391/packages/sdk-java $H/trees/head/
cp -a /root/verify/pr12391-merged/packages/sdk-java $H/trees/merged/
for arm in head merged; do
  for goal in "clean test" "checkstyle:check" "verify"; do
    tag=$(echo "$goal" | tr ' :' '__')
    docker run --rm --network host -v /root/.m2:/root/.m2 -v /root/Install/maven:/opt/maven:ro \
      -v $H/trees/$arm/sdk-java:/w -w /w/runtime-broker eclipse-temurin:21-jdk \
      bash -c "java -version 2>&1 | head -1; /opt/maven/bin/mvn -B -ntp $goal" > $L/mvn-$arm-$tag.log 2>&1
    echo "$arm | mvn $goal | exit=$? | $(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run:' $L/mvn-$arm-$tag.log | tail -1) | $(grep -E 'BUILD (SUCCESS|FAILURE)' $L/mvn-$arm-$tag.log | tail -1)" >> $L/module-gates.summary
  done
done
echo EXIT=done >> $L/module-gates.summary
