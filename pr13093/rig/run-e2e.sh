#!/bin/bash
# Runs one README command from the worktree root and records what it started.
# usage: run-e2e.sh <arm> <runName> <npm-script> [script args...]
# env:   TMP_MODE=short|default   (default: short)
#        JDK=21|26-path-default   (default: 21)
#        MYSQL=8.4|path-default   (default: 8.4)
set -uo pipefail
ARM="$1"; RUN="$2"; SCRIPT="$3"; shift 3
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ca10fe78-f90a-48aa-bd99-da21179043ff/scratchpad
WT="$S/wt-$ARM"
OUT="$S/runs/$RUN"
mkdir -p "$OUT"
ORIGINAL_PATH="$PATH"
if [ "${JDK:-21}" = "21" ]; then PATH="$HOME/Install/jdk21/bin:$PATH"; fi
if [ "${MYSQL:-8.4}" = "8.4" ]; then PATH="$HOME/Install/mysql-8.4.7-macos15-arm64/bin:$PATH"; fi
export PATH
if [ "${TMP_MODE:-short}" = "short" ]; then
  export TMPDIR="/private/tmp/claude-501/p13093/$RUN"
  mkdir -p "$TMPDIR"
else
  TMPDIR="$(getconf DARWIN_USER_TEMP_DIR)"; export TMPDIR="${TMPDIR%/}"
fi
cd "$WT" || exit 97
{
  echo "run=$RUN arm=$ARM script=$SCRIPT args=$*"
  echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "head=$(git rev-parse HEAD) tree=$(git rev-parse 'HEAD^{tree}') dirty=$(git status --short | wc -l | tr -d ' ')"
  echo "cwd=$PWD"
  echo "TMPDIR=$TMPDIR"
  echo "java=$(command -v java) :: $(java -version 2>&1 | head -1)"
  echo "mysqld=$(command -v mysqld) :: $(mysqld --version 2>&1)"
  echo "mysql=$(command -v mysql)"
  echo "mysqladmin=$(command -v mysqladmin)"
  echo "node=$(command -v node) :: $(node -v)"
  echo "dist/cli.js sha256=$(shasum -a 256 dist/cli.js 2>/dev/null | cut -c1-16) bytes=$(stat -f %z dist/cli.js 2>/dev/null)"
  echo "jar sha256=$(shasum -a 256 packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar 2>/dev/null | cut -c1-16)"
  echo "dist worker-named files: $(find dist -maxdepth 2 -name '*managed-runtime-worker*' 2>/dev/null | tr '\n' ' ')(end)"
} >"$OUT/env.txt" 2>&1

T0=$(date +%s)
if [ -n "${SCRIPT_FILE:-}" ]; then
  # Diagnostic arm: a modified copy of the runner, same cwd and artifacts.
  node "$WT/node_modules/tsx/dist/cli.mjs" "$SCRIPT_FILE" "$@" >"$OUT/stdout.log" 2>&1 &
else
  npm run "$SCRIPT" -- "$@" >"$OUT/stdout.log" 2>&1 &
fi
RUNNER=$!
node "$S/rig/watch-procs.mjs" "$RUNNER" "$OUT/procs.jsonl" "$WT/dist/" "$TMPDIR/managed-agent-server-e2e-" &
WATCH=$!
node "$S/rig/snap-settings-keys.mjs" "$TMPDIR" "$OUT/harness-settings-keys.txt" &
SNAP=$!
TAP=""
if [ "${TAP_RUN:-0}" = "1" ]; then node "$S/rig/tap-run.mjs" "$TMPDIR" "$OUT" "$(command -v mysql)" & TAP=$!; fi
wait "$RUNNER"; RC=$?
ELAPSED=$(( $(date +%s) - T0 ))
sleep 1
kill -TERM "$WATCH" 2>/dev/null; wait "$WATCH" 2>/dev/null
kill -TERM "$SNAP" 2>/dev/null; wait "$SNAP" 2>/dev/null
[ -n "$TAP" ] && { kill -TERM "$TAP" 2>/dev/null; wait "$TAP" 2>/dev/null; }
LEFT_DIRS=$(find "$TMPDIR" -maxdepth 1 -name 'managed-agent-server-e2e-*' 2>/dev/null | wc -l | tr -d ' ')
LEFT_PROCS=$(ps -axo pid=,command= | grep -F -e "$TMPDIR/managed-agent-server-e2e-" -e "$WT/dist/cli.js" | grep -v -e grep -e watch-procs | wc -l | tr -d ' ')
echo "RESULT run=$RUN arm=$ARM script=$SCRIPT rc=$RC seconds=$ELAPSED leftoverTempDirs=$LEFT_DIRS leftoverProcesses=$LEFT_PROCS head=$(git rev-parse --short=10 HEAD) dirtyAfter=$(git status --short | wc -l | tr -d ' ')" | tee "$OUT/RESULT"
exit 0
