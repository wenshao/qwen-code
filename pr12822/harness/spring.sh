#!/bin/bash
# usage: spring.sh <jar> <httpPort> <harnessPort> <db> [extra spring args...]
JAR=$1; HTTP=$2; HP=$3; DB=$4; shift 4
export SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:33822/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
export SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=rig12822
export QWEN_MANAGED_AGENT_HARNESS_ENABLED=true QWEN_MANAGED_AGENT_HARNESS_BASE_URL=http://127.0.0.1:$HP QWEN_MANAGED_AGENT_HARNESS_TOKEN=rig-harness-token
export QWEN_MANAGED_AGENT_CAPABILITY_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED=true QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL=http://127.0.0.1:$HTTP QWEN_MANAGED_AGENT_WORKSPACE_ID=rig-workspace
exec $HOME/Install/jdk21/bin/java -jar $JAR --server.port=$HTTP "$@"
