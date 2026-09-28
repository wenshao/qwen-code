#!/bin/bash
# usage: kill-scenario.sh <arm> <group M3p|M3r> <mode v1|v2> <tag>
# One worker-death scenario on a fresh database and a fresh Broker, because a
# lost placement refuses later placements of the tenant.
SCRATCH=/rig-home
R=$SCRATCH/rig; ARM=$1; GROUP=$2; MODE=$3; TAG=$4
NODE=/opt/node-22.23.2/bin/node
cd $R
JAR_ARM=$ARM WORKER_ARM=$ARM STORAGES="a b c d" ROOTS=$R/roots-$TAG $R/restart-spring.sh kill $TAG 18875 19875 17875 > /dev/null || exit 1
ARM=$ARM DB=$TAG HTTP_PORT=18875 BROKER_PORT=19875 PROXY_PORT=17875 ROOTS=$R/roots-$TAG MODES=$MODE $NODE s13-merge.mjs $GROUP a,b,c,d 2>&1
mv $R/out/s13-merge-$ARM-$GROUP.log $R/out/s13-merge-$ARM-$GROUP-$MODE.log
