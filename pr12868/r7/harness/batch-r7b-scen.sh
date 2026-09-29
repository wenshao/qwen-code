#!/bin/bash
# Round 7 on the head that merged main: the scenarios that need a Broker of their own, on the kill slot.
# usage: batch-r7b-scen.sh <head arm> <db prefix>
SCRATCH=/rig-home
R=$SCRATCH/rig; H=$1; P=$2
export PATH=/opt/node-22.23.2/bin:$PATH
cd $R
unset JAR_ARM WORKER_ARM STORAGES ROOTS LOG_ARM BROKER_TOKEN
keep() { grep -E "^\[FAIL\]|^\[SUMMARY\]" | cut -c1-300; }
echo "== X4 v2 $(date +%T)"; SLOT=kill $R/scenario-r6.sh $H lost v2 - ${P}a | keep
echo "== X4 v1 $(date +%T)"; SLOT=kill $R/scenario-r6.sh $H lost v1 - ${P}b | keep
echo "== M3p v2 $(date +%T)"; $R/kill-scenario.sh $H M3p v2 ${P}c | keep
echo "== M3r v2 $(date +%T)"; $R/kill-scenario.sh $H M3r v2 ${P}d | keep
echo "== M3p v1 $(date +%T)"; $R/kill-scenario.sh $H M3p v1 ${P}e | keep
echo "== restart v2 KILL $(date +%T)"; SLOT=kill $R/scenario-r6.sh $H restart v2 KILL ${P}f | keep
echo "== loss in flight v2 $(date +%T)"
JAR_ARM=$H WORKER_ARM=$H STORAGES="a b c d" ROOTS=$R/roots-${P}g $R/restart-spring.sh kill ${P}g 18875 19875 17875 > /dev/null
env ARM=$H DB=${P}g HTTP_PORT=18875 BROKER_PORT=19875 PROXY_PORT=17875 ROOTS=$R/roots-${P}g node s22-loss-in-flight.mjs v2 a 2>&1 | keep
for f in spring-kill proxy-kill; do [ -f $R/run/$f.pid ] && kill $(cat $R/run/$f.pid) 2>/dev/null; done
echo "== done $(date +%T)"
