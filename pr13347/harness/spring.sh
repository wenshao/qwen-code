#!/bin/bash
# usage: spring.sh <jar> <port> <db>  -- Spring Managed Agent Server with the
# Session Store enabled and no Harness, on the rig's MySQL 8.4.7 (UTC JVM).
set -euo pipefail
jar=$1; port=$2; db=$3
B=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin
$B/mysql --no-defaults -uroot -pruntime-broker -h127.0.0.1 -P13347 -e "CREATE DATABASE IF NOT EXISTS $db" 2>/dev/null
export SERVER_PORT=$port
export SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:13347/$db?useSSL=false&allowPublicKeyRetrieval=true"
export SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=runtime-broker
export QWEN_MANAGED_AGENT_HARNESS_ENABLED=false
export QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED=true
export QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL=http://127.0.0.1:$port
export QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION=60s
export QWEN_MANAGED_AGENT_WORKSPACE_ID=ws-13347
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
exec /Users/wenshao/Install/jdk21/bin/java -Duser.timezone=UTC -jar $jar
