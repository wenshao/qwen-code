#!/bin/bash
# usage: start-server.sh <arm> <port>
ARM=$1; PORT=$2
export SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:33356/xlang_${ARM}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
export SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=runtime-broker
export QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED=true
exec /root/Install/jdk21/bin/java -jar /root/verify/pr13355/jars/${ARM}.jar --server.port=${PORT}
