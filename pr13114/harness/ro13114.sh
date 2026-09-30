#!/bin/bash
# PR #13114 on real Aliyun OSS (temporary private bucket). Faults are injected in a raw TCP
# forwarder (TLS bytes relayed unchanged; the JVM resolves the bucket host to 127.0.0.1).
# usage: ro13114.sh <arm> <jar> <worktree> <db> <group>
R=$(cd $(dirname $0); pwd); SP=$(dirname $R); TSX=/Users/wenshao/git/qwen-code-pr13114/node_modules/.bin/tsx
NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
ARM=$1; JAR=$2; WT=$3; DB=$4; GROUP=$5
export DB HARNESS_WT=$WT ROOTS=$R/roots-real-$ARM JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token REAL_OSS=1 LEDGER_LINES=20
LOG=$R/out/ro13114-$ARM-$GROUP.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/s3-faults.ts 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|objects|ops-|bytes|harness|status)" | grep -v "harness.*\[\]$" | cut -c1-400 | tee -a $LOG; }
real_infra() {
  # fake OSS off (it owns :443), admin stub on 18994, TCP forwarder on :443 -> real OSS.
  if [ -f $R/run/fake-oss.pid ] && kill -0 $(cat $R/run/fake-oss.pid) 2>/dev/null; then kill $(cat $R/run/fake-oss.pid); sleep 1; fi
  lsof -nP -iTCP:18994 -sTCP:LISTEN -t >/dev/null || (cd $R && nohup $NODE oss-admin-stub.mjs > run/oss-admin-stub.log 2>&1 & echo $! > $R/run/oss-admin-stub.pid)
  lsof -nP -iTCP:18898 -sTCP:LISTEN -t >/dev/null || (cd $R && TARGET=118.31.219.230:443 nohup $NODE tcp-forward.mjs > run/tcp-forward.log 2>&1 & echo $! > $R/run/tcp-forward.pid)
  sleep 2
}
start_real() { # operation-timeout claim-timeout floor
  $R/stop-spring.sh
  (cd $R && PUB_OPTIMEOUT=$1 PUB_CLAIM=$2 PUB_VBPS=$3 PUB_VMAX=25m SPRING_SH=spring-real.sh JVM_POST="-Djdk.net.hosts.file=$R/realoss-hosts" DB=$DB ROOTS=$ROOTS BROKER_TOKEN=$BROKER_TOKEN PUB_PORT=18895 $R/up-real.sh $JAR $WT | tee -a $LOG)
  say "## arm=$ARM jar=$JAR worker=$(git -C $WT rev-parse --short HEAD) db=$DB real OSS bucket qwen-pr13114-verify-xxxxxx operation-timeout=$1 claim-timeout=$2 floor=$3 B/s"
}
A='"armUrl":"http://127.0.0.1:18898/arm"'
real_infra
cd $R
case $GROUP in
B)  # big output, natural read-back time
  start_real 10s 5s 2097152
  run "RT2 100 MiB + 5 MiB at 10 s / 5 s (the round-15 RT2 configuration)" TAG=${ARM}rt2 ST=p51 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000 SHELL_TIMEOUT=600000
  ;;
B4)
  start_real 4s 2s 2097152
  run "RT4 100 MiB + 5 MiB at 4 s / 2 s, floor 2 MiB/s" TAG=${ARM}rt4 ST=p52 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000 SHELL_TIMEOUT=600000
  ;;
F)
  start_real 6s 3s 2097152
  run "RF1 baseline (6 s / 3 s)" TAG=${ARM}rf1 ST=p53
  run "RF2 segment stdout/2: its PUT body held 9 s in the tunnel" TAG=${ARM}rf2 ST=p54 RULES="[{\"match\":\"/segments/stdout/2(\\\\?|\$)\",\"action\":\"arm-oss\",$A,\"count\":1,\"oss\":{\"ms\":9000,\"dir\":\"up\",\"minBytes\":65536}}]"
  run "RF6 segment stdout/2: its PUT body held 4.5 s (claim-only lapse)" TAG=${ARM}rf6 ST=p55 RULES="[{\"match\":\"/segments/stdout/2(\\\\?|\$)\",\"action\":\"arm-oss\",$A,\"count\":1,\"oss\":{\"ms\":4500,\"dir\":\"up\",\"minBytes\":65536}}]"
  run "RF3 finish: a read-back GET body held 12 s (> 9 s finish window)" TAG=${ARM}rf3 ST=p56 RULES="[{\"match\":\"/finish(\\\\?|\$)\",\"action\":\"arm-oss\",$A,\"count\":1,\"oss\":{\"ms\":12000,\"dir\":\"down\",\"minBytes\":65536}}]"
  say "tunnel holds: $(curl -s http://127.0.0.1:18898/ledger | $NODE -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).filter(e=>e.hold))))')"
  ;;
esac
say "## done $(date +%T)"
