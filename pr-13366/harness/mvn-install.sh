#!/bin/bash
export JAVA_HOME=/usr/local/jdk21 PATH=/usr/local/jdk21/bin:$PATH
W=/root/verify/pr13366/head/packages/sdk-java
for m in qwencode runtime-broker; do
  (cd $W/$m && mvn -B --no-transfer-progress -Dmaven.repo.local=/root/verify/pr13366/m2 -Dmaven.repo.local.tail=/root/.m2/repository install -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dmaven.javadoc.skip=true -Dgpg.skip=true) || { echo "EXIT=1 $m"; exit 1; }
done
echo EXIT=0
