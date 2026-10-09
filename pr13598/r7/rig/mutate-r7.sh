#!/bin/bash
# Round 7 mutation checks at 66af9bc185 (sources only; dist untouched; each mutant restored with git checkout).
#   M7  reconcile_run repairs while a turn holds the slot (round 6 survivor)
#   M8  P1-2 reverted: skip the release when the adopt answers runtime_session_not_acquirable
#   M9a P1-1 reverted at the publisher register: reference.promptId = mapped Runtime Session
#   M9b P1-1 reverted in prepareV3: reference.promptId = mapped Runtime Session
cd /Users/wenshao/git/pr13598-head
OUT=/Users/wenshao/git/pr13598-rig/mutation-r7.log; : > $OUT
LOGD=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/deaa1b6d-74de-4e5d-904a-dcd9872d7cc1/scratchpad/mut7; mkdir -p $LOGD
S=packages/cli/src/serve/hosted-harness-session.ts
T=packages/cli/src/serve/hosted-workspace-tool-turn.ts
W=packages/cli/src/serve/hosted-workspace-broker.ts
[ -z "$(git status --short)" ] || { echo "ABORT: worktree not clean" >> $OUT; exit 1; }
run(){ name=$1; file=$2; tests=$3; shift 3; python3 - "$file" "$@" <<'PY' || { echo "$name: MUTATION NOT APPLIED" >> $OUT; git checkout -q -- "$file"; return; }
import sys
p=sys.argv[1]; s=open(p).read()
pairs=sys.argv[2:]
for i in range(0,len(pairs),2):
    a,b=pairs[i],pairs[i+1]
    assert s.count(a)==1, (a[:60], s.count(a))
    s=s.replace(a,b)
open(p,'w').write(s)
PY
  (cd packages/cli && npx vitest run $tests > $LOGD/$name.log 2>&1); rc=$?
  echo "$name rc=$rc $(grep -E '^ +Tests ' $LOGD/$name.log | tail -1) :: $(grep -E '^ (FAIL|×) ' $LOGD/$name.log | head -5 | sed -E 's/^ FAIL  src\/serve\/[a-z-]+\.test\.ts > //' | tr '\n' '|' | cut -c1-700)" >> $OUT
  git checkout -q -- "$file"
}
run M9b-prepareV3-promptId $W "src/serve/hosted-workspace-broker.test.ts" "        promptId: turnId,
        callId,
        argsDigest,
      }," "        promptId: this.identity.runtimeSessionId,
        callId,
        argsDigest,
      },"
run M9a-publisher-promptId $T "src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-workspace-broker.test.ts" "                sessionId: this.broker.runtimeSessionId,
                promptId: this.promptId," "                sessionId: this.broker.runtimeSessionId,
                promptId: this.broker.runtimeSessionId,"
run M8-skip-release-on-not-acquirable $S "src/serve/hosted-harness-session.test.ts" "            try {
              await broker.acquire();
            } catch (cause) {
              if (
                !(
                  cause instanceof HostedWorkspaceBrokerRejection &&
                  cause.status === 409 &&
                  cause.code === 'runtime_session_not_acquirable'
                )
              ) {
                throw cause;
              }
            }
            await broker.release();" "            let acquiredForRelease = true;
            try {
              await broker.acquire();
            } catch (cause) {
              if (
                !(
                  cause instanceof HostedWorkspaceBrokerRejection &&
                  cause.status === 409 &&
                  cause.code === 'runtime_session_not_acquirable'
                )
              ) {
                throw cause;
              }
              acquiredForRelease = false;
            }
            if (acquiredForRelease) await broker.release();"
run M7-reconcile-ignores-live-turn $S "src/serve/hosted-harness-session.test.ts" "session.wakeAftermath !== undefined &&
            session.active === undefined &&" "session.wakeAftermath !== undefined &&"
git status --short >> $OUT; echo DONE >> $OUT
