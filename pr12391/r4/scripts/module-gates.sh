#!/usr/bin/env bash
# R3 module gates (Temurin 21 container, CI parity) on 25a38c3 and on 25a38c3 merged into main.
set -u
R=/root/verify/pr12391-harness/r4; L=$R/logs
rm -rf $R/trees/head $R/trees/merged; mkdir -p $R/trees/head $R/trees/merged
cp -a /root/verify/pr12391-r4/packages/sdk-java $R/trees/head/
cp -a /root/verify/pr12391-r4-merged/packages/sdk-java $R/trees/merged/
: > $L/module-gates.summary
for arm in head merged; do
  for goal in "clean test" "checkstyle:check" "verify"; do
    tag=$(echo "$goal" | tr ' :' '__')
    docker run --rm --network host -v /root/.m2:/root/.m2 -v /root/Install/maven:/opt/maven:ro \
      -v $R/trees/$arm/sdk-java:/w -w /w/runtime-broker eclipse-temurin:21-jdk \
      bash -c "java -version 2>&1 | head -1; /opt/maven/bin/mvn -B -ntp $goal" > $L/mvn-$arm-$tag.log 2>&1
    echo "$arm | mvn $goal | exit=$? | $(command grep -E '^\[(INFO|WARNING|ERROR)\] Tests run:' $L/mvn-$arm-$tag.log | tail -1) $(command grep -E 'You have [0-9]+ Checkstyle' $L/mvn-$arm-$tag.log | tail -1) | $(command grep -E 'BUILD (SUCCESS|FAILURE)' $L/mvn-$arm-$tag.log | tail -1)" >> $L/module-gates.summary
  done
done
echo EXIT=done >> $L/module-gates.summary
