#!/bin/bash
# Negative probes for "exits before starting anything else when a command or a
# required file is missing". The script under test runs unmodified; java,
# mysqld, mysql and mysqladmin are replaced on PATH by wrappers that append one
# line to invocations.log and then exec the real binary, so an empty log means
# the script started none of them.
# usage: path-probe.sh <arm> <probeName> <maskedCommand|none> <cwdMode> [script args...]
#   cwdMode: root | nocli | nojar
# env:   PATH_TAIL=1 appends the original PATH after the wrapper directory
set -uo pipefail
ARM="$1"; NAME="$2"; MASK="$3"; CWDMODE="$4"; shift 4
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ca10fe78-f90a-48aa-bd99-da21179043ff/scratchpad
WT="$S/wt-$ARM"
OUT="$S/runs/$NAME"
rm -rf "$OUT.prev"; [ -d "$OUT" ] && mv "$OUT" "$OUT.prev"
mkdir -p "$OUT/shim"
LOG="$OUT/invocations.log"; : >"$LOG"
REAL_NODE="$(command -v node)"
JAVA_BIN="$HOME/Install/jdk21/bin/java"
MYSQL_BIN="$HOME/Install/mysql-8.4.7-macos15-arm64/bin"
ln -s "$REAL_NODE" "$OUT/shim/node"
[ "$MASK" = which ] || ln -s /usr/bin/which "$OUT/shim/which"
for name in java mysqld mysql mysqladmin; do
  [ "$name" = "$MASK" ] && continue
  if [ "$name" = java ]; then real="$JAVA_BIN"; else real="$MYSQL_BIN/$name"; fi
  printf '#!/bin/sh\necho "$(/bin/date +%%H:%%M:%%S) %s $*" >> "%s"\nexec "%s" "$@"\n' "$name" "$LOG" "$real" >"$OUT/shim/$name"
  chmod 755 "$OUT/shim/$name"
done
case "$CWDMODE" in
  root) CWD="$WT" ;;
  nocli)
    CWD="$OUT/fakeroot"; mkdir -p "$CWD/packages/sdk-java/managed-agent-server/target"
    ln -s "$WT/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar" "$CWD/packages/sdk-java/managed-agent-server/target/" ;;
  nojar)
    CWD="$OUT/fakeroot"; mkdir -p "$CWD"
    ln -s "$WT/dist" "$CWD/dist" ;;
esac
export TMPDIR="/private/tmp/claude-501/p13093/$NAME"
rm -rf "$TMPDIR"; mkdir -p "$TMPDIR"
ORIGINAL_PATH="$PATH"
if [ "${PATH_TAIL:-0}" = "1" ]; then RUNPATH="$OUT/shim:$ORIGINAL_PATH"; else RUNPATH="$OUT/shim"; fi
cd "$CWD" || exit 97
T0=$("$REAL_NODE" -e 'console.log(Date.now())')
PATH="$RUNPATH" "$REAL_NODE" "$WT/node_modules/tsx/dist/cli.mjs" "$WT/scripts/run-managed-agent-server-e2e.ts" "$@" >"$OUT/stdout.log" 2>"$OUT/stderr.log"
RC=$?
T1=$("$REAL_NODE" -e 'console.log(Date.now())')
ERR=$(grep -m1 -E '^\s*(Error|throw new Error|.*Error:)' "$OUT/stderr.log" | sed 's/^ *//' | cut -c1-220)
MSG=$(grep -m1 -oE 'Error: .*' "$OUT/stderr.log" | cut -c1-260)
LEFT=$(find "$TMPDIR" -maxdepth 1 -name 'managed-agent-server-e2e-*' | wc -l | tr -d ' ')
echo "RESULT probe=$NAME arm=$ARM masked=$MASK cwd=$CWDMODE args=[$*] rc=$RC ms=$((T1 - T0)) startedCommands=$(wc -l <"$LOG" | tr -d ' ') leftoverTempDirs=$LEFT message=[$MSG]" | tee "$OUT/RESULT"
