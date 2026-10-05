#!/bin/bash
# usage: run-one.sh <label> <head|base> [runner args...]   (keep-tmp variant of scripts/run-managed-agent-server-e2e.ts)
set -u
V=/root/verify/pr13311
label="$1"; arm="$2"; shift 2
WT=$V/$arm
export PATH="$V/bin:/usr/local/jdk21/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export JAVA_HOME=/usr/local/jdk21
export TMPDIR=$V/e2e/$label
mkdir -p $TMPDIR
export QWEN_MANAGED_E2E_KEEP_TMP=1
log=$V/e2e/runs/$label.log
cd "$WT"
start=$(date +%s)
{
  echo "# label=$label arm=$arm args=$* head=$(git rev-parse --short HEAD) node=$(node -v) java=$(java -version 2>&1 | head -1) mysql=$(mysqld --version | awk '{print $3}') started=$(date '+%F %T')"
  node_modules/.bin/tsx scripts/e2e-v-keep.ts "$@" 2>&1
  echo "# exit=$?"
} > "$log" 2>&1
code=$(tail -1 "$log" | sed -n 's/^# exit=//p')
end=$(date +%s)
printf 'RESULT\t%s\t%s\t%s\texit=%s\t%ss\t%s\n' "$label" "$arm" "$*" "$code" $((end-start)) "$(date '+%T')" | tee -a $V/e2e/results.tsv
