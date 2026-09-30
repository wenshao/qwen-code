#!/bin/bash
# Start the real base and head Spring Boot jars against the dedicated MySQL 8.4.
set -u
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/12fa9b24-1d30-4fad-b831-ba32169a2e71/scratchpad
J=/Users/wenshao/Install/jdk21/bin/java
OUT=$SP/pr12998/rig
mkdir -p "$OUT"
start() {
  local arm=$1 port=$2 db=$3 jar=$4
  TZ=UTC \
  SERVER_PORT=$port \
  SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:33998/$db?allowPublicKeyRetrieval=true&useSSL=false" \
  SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=pr12998 \
  nohup "$J" -Duser.timezone=UTC -jar "$jar" > "$OUT/$arm.log" 2>&1 &
  echo $! > "$OUT/$arm.pid"
  echo "$arm pid $(cat "$OUT/$arm.pid") port $port"
}
start head 18998 ma_head "$SP/wt-pr/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar"
start base 18999 ma_base "$SP/wt-base/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar"
for i in $(seq 1 90); do
  h=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18998/actuator/health)
  b=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18999/actuator/health)
  [ "$h" = 200 ] && [ "$b" = 200 ] && break
  sleep 2
done
echo "health head=$h base=$b"
