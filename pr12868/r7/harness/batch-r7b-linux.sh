#!/bin/bash
# Round 7 on the head that merged main, on Linux with the durable provisioner of #12865.
# usage: batch-r7b-linux.sh <arm> <db prefix>
SCRATCH=/rig-home
R=$SCRATCH/rig; H=$1; P=$2
export PATH=/opt/node-22.23.2/bin:$PATH
cd $R
unset JAR_ARM WORKER_ARM STORAGES ROOTS LOG_ARM BROKER_TOKEN
keep() { grep -E "^\[FAIL\]|^\[SUMMARY\]|acquire again" | cut -c1-300; }
n=0
for mode in v1 v2; do for stop in KILL TERM; do
  n=$((n+1)); db=${P}$n
  echo "== $mode $stop $(date +%T) $(docker exec pr12868-linux /rig/fresh.sh $db true)"
  env ARM=$H DB=$db MYSQL_PORT=13869 HTTP_PORT=18890 BROKER_PORT=19890 DURABLE=true STOP=$stop node s20-linux-restart.mjs $mode a 2>&1 | keep
done; done
db=${P}5
echo "== loss in flight v2 $(date +%T) $(docker exec pr12868-linux /rig/fresh.sh $db true)"
env ARM=$H DB=$db BOX=pr12868-linux LABEL=linux-durable MYSQL_PORT=13869 HTTP_PORT=18890 BROKER_PORT=19890 node s22-loss-in-flight.mjs v2 a 2>&1 | grep -E "^\[FAIL\]|^\[SUMMARY\]|OBSERVED" | cut -c1-300
echo "== done $(date +%T)"
