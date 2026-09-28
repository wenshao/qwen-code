#!/bin/bash
# usage: restart-spring.sh <tag> <db> <http> <broker> <proxy>   (env: STORAGES JAR_ARM WORKER_ARM)
SCRATCH=/rig-home
R=$SCRATCH/rig; TAG=$1; DB=$2; HTTP=$3; BPORT=$4; PROXY=$5
NODE=/opt/node-22.23.2/bin/node
for f in spring-$TAG proxy-$TAG; do
  if [ -f $R/run/$f.pid ]; then kill $(cat $R/run/$f.pid) 2>/dev/null; fi
done
sleep 2
if [ "$PROXY" != "0" ]; then
  nohup $NODE $R/proxy.mjs $PROXY $R/run/ledger-$DB.jsonl > $SCRATCH/logs/proxy-$TAG.log 2>&1 &
  echo $! > $R/run/proxy-$TAG.pid
fi
: > $SCRATCH/logs/spring-$TAG.log
nohup $R/spring.sh $DB $HTTP $BPORT $PROXY > $SCRATCH/logs/spring-$TAG.log 2>&1 &
echo $! > $R/run/spring-$TAG.pid
for i in $(seq 1 90); do
  if grep -q "Started .* in .* seconds" $SCRATCH/logs/spring-$TAG.log; then break; fi
  if ! kill -0 $(cat $R/run/spring-$TAG.pid) 2>/dev/null; then echo "spring died"; tail -20 $SCRATCH/logs/spring-$TAG.log; exit 1; fi
  sleep 1
done
grep -c "Started" $SCRATCH/logs/spring-$TAG.log
echo "spring=$(cat $R/run/spring-$TAG.pid) proxy=$(cat $R/run/proxy-$TAG.pid 2>/dev/null)"
