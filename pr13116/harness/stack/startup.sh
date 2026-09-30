#!/bin/bash
# VERIFICATION RIG ONLY (PR 13116): does the packaged server start?  One line per case.
# usage: startup.sh <jar label> <case> [extra --key=value ...]
#   case default   : datasource only, G0 left at its defaults (disabled)
#   case supported : the full G0 deployment of spring.sh (explicitly enabled, valid)
#   case <other>   : the full G0 deployment plus the extra args (the invalid cases)
S=/Users/wenshao/pr13116-rig/stack; RIG=/Users/wenshao/pr13116-rig; L=$1; CASE=$2; shift 2
LOG=$S/logs/startup-$L-$CASE.log; : > $LOG
DB=st_${L}_${CASE//-/_}
if [ "$CASE" = default ]; then
  /Users/wenshao/Install/jdk21/bin/java -Duser.timezone=UTC -Dloader.path=$S/adapter/adapter.jar -cp $RIG/jars/$L.jar \
    org.springframework.boot.loader.launch.PropertiesLauncher --server.address=127.0.0.1 --server.port=18116 \
    "--spring.datasource.url=jdbc:mysql://127.0.0.1:23116/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
    --spring.datasource.username=root --spring.datasource.password=rig13116 "$@" > $LOG 2>&1 &
else
  $S/spring.sh $L $DB "$@" > $LOG 2>&1 &
fi
P=$!
OUT=timeout
for i in $(seq 1 240); do
  if /usr/bin/grep -q "Started ManagedAgentServerApplication" $LOG; then OUT=started; break; fi
  kill -0 $P 2>/dev/null || { OUT=exited; break; }
  sleep 1
done
PROBE=-
if [ $OUT = started ]; then
  PROBE=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Qwen-Tenant-Id: t-13116' -H 'X-Rig-Actor: alice' http://127.0.0.1:18116/v1/agents/workspaces)
  kill $P; for i in $(seq 1 60); do kill -0 $P 2>/dev/null || break; sleep 0.25; done; kill -9 $P 2>/dev/null
  pkill -P $P 2>/dev/null
fi
wait $P 2>/dev/null; RC=$?
CAUSE=$(/usr/bin/grep -o -E 'IllegalStateException: [^"]{0,160}' $LOG | tail -1)
echo "RESULT startup jar=$L case=$CASE outcome=$OUT exit=$RC GET/v1/agents/workspaces=$PROBE cause=${CAUSE:-none}"
