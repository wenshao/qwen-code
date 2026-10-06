#!/bin/bash
# usage: run-e2e.sh <label> <arm: head|base|merge> [runner args...]
# The repo's own runner (scripts/run-managed-agent-server-e2e.ts) from the arm's
# worktree: that arm's dist/cli.js bundle + target/ jar + a private mysqld.
set -u
R=/Users/wenshao/git/pr13332-rig
label="$1"; arm="$2"; shift 2
WT=/Users/wenshao/git/pr13332-$arm
: "${MYSQL_BIN:=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin}"
: "${NODE_BIN:=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin}"
: "${JAVA_BIN:=/Users/wenshao/Install/jdk21/bin}"
export PATH="$NODE_BIN:$JAVA_BIN:$MYSQL_BIN:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export TMPDIR=/private/tmp/claude-501/p13332-e2e
export QWEN_MANAGED_E2E_KEEP_TMP="${KEEP_TMP:-0}"
mkdir -p $TMPDIR
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
n=$(ls $R/runs | grep -c '\.log$')
log=$(printf '%s/runs/%03d-%s.log' "$R" $((n+1)) "$label")
cd "$WT"
start=$(date +%s)
{
  echo "# label=$label arm=$arm args=$* head=$(git rev-parse --short=10 HEAD) jar=$(shasum -a 256 packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar | cut -c1-12) node=$(node -v) started=$(date '+%F %T')"
  node_modules/.bin/tsx scripts/run-managed-agent-server-e2e.ts "$@" 2>&1
  echo "# exit=$?"
} > "$log" 2>&1
code=$(tail -1 "$log" | sed -n 's/^# exit=//p')
printf 'RESULT\t%s\t%s\t%s\texit=%s\t%ss\t%s\n' "$(basename "$log" .log)" "$arm" "$*" "$code" $(( $(date +%s) - start )) "$(date '+%T')" | tee -a $R/results/e2e.tsv
