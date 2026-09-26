#!/bin/zsh
# Failure / restart scenarios: each "JVM" line is a separate Broker process.
S=$SCRATCH
RIG=$S/rig; M=~/Install/mysql-8.4.7-macos15-arm64/bin/mysql
CLASSES=${CLASSES:-$RIG/classes-head}; CPF=${CPF:-$RIG/cp-head.txt}
ROOT="$(cd "$RIG/roots/根目录-Ünï-🚀" && pwd -P)"
export RIG ROOT QWEN_BUNDLE=$HOME/git/qwen-code-pr12730/dist/cli.js
jvm() { # tag db mode managed times watch
  echo "== JVM tag=$1 db=$2 mode=$3 managed=$4"
  RIG_TAG=$1 java -cp "$CLASSES:$(cat $CPF)" com.alibaba.qwen.code.runtimebroker.Rig warm $2 $3 $4 $5 $6 2>&1 | grep -v "^WARNING"
  echo "   (jvm exit=${pipestatus[1]})"
}
fresh() { $M -uroot -h127.0.0.1 -P13730 -e "DROP DATABASE IF EXISTS $1; CREATE DATABASE $1 CHARACTER SET utf8mb4"; }
launches() { echo "   launches so far for $1: $(grep -c "tag=$1" $RIG/launches.log)"; grep "tag=$1" $RIG/launches.log | sed 's/^/     /'; }
: > $RIG/launches.log
for s in ${=SCENARIOS:-fail hang late crash}; do
  echo; echo "######## scenario $s"
  fresh r_$s
  case $s in
    fail)  jvm fail1 r_fail fail true 3 0; launches fail1
           jvm fail2 r_fail real true 2 0; launches fail2 ;;
    hang)  jvm hang1 r_hang hang true 1 40; launches hang1
           jvm hang2 r_hang real true 1 0; launches hang2 ;;
    late)  jvm late1 r_late late true 1 25; launches late1
           jvm late2 r_late real true 1 0; launches late2 ;;
    crash) jvm crash1 r_crash crash-parent true 1 0; launches crash1
           $M -uroot -h127.0.0.1 -P13730 -N -e "SELECT CONCAT('   db after crash: state=',binding_state,' has_handle=',resource_handle_json IS NOT NULL,' owner=',IFNULL(operation_owner,'-'),' has_lease=',runtime_lease_id IS NOT NULL) FROM r_crash.qwen_runtime_binding"
           jvm crash2 r_crash real true 2 0; launches crash2 ;;
    legacyfail) jvm lf1 r_legacyfail fail false 2 0; launches lf1 ;;
  esac
done
