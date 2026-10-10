#!/bin/bash
# usage: mvn.sh <arm> <module> <cpus> <mem> <mvn args...>   (CI-parity JDK 21 container, per-arm local repo)
arm=$1; mod=$2; cpus=$3; mem=$4; shift 4
R=/root/pr13330-r3
mkdir -p $R/m2/$arm
exec docker run --rm --init --network host --cpus=$cpus --memory=$mem \
  -v /root/.m2/repository:/m2home:ro -v /root/.m2/settings.xml:/settings.xml:ro \
  -v $R:$R -v /etc/machine-id:/etc/machine-id:ro -v /usr/bin/node:/usr/local/bin/node:ro \
  -w $R/trees/$arm/packages/sdk-java/$mod ${DOCKER_EXTRA} maven:3.9.11-eclipse-temurin-21 \
  mvn --batch-mode --no-transfer-progress -s /settings.xml \
  -Dmaven.repo.local=$R/m2/$arm -Dmaven.repo.local.tail=/m2home \
  -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true -Dgpg.skip=true "$@"
