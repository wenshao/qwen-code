#!/bin/bash
# usage: run-arm.sh <label> <script-file> [args...]
# Runs the managed-agent server E2E runner from the PR worktree with the real
# toolchain (JDK 21, MySQL 8.4.7, Node 24) and records exit code + wall time.
set -u
LABEL="$1"; shift
SCRIPT="$1"; shift
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/45818484-3b6e-4eca-979e-aeef44012580/scratchpad
W=/Users/wenshao/git/qwen-code-pr12801
NODE_BIN="$(dirname "$(command -v node)")"
export PATH="/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin:$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin"
if [ -n "${NO_TOOLCHAIN:-}" ]; then export PATH="$NODE_BIN:/usr/bin:/bin"; fi
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
export JAVA_HOME=/Users/wenshao/Install/jdk21
export TMPDIR=/private/tmp/claude-501/p801
mkdir -p "$TMPDIR" "$SP/runs"
LOG="$SP/runs/$LABEL.log"
cd "${RUN_CWD:-$W}"
before=$(ls "$TMPDIR" | wc -l | tr -d ' ')
{
  echo "\$ cd ${RUN_CWD:-$W}"
  echo "\$ tsx $SCRIPT $*"
  echo "# head=$(git -C $W rev-parse --short HEAD) script-sha=$(shasum -a 256 "$W/$SCRIPT" | cut -c1-12) node=$(node -v) java=$(java -version 2>&1 | head -1 | cut -d'"' -f2) mysqld=$(command -v mysqld >/dev/null && mysqld --version | awk '{print $3}' || echo absent)"
} > "$LOG"
start=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
"$W/node_modules/.bin/tsx" "$W/$SCRIPT" "$@" >> "$LOG" 2>&1
code=$?
end=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
after=$(ls "$TMPDIR" | wc -l | tr -d ' ')
secs=$(perl -e "printf '%.1f', $end - $start")
echo "# exit=$code wall=${secs}s tmpdirs_before=$before tmpdirs_after=$after" >> "$LOG"
echo "$LABEL exit=$code wall=${secs}s tmp:$before->$after"
