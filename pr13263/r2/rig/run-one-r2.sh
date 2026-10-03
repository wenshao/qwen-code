#!/bin/bash
# usage: run-one.sh <label> <variant|head> [runner args...]
# variant "head" = the exact documented npm command on the unmodified PR file.
set -u
RIG=/Users/wenshao/git/pr13263-rig
WT=/Users/wenshao/git/pr13263-head
label="$1"; variant="$2"; shift 2
: "${MYSQL_BIN:=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin}"
: "${NODE_BIN:=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin}"
: "${JAVA_BIN:=/Users/wenshao/Install/jdk21/bin}"
export PATH="$NODE_BIN:$JAVA_BIN:$MYSQL_BIN:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export TMPDIR=/private/tmp/claude-501/p13263
export QWEN_MANAGED_E2E_KEEP_TMP="${KEEP_TMP:-0}"
n=$(ls $RIG/r2/runs | grep -c '\.log$')
log=$(printf '%s/r2/runs/%03d-%s.log' "$RIG" $((n+1)) "$label")
cd "$WT"
start=$(date +%s)
{
  echo "# label=$label variant=$variant args=$* head=$(git rev-parse --short HEAD) node=$(node -v) java=$(java -version 2>&1 | head -1) mysql=$(mysqld --version | awk '{print $3}') started=$(date '+%F %T')"
  if [ "$variant" = head ]; then
    echo "# cmd: npm run test:e2e:managed-agent-server -- $*  (sha256 $(shasum -a 256 scripts/run-managed-agent-server-e2e.ts | cut -c1-12))"
    if [ "${1:-}" = "--session-failover" ]; then
      npm run test:e2e:managed-session-failover 2>&1
    else
      npm run test:e2e:managed-agent-server -- "$@" 2>&1
    fi
  else
    echo "# cmd: tsx scripts/e2e-v-$variant.ts $*  (sha256 $(shasum -a 256 scripts/e2e-v-$variant.ts | cut -c1-12))"
    node_modules/.bin/tsx "scripts/e2e-v-$variant.ts" "$@" 2>&1
  fi
  echo "# exit=$?"
} > "$log" 2>&1
code=$(tail -1 "$log" | sed -n 's/^# exit=//p')
end=$(date +%s)
printf 'RESULT\t%s\t%s\t%s\texit=%s\t%ss\t%s\n' "$(basename "$log" .log)" "$variant" "$*" "$code" $((end-start)) "$(date '+%T')" | tee -a $RIG/r2/results.tsv
