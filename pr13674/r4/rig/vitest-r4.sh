#!/bin/bash
# Round 4 vitest windows on one arm.
A=${1:-h5}; W=/Users/wenshao/pr13674-rig/src-$A; O=/Users/wenshao/pr13674-rig/out; T=${2:-1}
echo "=== $(date +%T) load=$(sysctl -n vm.loadavg)"
(cd $W/packages/cli && npx vitest run src/serve/hosted-workspace-profiles.test.ts src/serve/hosted-workspace-tool-turn.child-agent.test.ts src/serve/hosted-workspace-tool-turn.team.test.ts src/serve/workspace-recovery-session.test.ts > $O/vt-$A-cli4-$T.log 2>&1); echo "[$A] cli 4 files exit=$? $(grep -E '^ +Tests ' $O/vt-$A-cli4-$T.log)"
(cd $W/packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts > $O/vt-$A-hhs-$T.log 2>&1); echo "[$A] hosted-harness-session exit=$? $(grep -E '^ +Tests ' $O/vt-$A-hhs-$T.log)"
(cd $W/packages/web-shell && npx vitest run client/src/managed/java-managed-agent-provider.test.ts client/src/managed/use-managed-actions.test.ts > $O/vt-$A-ws-$T.log 2>&1); echo "[$A] web-shell exit=$? $(grep -E '^ +Tests ' $O/vt-$A-ws-$T.log)"
echo "=== $(date +%T) VITEST-DONE load=$(sysctl -n vm.loadavg)"
