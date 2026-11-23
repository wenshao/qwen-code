#!/usr/bin/env bash
# VERIFY-18177 mutation matrix: each mutant removes one guard from the head
# source, then runs the test the PR added for it. Every row is expected to turn
# red; a green row is a coverage gap and is reported as one.
set -uo pipefail
ARM=/root/git/qwen-code-verify/.qwen/worktrees/calm-leaf-f0d7ac/tmp/arms/head
ART=/root/git/qwen-code-verify/.qwen/worktrees/calm-leaf-f0d7ac/tmp/pr18177-verify-20261123-203907
LOG="$ART/logs/mutation-matrix.log"
: > "$LOG"
actions="packages/web-shell/client/daemon/session/actions.ts"
chatpane="packages/web-shell/client/components/ChatPane.tsx"

restore() {
  git -C "$ARM" checkout -- "$actions" "$chatpane"
}

run_case() {
  local name="$1" testfile="$2" pattern="$3"
  local out="$ART/logs/mutant-$name.log"
  ( cd "$ARM/packages/web-shell" && npx vitest run --config vitest.config.ts \
      "$testfile" -t "$pattern" ) > "$out" 2>&1
  local exit=$?
  local line
  line=$(grep -E "Tests +[0-9]+ (failed|passed)" "$out" | tail -1 | tr -s ' ')
  local failed
  failed=$(grep -cE "^ +× " "$out")
  local passed
  passed=$(grep -cE "^ +✓ " "$out")
  echo "$name | exit=$exit | failed=$failed passed=$passed | $line" | tee -a "$LOG"
}

restore
echo "== M1: drop the idempotencyKey assignment (actions.ts:1509) ==" | tee -a "$LOG"
python3 - "$ARM/$actions" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
needle = "          promptRequest['idempotencyKey'] = options.idempotencyKey;\n"
assert needle in s, 'M1 anchor missing'
s = s.replace(needle, "", 1)
open(p, 'w').write(s)
PY
run_case M1 client/daemon/session/actions.test.ts \
  'retries transient admission errors silently with the same idempotencyKey'
restore

echo "== M2: empty the retry schedule (actions.ts:843) ==" | tee -a "$LOG"
python3 - "$ARM/$actions" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
needle = "const PROMPT_ADMISSION_RETRY_DELAYS_MS = [400, 1200] as const;"
assert needle in s, 'M2 anchor missing'
s = s.replace(needle, "const PROMPT_ADMISSION_RETRY_DELAYS_MS = [] as const;", 1)
open(p, 'w').write(s)
PY
run_case M2 client/daemon/session/actions.test.ts \
  'retries transient admission errors silently with the same idempotencyKey'
restore

echo "== M3: drop the promptId auto-clear clause (ChatPane.tsx:652) ==" | tee -a "$LOG"
python3 - "$ARM/$chatpane" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
needle = """    if (renderedMatch.promptId) {
      updateFailedPrompt(null);
      return;
    }
"""
assert needle in s, 'M3 anchor missing'
s = s.replace(needle, "", 1)
open(p, 'w').write(s)
PY
run_case M3 client/components/ChatPane.test.tsx \
  'hides the resend indicator during streaming and auto-clears'
restore
echo "== restored: $(git -C "$ARM" status --porcelain | wc -l) modified files ==" | tee -a "$LOG"