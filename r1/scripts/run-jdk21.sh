#!/bin/bash
# usage: run-jdk21.sh <logname> <mvn args...>
H=/root/verify/pr12390-harness
log=$1; shift
docker run --rm --network host -e TZ=${TZ_IN:-UTC} \
  -v /root/.m2:/root/.m2 -v /root/Install/maven:/opt/maven:ro \
  -v $H/jdk21-tree/sdk-java:/w -w /w/runtime-broker \
  eclipse-temurin:21-jdk /opt/maven/bin/mvn --batch-mode --no-transfer-progress "$@" > $H/logs/$log 2>&1
echo "exit=$?" >> $H/logs/$log
