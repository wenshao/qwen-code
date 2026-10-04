#!/bin/bash
# usage: run-e2e.sh <label> [runner args...]  -- the repo's own E2E runner on
# the head worktree (head jar in target/, head dist/cli.js).
set -u
R=/Users/wenshao/git/pr13336-rig
WT=/Users/wenshao/git/pr13336-head
label="$1"; shift
export PATH="/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export TMPDIR=/private/tmp/claude-501/p13336-e2e
mkdir -p $TMPDIR
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
log=$R/runs/e2e-$label.log
cd $WT
start=$(date +%s)
{
  echo "# label=$label args=$* head=$(git rev-parse --short HEAD) jar-sha=$(shasum -a 256 packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar | cut -c1-12) started=$(date '+%F %T')"
  node_modules/.bin/tsx scripts/run-managed-agent-server-e2e.ts "$@" 2>&1
  echo "# exit=$?"
} > "$log" 2>&1
code=$(tail -1 "$log" | sed -n 's/^# exit=//p')
printf 'RESULT\te2e-%s\t%s\texit=%s\t%ss\n' "$label" "$*" "$code" $(( $(date +%s) - start )) | tee -a $R/results/e2e.tsv
