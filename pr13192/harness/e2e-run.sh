#!/bin/bash
# usage: e2e-run.sh <head|base> <TZ> <mysql|mariadb> <port>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b5c403f1-14a1-452a-91d4-be31986042f6/scratchpad
ARM=$1; ZONE=$2; ENGINE=$3; PORT=$4
case $ENGINE in mysql) DBPORT=33192; C=pr13192-mysql;; mariadb) DBPORT=33193; C=pr13192-mariadb;; esac
ZN=$(echo $ZONE | tr '/' '_'); OUT=$S/results/e2e/$ENGINE/$ARM/$ZN; mkdir -p $OUT
export JAVA_HOME=$HOME/Install/jdk21
TZ=$ZONE $JAVA_HOME/bin/java -XshowSettings:properties -version 2>&1 | grep -E "user.timezone" > $OUT/jvm.txt
TZ=$ZONE \
SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:${DBPORT}/e2e_http?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=pr13192pw \
QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED=true \
  $JAVA_HOME/bin/java -jar $S/jars/server-$ARM.jar --server.port=$PORT > $OUT/server.log 2>&1 &
PID=$!
echo "PID=$PID" > $OUT/pid.txt
UP=0
for i in $(seq 1 120); do
  if curl -s -m 2 http://127.0.0.1:$PORT/actuator/health | grep -q UP; then UP=1; break; fi
  kill -0 $PID 2>/dev/null || break
  sleep 1
done
if [ $UP = 1 ]; then
  node $S/tsprobe/http-writer-probe.mjs http://127.0.0.1:$PORT "$ARM-$ENGINE-$ZN" $C e2e_http $OUT/raw.json > $OUT/raw.out 2>&1
  node $S/tsprobe/client-renew-probe.mjs http://127.0.0.1:$PORT "$ARM-$ENGINE-$ZN" 10000 $OUT/client.json > $OUT/client.out 2>&1
  tail -1 $OUT/raw.out; tail -1 $OUT/client.out
else
  echo "SERVER NOT UP"; tail -20 $OUT/server.log
fi
kill $PID 2>/dev/null; wait $PID 2>/dev/null
kill -0 $PID 2>/dev/null && echo "STILL ALIVE $PID" || echo "stopped $PID"
