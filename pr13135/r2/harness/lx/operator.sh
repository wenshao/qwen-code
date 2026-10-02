#!/bin/bash
# VERIFICATION RIG ONLY: offline operator recovery command (WorkspaceRecoveryCommand) inside the container.  usage: operator.sh <db> <jar> <args...>
# Configuration goes through -D system properties: the command counts every program argument.
. /Users/wenshao/pr13135-rig/lx/env.sh
DB=$1; L=$2; shift 2; RUN=$VAR/run/$DB
$JAVA -Duser.timezone=UTC -Dloader.main=com.alibaba.qwen.code.managedagent.service.WorkspaceRecoveryCommand \
  "-Dspring.datasource.url=jdbc:mysql://$DBHOST:$DBPORT/$DB?allowPublicKeyRetrieval=true&useSSL=false" -Dspring.datasource.username=root -Dspring.datasource.password=$DBPASS \
  -Dqwen.managed-agent.runtime-broker.enabled=true -Dqwen.managed-agent.runtime-broker.durable-local-process=true -Dqwen.managed-agent.runtime-broker.operator-recovery-enabled=true \
  -Dqwen.managed-agent.runtime-broker.state-directory=$RUN/${STATE:-broker} -Dqwen.managed-agent.runtime-broker.credential-key-id=rig -Dqwen.managed-agent.runtime-broker.credential-key=$CREDKEY \
  -Dqwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=${TRUSTED:-false} -Dspring.main.banner-mode=off -Dlogging.level.root=WARN \
  -cp $RIG/server/$L-server.jar org.springframework.boot.loader.launch.PropertiesLauncher "$@" 2>&1
