#!/bin/bash
# usage: run-one.sh <label> <wt-pr|wt-base> [runner args...]   (always the keep-tmp variant)
set -u
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9916edfc-4afb-4950-bb15-6c228bcecde1/scratchpad
RIG=$SP/rig
label="$1"; arm="$2"; shift 2
WT=$SP/$arm
export PATH="/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export TMPDIR=/private/tmp/claude-501/p13311/$label
mkdir -p $TMPDIR
export QWEN_MANAGED_E2E_KEEP_TMP=1
n=$(ls $RIG/runs | grep -c '\.log$')
log=$(printf '%s/runs/%03d-%s.log' "$RIG" $((n+1)) "$label")
cd "$WT"
start=$(date +%s)
{
  echo "# label=$label arm=$arm args=$* head=$(git rev-parse --short HEAD) node=$(node -v) java=$(java -version 2>&1 | head -1) mysql=$(mysqld --version | awk '{print $3}') started=$(date '+%F %T')"
  node_modules/.bin/tsx scripts/e2e-v-keep.ts "$@" 2>&1
  echo "# exit=$?"
} > "$log" 2>&1
code=$(tail -1 "$log" | sed -n 's/^# exit=//p')
end=$(date +%s)
printf 'RESULT\t%s\t%s\t%s\texit=%s\t%ss\t%s\n' "$(basename "$log" .log)" "$arm" "$*" "$code" $((end-start)) "$(date '+%T')" | tee -a $RIG/results.tsv
