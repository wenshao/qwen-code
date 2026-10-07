#!/bin/bash
# usage: build-java.sh <arm>   (arm = head|base)
ARM=$1
export JAVA_HOME=/root/Install/jdk21 PATH=/root/Install/jdk21/bin:/root/Install/maven/bin:$PATH
M2="-Dmaven.repo.local=/root/verify/pr13548/m2-$ARM -Dmaven.repo.local.tail=/root/.m2/repository"
cd /root/verify/pr13548/$ARM/packages/sdk-java
( cd qwencode && mvn -o -q $M2 -DskipTests -Dgpg.skip=true -Djacoco.skip=true -Dcheckstyle.skip -Dspotbugs.skip=true install ) && echo QWENCODE_OK
( cd runtime-broker && mvn -o -q $M2 -DskipTests -Dgpg.skip=true -Djacoco.skip=true -Dcheckstyle.skip -Dspotbugs.skip=true install ) && echo BROKER_OK
( cd managed-agent-server && mvn -o -q $M2 -Djacoco.skip=true test-compile ) && echo SERVER_COMPILE_OK
