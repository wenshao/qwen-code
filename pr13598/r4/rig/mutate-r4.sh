#!/bin/bash
# Mutation checks on the head worktree's sources (dist untouched); each mutant is restored with git checkout.
cd /Users/wenshao/git/pr13598-head; OUT=/Users/wenshao/git/pr13598-rig/mutation-r4.log; : > $OUT
S=packages/cli/src/serve/hosted-harness-session.ts; M=packages/cli/src/serve/hosted-harness-model.ts
run(){ name=$1; file=$2; shift 2; python3 - "$file" "$@" <<'PY' || { echo "$name: MUTATION NOT APPLIED" >> $OUT; return; }
import sys
p=sys.argv[1]; s=open(p).read()
pairs=sys.argv[2:]
for i in range(0,len(pairs),2):
    a,b=pairs[i],pairs[i+1]
    assert s.count(a)==1, (a, s.count(a))
    s=s.replace(a,b)
open(p,'w').write(s)
PY
  (cd packages/cli && npx vitest run $TESTS > /tmp/mut-$name.log 2>&1); rc=$?
  echo "$name rc=$rc $(grep -E '^ +Tests ' /tmp/mut-$name.log | tail -1) :: $(grep -E '^ (FAIL|×) ' /tmp/mut-$name.log | head -3 | tr '\n' ' ' | cut -c1-400)" >> $OUT
  git checkout -q -- $file
}
TESTS=src/serve/hosted-harness-session.test.ts
run M1-no-unblock $S "                      if (!runtimePending) {
                        session.blocked = false;
                      }" "                      void runtimePending;"
run M2-no-park-settlement $S "                            const broker = await stopParkedRuntimeExecutions({
                              session: session.managed,
                              promptId: turn.turnId,
                              brokerOptions,
                            });
                            await settleParkedTurnCancelled({
                              session: session.managed,
                              sessionId,
                              cwd: session.cwd,
                              promptId: turn.turnId,
                            });
                            await broker.release();" "                            void stopParkedRuntimeExecutions;"
run M3-fail-open $S "                          // block rather than let a fire run against it.
                          runtimePending = true;" "                          // block rather than let a fire run against it.
                          runtimePending = false;"
run M5-no-consume-retry $S "for (let attempt = 0; attempt < 3; attempt += 1) {" "for (let attempt = 0; attempt < 1; attempt += 1) {" "if (attempt === 2) throw cause;" "if (attempt === 0) throw cause;"
TESTS=src/serve/hosted-harness-model.test.ts
run M4-no-history-exclusion $M "const history: Content[] = excludeTerminallyEndedUserRecords(
      historyRecords,
    ).flatMap(" "const history: Content[] = [...historyRecords].flatMap("
git status --short >> $OUT; echo DONE >> $OUT
