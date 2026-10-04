#!/bin/bash
# usage: run-one.sh <label> <scenario> <second-jar-arm: head|base> [first-jar-arm]
set -u
R=/Users/wenshao/git/pr13349-rig
label=$1; scenario=$2; arm=$3; first=${4:-$3}
export PATH="/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export TMPDIR=/private/tmp/claude-501/p13349
mkdir -p $TMPDIR
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
export LABEL=$label SCENARIO=$scenario OUT=$R/runs
export JAR_FIRST=$(ls $R/jars/server-$first-*.jar) JAR_SECOND=$(ls $R/jars/server-$arm-*.jar)
export CURRENT_CLI=/Users/wenshao/git/pr13349-head/dist/cli.js LEGACY_CLI=${LEGACY_CLI:-$R/legacy/package/cli.js}
start=$(date +%s)
cd /Users/wenshao/git/pr13349-head
rm -rf $R/runs/$label
node_modules/.bin/tsx $R/mixed-version.mts > $R/logs/run-$label.log 2>&1
code=$?
printf 'RESULT\t%s\t%s\tsecond=%s first=%s\texit=%s\t%ss\n' "$label" "$scenario" "$arm" "$first" "$code" $(( $(date +%s) - start )) | tee -a $R/results/runs.tsv
