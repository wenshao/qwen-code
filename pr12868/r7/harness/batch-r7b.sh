#!/bin/bash
# Round 7 on the head that merged main: the round-7 probes and the memory runs, on slot C.
# usage: batch-r7b.sh <head arm> <main arm> <db prefix>
SCRATCH=/rig-home
R=$SCRATCH/rig; H=$1; M=$2; P=$3
export PATH=/opt/node-22.23.2/bin:$PATH
cd $R
unset JAR_ARM WORKER_ARM STORAGES ROOTS LOG_ARM BROKER_TOKEN
ALL="a b c d e f g h i j k l m n o p"
stack() { JAR_ARM=$1 WORKER_ARM=$1 STORAGES="$ALL" ROOTS=$R/roots-$2 $R/restart-spring.sh r6c $2 18882 19882 17882 2>&1 | tail -1; sleep 4; }
run() { local arm=$1 db=$2; shift 2; env ARM=$arm DB=$db HTTP_PORT=18882 BROKER_PORT=19882 PROXY_PORT=17882 ROOTS=$R/roots-$db "$@" 2>&1 | grep -E "^\[FAIL\]|^\[SUMMARY\]|^\[result\]|^\[idle\]" | cut -c1-300; }
echo "== merge probes Y1 to Y5 $(date +%T)"; stack $H ${P}y
run $H ${P}y node s23-merge-r7.mjs Y1,Y2,Y3,Y4,Y5,Y6,Y7,Y8 a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p
if [ "${ONLY:-}" = "merge" ]; then echo "== done $(date +%T)"; exit 0; fi
echo "== Z $(date +%T)"; stack $H ${P}a
run $H ${P}a MODES=v2 node s21-r7.mjs Z1 a,b,c,d
run $H ${P}a MODES=v1 node s21-r7.mjs Z1,Z2,Z3
run $H ${P}a node s21-r7.mjs Z4
echo "== provider 300 $(date +%T)"; stack $H ${P}b; run $H ${P}b CONTENT_BYTES=204800 node s3-retention.mjs v2 300 a
echo "== provider 1000 $(date +%T)"; stack $H ${P}c; run $H ${P}c CONTENT_BYTES=204800 node s3-retention.mjs v2 1000 a
echo "== raw 300 head $(date +%T)"; stack $H ${P}d; run $H ${P}d CONTENT_BYTES=204800 MODE=v2 LETTER=a node s3b-retention-raw.mjs 300
if [ "$M" != "-" ]; then echo "== raw 300 main $(date +%T)"; stack $M ${P}e; sleep 5; run $M ${P}e CONTENT_BYTES=204800 MODE=v2 LETTER=a node s3b-retention-raw.mjs 300; fi
echo "== live model $(date +%T)"; stack $H ${P}f
env ARM=$H DB=${P}f HTTP_PORT=18882 BROKER_PORT=19882 PROXY_PORT=17882 ROOTS=$R/roots-${P}f node s6-hosted-real-model.mjs p 2>&1 | grep -E "^\[(T[0-9]|rows|setup|SUMMARY|FAIL|PASS)" | cut -c1-260
echo "== done $(date +%T)"
