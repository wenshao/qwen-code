#!/bin/bash
# VERIFICATION RIG ONLY (PR #13174): run one E2E arm N times from a worktree; RESULT lines go to results.txt
# usage: run-arm.sh <label> <worktree> <script> <reps> [runner args...]
set -u
RIG=/Users/wenshao/pr13174-rig; L=$1; W=$2; S=$3; N=$4; shift 4
export PATH=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin:/Users/wenshao/Install/jdk21/bin:/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:/usr/bin:/bin:/usr/sbin:/sbin
export JAVA_HOME=/Users/wenshao/Install/jdk21
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
mkdir -p $RIG/results
cd $W
for i in $(seq 1 $N); do
  O=$RIG/results/$L-run${i}.log
  t0=$(date +%s)
  ./node_modules/.bin/tsx $S "$@" > $O 2>&1
  rc=$?
  echo "RESULT $L run${i} rc=$rc secs=$(( $(date +%s) - t0 )) head=$(git -C $W rev-parse --short HEAD) $(date -u +%FT%TZ) load=$(uptime | sed 's/.*averages: //')" | tee -a $RIG/results/results.txt
done
