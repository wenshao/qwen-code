#!/bin/bash
# usage: mvn.sh <arm> <module> <cpus> <mem> <mvn args...>   (native JDK 21, per-arm local repo)
arm=$1; mod=$2; cpus=$3; mem=$4; shift 4
R=/root/pr13330-r4
mkdir -p $R/m2/$arm
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64
export PATH=$JAVA_HOME/bin:$PATH
cd $R/trees/$arm/packages/sdk-java/$mod
exec mvn --batch-mode --no-transfer-progress -s /root/.m2/settings.xml \
  -Dmaven.repo.local=$R/m2/$arm -Dmaven.repo.local.tail=/root/.m2/repository \
  -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true -Dgpg.skip=true "$@"
