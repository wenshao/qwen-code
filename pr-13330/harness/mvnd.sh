#!/bin/bash
# usage: mvnd.sh <worktree> <module-subdir> <mvn args...>  (CI-parity JDK 21 container)
WT=$1; shift; MOD=$1; shift
exec docker run --rm --network host \
  -v /root/.m2:/root/.m2:ro \
  -v ${M2LOCAL:-/root/verify/pr13330/m2local}:/m2local \
  -v /root/Install/maven:/opt/maven:ro -v /etc/machine-id:/etc/machine-id:ro \
  -v /root/verify/pr13330:/root/verify/pr13330 -w "$WT/$MOD" \
  ${DOCKER_EXTRA} \
  eclipse-temurin:21-jdk /opt/maven/bin/mvn --batch-mode --no-transfer-progress \
  -s /root/.m2/settings.xml -Dmaven.repo.local=/m2local -Dmaven.repo.local.tail=/root/.m2/repository "$@"
