#!/bin/bash
# Round 5 mutation checks on the head worktree's sources (dist untouched); each mutant is restored with
# git checkout. Each runs the whole hosted-harness-session suite; suite failures are re-run alone later.
cd /Users/wenshao/git/pr13598-head
OUT=/Users/wenshao/git/pr13598-rig/mutation-r5.log; : > $OUT
LOGD=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/deaa1b6d-74de-4e5d-904a-dcd9872d7cc1/scratchpad/mut5; mkdir -p $LOGD
S=packages/cli/src/serve/hosted-harness-session.ts
[ -z "$(git status --short)" ] || { echo "ABORT: worktree not clean" >> $OUT; exit 1; }
run(){ name=$1; file=$2; shift 2; python3 - "$file" "$@" <<'PY' || { echo "$name: MUTATION NOT APPLIED" >> $OUT; git checkout -q -- "$file"; return; }
import sys
p=sys.argv[1]; s=open(p).read()
pairs=sys.argv[2:]
for i in range(0,len(pairs),2):
    a,b=pairs[i],pairs[i+1]
    assert s.count(a)==1, (a, s.count(a))
    s=s.replace(a,b)
open(p,'w').write(s)
PY
  (cd packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts > $LOGD/$name.log 2>&1); rc=$?
  echo "$name rc=$rc $(grep -E '^ +Tests ' $LOGD/$name.log | tail -1) :: $(grep -E '^ (FAIL|×) ' $LOGD/$name.log | head -4 | sed -E 's/^ FAIL  src\/serve\/hosted-harness-session.test.ts > //' | tr '\n' '|' | cut -c1-600)" >> $OUT
  git checkout -q -- "$file"
}
run M1-no-unblock-after-aftermath $S "                if (aftermath === 'settled') {
                  session.blocked = false;
                }" "                void aftermath;"
run M2-no-park-settlement $S "if (runtimeItems.some((item) => item.state === 'in_progress')) {" "if (false && runtimeItems.length < 0) {" "if (runtimeItems.length > 0) {" "if (false && runtimeItems.length > 0) {"
run M3-aftermath-fail-open $S "aftermath could not be settled: \${String(cause)}\`,
    );
    return 'pending';" "aftermath could not be settled: \${String(cause)}\`,
    );
    return 'settled';"
run M4-no-unanswered-exclusion $S "      (event.payload['outcome'] === 'error' ||
        event.payload['outcome'] === 'cancelled')" "      false"
run M5-no-consume-retry $S "for (let attempt = 0; attempt < 3; attempt += 1) {" "for (let attempt = 0; attempt < 1; attempt += 1) {" "if (attempt === 2) throw cause;" "if (attempt === 0) throw cause;"
run M6-no-wake-park-probe $S "if (await hasPendingWakePark(session)) {" "if (false && (await hasPendingWakePark(session))) {"
run M7-reconcile-ignores-live-turn $S "session.wakeAftermath !== undefined &&
            session.active === undefined &&" "session.wakeAftermath !== undefined &&"
git status --short >> $OUT; echo DONE >> $OUT
