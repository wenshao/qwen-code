#!/bin/bash
# usage: spring.sh <jar> <httpPort> <harnessPort> <jdbcBase> <db> [extra spring args...]
# jdbcBase: mysql://127.0.0.1:33841 (MySQL 8.4.7) or mysql://127.0.0.1:33840 (MariaDB 10.11.18)
JAR=$1; HTTP=$2; HP=$3; JB=$4; DB=$5; shift 5
case $JB in *33840) PW=rig12840;; *) PW=rig12840;; esac
export SPRING_DATASOURCE_URL="jdbc:$JB/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
export SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=$PW
export QWEN_MANAGED_AGENT_HARNESS_ENABLED=true QWEN_MANAGED_AGENT_HARNESS_BASE_URL=http://127.0.0.1:$HP QWEN_MANAGED_AGENT_HARNESS_TOKEN=rig-harness-token
export QWEN_MANAGED_AGENT_CAPABILITY_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED=true QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL=http://127.0.0.1:$HTTP QWEN_MANAGED_AGENT_WORKSPACE_ID=rig-workspace
exec $HOME/Install/jdk21/bin/java -jar $JAR --server.port=$HTTP "$@"
