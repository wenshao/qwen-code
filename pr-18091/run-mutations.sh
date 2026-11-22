#!/usr/bin/env bash
# Mutation matrix for PR 18091. Each row reverts one guard the PR introduces,
# runs the one test that should catch it, then restores the file from git and
# proves the restore by sha256.
set -u
ART="$(cd "$(dirname "$0")" && pwd)"
TREE=/root/git/qwen-code-verify/.qwen/worktrees/pr18091-head
WS="$TREE/packages/web-shell"
PY="$ART/mutate.py"
LOG="$ART/logs"
mkdir -p "$LOG"

rows=()
run_row() {
  local id="$1" file="$2" old="$3" new="$4" testfile="$5" name="$6"
  local abs="$TREE/$file"
  local before after
  before=$(sha256sum "$abs" | cut -d' ' -f1)
  python3 "$PY" "$abs" "$old" "$new" > "$LOG/$id.mutate" 2>&1
  local mut=$?
  if [ "$mut" -ne 0 ]; then
    echo "$id SETUP-FAILED $(cat "$LOG/$id.mutate")"
    return
  fi
  ( cd "$WS" && npx vitest run "$testfile" -t "$name" > "$LOG/$id.log" 2>&1 )
  local summary
  summary=$(grep -aE 'Tests ' "$LOG/$id.log" | tail -1 | sed -r 's/\x1B\[[0-9;]*[mK]//g' | sed 's/^ *//')
  git -C "$TREE" checkout -- "$file"
  after=$(sha256sum "$abs" | cut -d' ' -f1)
  local restored=RESTORED
  [ "$before" = "$after" ] || restored=RESTORE-MISMATCH
  echo "$id | $summary | $restored"
}

CS=packages/web-shell/client/chat-core/ChatSurface.tsx
H=client/chat-core/ChatSurface.test.tsx
DC=packages/web-shell/client/daemon/chat-controller.ts
DCX=client/daemon/chat-controller.test.ts
UD=packages/web-shell/client/daemon/useDaemonChatController.ts
UDX=client/daemon/useDaemonChatController.test.tsx

PAG='defaults history pagination facts'
CAN='scopes cancel settlement errors'
PARK='parks and restores both the admission lock'
BIND='projects reactive transcript history pagination facts'
PROJ='projects live history pagination facts'

run_row M1 "$CS" 'hasOlderHistory={hasOlderHistory ?? controller.hasOlderHistory}' 'hasOlderHistory={hasOlderHistory || controller.hasOlderHistory}' "$H" "$PAG"
run_row M2 "$CS" 'historyPaginationError ?? controller.historyPaginationError' 'historyPaginationError || controller.historyPaginationError' "$H" "$PAG"
run_row M3 "$CS" 'loadingOlderHistory ?? controller.loadingOlderHistory' 'loadingOlderHistory || controller.loadingOlderHistory' "$H" "$PAG"
run_row M4 "$CS" 'historyCapacityReached ?? controller.historyCapacityReached' 'historyCapacityReached || controller.historyCapacityReached' "$H" "$PAG"
run_row M5 "$CS" '              .then((result) => {
                if (!isOwnerActive()) return;' '              .then((result) => {' "$H" "$CAN"
run_row M6 "$CS" '              .catch((cause: unknown) => {
                if (!isOwnerActive()) return;' '              .catch((cause: unknown) => {' "$H" "$CAN"
run_row M7 "$CS" '? refOwnerRef.current === cancelSessionId' '? ownerTokenRef.current === token' "$H" "$CAN"
run_row M8 "$CS" ': ownerTokenRef.current === token;' ': refOwnerRef.current === cancelSessionId;' "$H" "$CAN"
run_row M9 "$CS" "                if (ownerTokenRef.current !== token) {
                  if (result.admission === 'unknown') {" "                if (ownerTokenRef.current !== token) {
                  if (result.admission !== 'accepted') {" "$H" "$PARK"
run_row M10 "$UD" 'historyCapacityReached: transcriptHistory.capacityReached,' 'historyCapacityReached: false,' "$UDX" "$BIND"
run_row M11 "$DC" '    get hasOlderHistory() {
      return deps.hasOlderHistory;
    },' '    get hasOlderHistory() {
      return undefined;
    },' "$DCX" "$PROJ"
