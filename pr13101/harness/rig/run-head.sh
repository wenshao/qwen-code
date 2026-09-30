#!/bin/bash
# VERIFICATION RIG ONLY: the whole probe sequence against one PR head jar.  usage: run-head.sh <jar-label> <db-prefix> <main-jar-label>
cd /rig
export JAR=$1 DIST=merge; PFX=$2; MAINJAR=$3
P() { (cd probe && node "$@" 2>&1 | grep -E "^(FAIL|==|#|NOTE  (outcome|Java server|60 s after|\[$MAINJAR\]))" | cut -c1-260); }
R() { ./stop.sh $DB spring > /dev/null; ./spring.sh $JAR $DB "$@" | tail -1; }
for d in $(ls run); do [ -f run/$d/spring.pid ] || [ -f run/$d/harness.pid ] || [ -f run/$d/model.pid ] || [ -f run/$d/tap.pid ] && ./stop.sh $d all > /dev/null 2>&1; done
# --- main sequence
export DB=$PFX; rm -rf run/$DB out/$DB; ./aux.sh $DB > /dev/null
./spring.sh $JAR $DB default absent | tail -1; ./harness.sh $DB merge | tail -1
P s1-testplan.mjs public ws-a a; P s1-testplan.mjs web ws-a a; P s2-decisions.mjs ws-b b; P s5-faults.mjs ws-d d
P s6-sse.mjs ws-c c; P s10-busy.mjs ws-c c; P s12-misc.mjs ws-f f; P s13-visibility.mjs ws-f f
P s11-skew.mjs strip default ws-b b
R default 8s; P s3-expiry.mjs ws-c c
R auto-edit absent; P s4-modes.mjs auto-edit ws-c c
R absent absent; P s4-modes.mjs yolo ws-c c; P s11-skew.mjs strip yolo ws-b b
R default 45s; RUN=r1 TMO=120s P s7-restart.mjs ws-e e 0
RUN=r2 TMO=30s P s7-restart.mjs ws-g g 35000
P s7c-harness-restart.mjs ws-a a
./stop.sh $DB all > /dev/null
# --- database created by main, then upgraded to the PR head
export DB=${PFX}u; rm -rf run/$DB out/$DB; ./aux.sh $DB > /dev/null
./spring.sh $MAINJAR $DB absent absent | tail -1; ./harness.sh $DB merge | tail -1
BASE_V=23 P s8a-base.mjs
P s7b-midturn-restart.mjs $MAINJAR ws-d d
./stop.sh $DB spring > /dev/null; ./stop.sh $DB harness > /dev/null
./spring.sh $JAR $DB default absent | tail -1; ./harness.sh $DB merge | tail -1
BASE_V=23 NEW_V=24 P s8b-upgraded.mjs
P s1-testplan.mjs public ws-b b
./stop.sh $DB all > /dev/null
# --- startup matrix
./startup-matrix.sh $JAR > /dev/null
echo "matrix $JAR: $(grep -c STARTS out/d6val_$JAR/startup-matrix.log) start / $(grep -c REFUSES out/d6val_$JAR/startup-matrix.log) refuse"
# --- real model
export DB=${PFX}real; rm -rf run/$DB out/$DB; ./aux.sh $DB > /dev/null
./spring.sh $JAR $DB default absent | tail -1
export MODEL_NAME=qwen3.8-max
export MODEL_URL=$(node -e 'const s=require(process.env.HOME+"/.qwen/settings.json");const m=(s.modelProviders.openai||[]).find(m=>m.id==="qwen3.8-max");process.stdout.write(m.baseUrl)')
export MODEL_KEY=$(node -e 'const s=require(process.env.HOME+"/.qwen/settings.json");const m=(s.modelProviders.openai||[]).find(m=>m.id==="qwen3.8-max");process.stdout.write(s.env[m.envKey]||"")')
./harness.sh $DB merge | tail -1
unset MODEL_KEY MODEL_URL MODEL_NAME
(cd probe && node s14-real-model.mjs ws-a a 2>&1 | grep -E "^(FAIL|==|#|PASS)" | cut -c1-260)
./stop.sh $DB all > /dev/null
echo "RUN-HEAD-DONE $JAR $(date -u +%T)"
