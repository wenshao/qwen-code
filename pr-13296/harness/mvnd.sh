#!/bin/bash
# usage: mvnd.sh <worktree> <module-subdir> <mvn args...>
WT=$1; shift; MOD=$1; shift
exec docker run --rm --network host \
  -v /root/.m2:/root/.m2:ro \
  -v ${M2LOCAL:-/root/verify/pr13296/m2local}:/m2local \
  -v /root/Install/maven:/opt/maven:ro -v /etc/machine-id:/etc/machine-id:ro \
  -v "$WT":"$WT" -w "$WT/$MOD" \
  -e QWEN_O4_MYSQL_PASSWORD=pr13296 \
  eclipse-temurin:21-jdk /opt/maven/bin/mvn --batch-mode --no-transfer-progress \
  -s /root/.m2/settings.xml -Dmaven.repo.local=/m2local -Dmaven.repo.local.tail=/root/.m2/repository "$@"
