#!/bin/bash
# usage: run.sh <arm> <label> <runner: x5|rig> [runner args...]; env RIG_* passed through.
RIG=/Users/wenshao/pr13366-rig; ARM=$1; LABEL=$2; R=$3; shift 3
W=$RIG/src-$ARM; O=$RIG/out/runs/$LABEL; rm -rf $O; mkdir -p $O
case $R in x5) F=scripts/run-sws-x5.ts;; rig) F=scripts/rig-sws.ts;; *) echo bad runner; exit 2;; esac
export RIG_LOG_DIR=$O RIG_ARM=$ARM PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:/Users/wenshao/Install/jdk21/bin:$PATH JAVA_HOME=/Users/wenshao/Install/jdk21
echo "=== $(date +%T) $LABEL node=$(node -v) arm=$ARM ($(git -C $W rev-parse --short HEAD)) runner=$R args=$* load=$(uptime | sed 's/.*load averages: //')" | tee $O/run.log
env | grep '^RIG_' | sort >> $O/run.log
START=$(date +%s)
(cd $W && perl -e "alarm 900; exec @ARGV" ./node_modules/.bin/tsx $F --second-workspace-session "$@") >> $O/run.log 2>&1
echo "[$LABEL] exit=$? wall=$(( $(date +%s) - START ))s" | tee -a $O/run.log
