#!/bin/bash
# usage: run-e2e.sh <label> [runner args...]
set -u
label="$1"; shift
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin:$PATH
export TMPDIR=/Users/wenshao/git/pr13498-rig/t
export QWEN_MANAGED_E2E_KEEP_TMP=1
cd /Users/wenshao/git/pr13498-head
start=$(date +%s)
npx tsx scripts/run-managed-agent-server-e2e.keep.ts "$@" > /Users/wenshao/git/pr13498-rig/e2e-$label.log 2>&1
rc=$?
echo "RESULT label=$label exit=$rc seconds=$(( $(date +%s) - start ))" >> /Users/wenshao/git/pr13498-rig/e2e-$label.log
echo "RESULT label=$label exit=$rc"
