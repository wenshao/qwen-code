#!/bin/bash
# Real CLI E2E for PR #11889: drives the built qwen bundle through
# install -> update -> uninstall while a live holder process keeps the
# Windows-shaped directory lock in place.
SP=/tmp/claude-0/-root-git-qwen-code-x7/5e16ff2c-2f87-4f11-a75d-5f19747a85c2/scratchpad
BUNDLE="$1"; LABEL="$2"
ROOT=${ROOTBASE:-$SP/cli}/$LABEL
QWEN_HOME_DIR=$ROOT/home
SRC=$ROOT/src
rm -rf "$ROOT"; mkdir -p "$QWEN_HOME_DIR" "$SRC/skills" "$ROOT/work"
cat > "$SRC/qwen-extension.json" <<'EOF'
{ "name": "e2e-lock-probe", "version": "1.0.0" }
EOF
echo "keep@1.0.0" > "$SRC/skills/keep.md"
echo "this file is dropped by v2" > "$SRC/dropped-by-v2.md"

export QWEN_HOME="$QWEN_HOME_DIR"
QWEN=("node" "--import" "$SP/harness/win32.mjs" "$BUNDLE/cli.js")
cd "$ROOT/work" || exit 1

say() { printf '\n\033[1;36m$ %s\033[0m\n' "$*"; }

say "qwen extensions install ./src --consent"
"${QWEN[@]}" extensions install "$SRC" --consent </dev/null 2>&1 | sed 's/^/  /'

# v2 of the source: version bumped, one file dropped, one file added
cat > "$SRC/qwen-extension.json" <<'EOF'
{ "name": "e2e-lock-probe", "version": "2.0.0" }
EOF
echo "keep@2.0.0" > "$SRC/skills/keep.md"
rm -f "$SRC/dropped-by-v2.md"
echo "this file is added by v2" > "$SRC/added-by-v2.md"

# A second Qwen Code session's recursive extension watcher, modelled by a live
# process holding one native directory handle per subdirectory.
python3 "$SP/lockfs/holder.py" "$QWEN_HOME_DIR/extensions" > "$ROOT/holder.log" 2>&1 &
HOLDER=$!
sleep 0.5
printf '\n\033[1;33m[holder]\033[0m %s (pid %s)\n' "$(cat "$ROOT/holder.log")" "$HOLDER"

export WINLOCK_ROOT="$QWEN_HOME_DIR/extensions"
export WINLOCK_LOG="$ROOT/winlock.log"
export LD_PRELOAD=$SP/lockfs/winlock.so

say "qwen extensions update e2e-lock-probe"
"${QWEN[@]}" extensions update e2e-lock-probe </dev/null 2>&1 | sed 's/^/  /'
printf '  \033[2m[exit %s]\033[0m\n' "${PIPESTATUS[0]}"

say "cat ~/.qwen/extensions/e2e-lock-probe/qwen-extension.json ; ls"
cat "$QWEN_HOME_DIR/extensions/e2e-lock-probe/qwen-extension.json" 2>&1 | sed 's/^/  /'
ls "$QWEN_HOME_DIR/extensions/e2e-lock-probe" 2>&1 | tr '\n' ' ' | sed 's/^/  /'; echo

say "qwen extensions uninstall e2e-lock-probe"
"${QWEN[@]}" extensions uninstall e2e-lock-probe </dev/null 2>&1 | sed 's/^/  /'
printf '  \033[2m[exit %s]\033[0m\n' "${PIPESTATUS[0]}"

say "ls ~/.qwen/extensions ; ls ~/.qwen/extension-store/{rollback,transactions}"
ls "$QWEN_HOME_DIR/extensions" 2>&1 | tr '\n' ' ' | sed 's/^/  /'; echo
printf '  rollback: %s\n' "$(ls "$QWEN_HOME_DIR/extension-store/rollback" 2>/dev/null | tr '\n' ' ')"
printf '  transactions: %s\n' "$(ls "$QWEN_HOME_DIR/extension-store/transactions" 2>/dev/null | tr '\n' ' ')"
unset LD_PRELOAD
kill $HOLDER 2>/dev/null
