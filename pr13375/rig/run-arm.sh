#!/bin/bash
# usage: run-arm.sh <worktree> <runner-relative-path> <log> [extra env assignments...] -- [runner args]
# Runs one E2E arm with Java 21, MySQL 8.4.7 and Node 22 first on PATH.
set -u
WT=$1; RUNNER=$2; LOG=$3; shift 3
ENVS=(PROBE_NOOP=1)
while [ $# -gt 0 ] && [ "$1" != "--" ]; do ENVS+=("$1"); shift; done
[ "${1:-}" = "--" ] && shift
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fa427b97-be17-4fef-8cd0-0e8d0787846e/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21
NODE22=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin
export PATH=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin:$JAVA_HOME/bin:$NODE22:$PATH
cd "$WT" || exit 2
START=$(date +%s)
env "${ENVS[@]}" QWEN_MANAGED_E2E_KEEP_TMP=1 "$SP/wt-pr/node_modules/.bin/tsx" "$RUNNER" "$@" > "$LOG" 2>&1
CODE=$?
echo "EXIT=$CODE elapsed=$(( $(date +%s) - START ))s node=$(node -v) java=$(java -version 2>&1 | head -1) mysqld=$(mysqld --version | awk '{print $3}')" >> "$LOG"
exit $CODE
