#!/bin/bash
# Round-7 regression batch on one arm: the probes of rounds 1 to 6, each group on a fresh database.
# usage: [JAR=<arm of the server jar>] [ATTEMPT_LIMIT_MS=30000] regress-r7.sh <arm> <db prefix>
# ATTEMPT_LIMIT_MS: how long a probe waits for one answer before it records "no answer" and goes on.
# JAR: a candidate Broker with the worker and the provider client of <arm>; logs carry its name.
SCRATCH=/rig-home
R=$SCRATCH/rig; ARM=$1; P=$2
export ATTEMPT_LIMIT_MS=${ATTEMPT_LIMIT_MS:-0}
export PATH=/opt/node-22.23.2/bin:$PATH
cd $R
unset JAR_ARM WORKER_ARM STORAGES ROOTS LOG_ARM BROKER_TOKEN
ALL="a b c d e f g h i j k l m n o p q r s t u v w x"
stack() { JAR_ARM=${JAR:-$ARM} WORKER_ARM=$ARM STORAGES="$2" ROOTS=$R/roots-$1 $R/restart-spring.sh r6a $1 18868 19868 17868 2>&1 | tail -1; }
run() { local db=$1; shift; env ARM=$ARM ${JAR:+LOG_ARM=$JAR} DB=$db HTTP_PORT=18868 BROKER_PORT=19868 PROXY_PORT=17868 ROOTS=$R/roots-$db node "$@" 2>&1 | grep -E "^\[FAIL\]|^\[SUMMARY\]" | cut -c1-300; }
echo "== stack ${P}a $(date +%T)"; stack ${P}a "a b c d e f g h i j k l m n o p q r s t"
echo "== s1"; run ${P}a s1-contract.mjs A,B,C,D a,b,c,d
echo "== s11"; run ${P}a s11-error-envelope.mjs P,Q,R,S k
echo "== s12"; run ${P}a s12-lost-control.mjs K,L q,r,s,t
echo "== s13"; run ${P}a s13-merge.mjs M1,M2,M4,M5 i,j,l,m
echo "== s15"; run ${P}a s15-fix.mjs U1,U1b,U2,U3,U4 e,f,g,h,n,o,p
echo "== s10"; run ${P}a s10-after-release.mjs
echo "== s8"; run ${P}a s8-limits.mjs
echo "== s5"; env ARM=$ARM ${JAR:+LOG_ARM=$JAR} DB=${P}a HTTP_PORT=18868 BROKER_PORT=19868 PROXY_PORT=17868 ROOTS=$R/roots-${P}a node s5-raw.mjs i j 2>&1 | grep -E "r1:|r2:|release" | cut -c1-260
echo "== stack ${P}b $(date +%T)"; stack ${P}b "a b c d e f g h"
echo "== s2"; run ${P}b s2-faults.mjs E,F,H,I e,f,g,h
echo "== stack ${P}c $(date +%T)"; stack ${P}c "$ALL"
echo "== s16 W1"; run ${P}c s16-r5.mjs W1 a,b,c,d,e,f,g,h
echo "== s16 W1d"; run ${P}c s16-r5.mjs W1d i,j,k,l
echo "== s16 W2W4W6"; run ${P}c s16-r5.mjs W2,W4,W6 m,n,o,p,q,r
echo "== stack ${P}d $(date +%T)"; stack ${P}d "$ALL"
echo "== s18 X1"; run ${P}d s18-r6.mjs X1 a,b,c,d,e,f,g,h
echo "== s18 X2"; run ${P}d s18-r6.mjs X2 a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x
echo "== s18 X2s"; MODES=v1 run ${P}d s18-r6.mjs X2s
echo "== s18 X5X6"; run ${P}d s18-r6.mjs X5,X6 a,b,c,d,e,f,g,h,i,j
JAR_ARM=$ARM; for f in spring-r6a proxy-r6a; do [ -f $R/run/$f.pid ] && kill $(cat $R/run/$f.pid) 2>/dev/null; done
echo "== done $(date +%T)"
