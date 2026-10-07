#!/bin/bash
# VERIFICATION RIG ONLY (PR #13536). usage: spring-store.sh <jar> <port> <db>
# Spring Managed Agent Server with the Session Store enabled and no Harness (Session Store writer path only).
set -euo pipefail
R=/Users/wenshao/git/pr13536-rig
jar=$1; port=$2; db=$3
$R/sql.sh -e "CREATE DATABASE IF NOT EXISTS $db"
export SERVER_PORT=$port TZ=UTC
export SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:33536/$db?useSSL=false&allowPublicKeyRetrieval=true"
export SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=
export QWEN_MANAGED_AGENT_HARNESS_ENABLED=false
export QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED=true
export QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL=http://127.0.0.1:$port
export QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION=60s
export QWEN_MANAGED_AGENT_WORKSPACE_ID=ws-13536
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
exec /Users/wenshao/Install/jdk21/bin/java -jar $jar
