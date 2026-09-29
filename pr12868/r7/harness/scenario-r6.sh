#!/bin/bash
# One round-6 scenario on a fresh database and a fresh Broker.
# env SLOT=<kill|kill2> picks the ports, so two arms can run side by side.
# usage: scenario-r6.sh <arm> restart <mode v1|v2> <KILL|TERM> <db>
#        scenario-r6.sh <arm> lost    <mode v1|v2> -           <db>
SCRATCH=/rig-home
R=$SCRATCH/rig; ARM=$1; KIND=$2; MODE=$3; STOP=$4; DB=$5
NODE=/opt/node-22.23.2/bin/node
cd $R
SLOT=${SLOT:-kill}
if [ "$SLOT" = "kill2" ]; then HP=18889; BP=19889; PP=17889; else HP=18875; BP=19875; PP=17875; fi
unset LOG_ARM BROKER_TOKEN
export JAR_ARM=$ARM WORKER_ARM=$ARM STORAGES="a b c d" ROOTS=$R/roots-$DB
$R/restart-spring.sh $SLOT $DB $HP $BP $PP > /dev/null || exit 1
if [ "$KIND" = "restart" ]; then
  ARM=$ARM TAG=$SLOT STOP=$STOP DB=$DB HTTP_PORT=$HP BROKER_PORT=$BP PROXY_PORT=$PP $NODE s19-restart.mjs $MODE a 2>&1
else
  ARM=$ARM DB=$DB HTTP_PORT=$HP BROKER_PORT=$BP PROXY_PORT=$PP MODES=$MODE $NODE s18-r6.mjs X4 a,b,c,d 2>&1
fi
