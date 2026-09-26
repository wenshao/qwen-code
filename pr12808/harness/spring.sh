#!/bin/bash
# usage: spring.sh <jar> <httpPort> <harnessPort> <db> <name>
JAR=$1; HTTP=$2; HP=$3; DB=$4; NAME=$5
export SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:33808/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
export SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=rig12808
export QWEN_MANAGED_AGENT_HARNESS_ENABLED=true QWEN_MANAGED_AGENT_HARNESS_BASE_URL=http://127.0.0.1:$HP QWEN_MANAGED_AGENT_HARNESS_TOKEN=rig-harness-token
export QWEN_MANAGED_AGENT_CAPABILITY_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED=true QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL=http://127.0.0.1:$HTTP QWEN_MANAGED_AGENT_WORKSPACE_ID=rig-workspace
exec /Users/wenshao/Install/jdk21/bin/java -jar $JAR --server.port=$HTTP
