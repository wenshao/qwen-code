#!/bin/bash
# The author's proposed R8-2 fix (thread reply 2026-09-13), NOT in the PR: count
# the same live+transcript union the node's rows render. 5th bundle on :4942.
set -euo pipefail
WT=/var/tmp/pr10938-wt; LOG=/root/git/pr10938-harness/r2/out
F=packages/web-shell/client/components/messages/PlanExecutionView.tsx
cd "$WT"
[ -z "$(git status --porcelain -- packages)" ] || { echo dirty; exit 1; }
python3 - "$F" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = """                const agentCount = executions.reduce(
                  (count, tool) =>
                    count +
                    (isSubAgentToolCall(tool) ? 1 : 0) +
                    nestedAgentToolsForTool(tool).length,
                  0,
                );
"""
assert s.count(old) == 1
new = """                const agentCount = executions.reduce((count, tool) => {
                  const live = nestedTasksFromIndex(tool, taskIndex);
                  const liveCallIds = new Set(
                    live.flatMap(({ task }) => (task.toolUseId ? [task.toolUseId] : [])),
                  );
                  const transcriptOnly = nestedAgentToolsForTool(tool).filter(
                    ({ tool: nested }) => !liveCallIds.has(nested.callId),
                  );
                  return (
                    count +
                    (isSubAgentToolCall(tool) ? 1 : 0) +
                    live.length +
                    transcriptOnly.length
                  );
                }, 0);
"""
open(p, "w").write(s.replace(old, new)); print("patched")
PY
git diff > "$LOG/r8fix-candidate.patch"
set +e; (cd packages/web-shell && npx vitest run client/components/messages/PlanExecutionView client/components/workflow > "$LOG/vitest-r8fix.log" 2>&1; echo "[r8fix] suites exit=$?"); sed 's/\x1b\[[0-9;]*m//g' "$LOG/vitest-r8fix.log" | grep -E "Tests |FAIL |AssertionError" | head -6; set -e
rm -rf packages/web-shell/dist/assets
(cd packages/web-shell && npx vite build > "$LOG/build-r8fix.log" 2>&1)
rm -rf /var/tmp/pr10938-ws-r8fix-r2; mkdir -p /var/tmp/pr10938-ws-r8fix-r2
cp -r packages/web-shell/dist/index.html packages/web-shell/dist/assets /var/tmp/pr10938-ws-r8fix-r2/
git checkout -- packages/web-shell
npm run build --workspace packages/web-shell > "$LOG/build-head-full-3.log" 2>&1 && echo "[head] lib bundle restored"
git status --porcelain -- packages | head -3
cd /root/git/pr10938-harness && PORT=4942 DAEMON_PORT=4938 ROOT=/var/tmp/pr10938-ws-r8fix-r2 setsid node base-proxy.cjs >> r2/out/proxy-r8fix.log 2>&1 < /dev/null &
sleep 1; echo "[r8fix] proxy :4942 $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4942/)"
