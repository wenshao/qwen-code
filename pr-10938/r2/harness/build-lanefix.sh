#!/bin/bash
# Candidate fix for the cross-layer half of R6-3 (NOT part of the PR): derive the
# return-lane drop/rise shoulders and corner radius from the measured gutters,
# like the adjacent-edge shoulder already is. Builds a 4th bundle, runs the PR's
# PlanExecutionView suites with it applied, then restores the worktree.
set -euo pipefail
WT=/var/tmp/pr10938-wt; LOG=/root/git/pr10938-harness/r2/out
F=packages/web-shell/client/components/messages/PlanExecutionView.tsx
cd "$WT"
[ -z "$(git status --porcelain -- packages)" ] || { echo dirty; exit 1; }
python3 - "$F" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old_head = "      spanning.sort((a, b) => a.span - b.span);\n"
assert s.count(old_head) == 1
s = s.replace(old_head, """      const layerLeft = new Map<number, number>();
      const layerRight = new Map<number, number>();
      for (const [id, rect] of measuredNodes) {
        const layer = layerByTodoRef.current.get(id) ?? 0;
        layerLeft.set(layer, Math.min(layerLeft.get(layer) ?? Infinity, rect.left));
        layerRight.set(layer, Math.max(layerRight.get(layer) ?? -Infinity, rect.right));
      }
""" + old_head)
old = """        const dropX = edge.startX + 24;
        const riseX = edge.endX - 24;
"""
assert s.count(old) == 1
s = s.replace(old, """        const fromLayer = layerByTodoRef.current.get(edge.from) ?? 0;
        const toLayer = layerByTodoRef.current.get(edge.to) ?? 0;
        const dropRun = (layerLeft.get(fromLayer + 1) ?? edge.startX + 60) - 4 - edge.startX;
        const riseRun = edge.endX - ((layerRight.get(toLayer - 1) ?? edge.endX - 60) + 4);
        const dropShoulder = Math.min(24, dropRun / 2);
        const riseShoulder = Math.min(24, riseRun / 2);
        const corner = Math.min(EDGE_CORNER, dropShoulder / 2, riseShoulder / 2);
        const dropX = edge.startX + dropShoulder;
        const riseX = edge.endX - riseShoulder;
""")
start = s.index("        const riseX = edge.endX - riseShoulder;")
end = s.index("      const next = {", start)
seg = s[start:end]
assert seg.count("EDGE_CORNER") == 8, seg.count("EDGE_CORNER")
s = s[:start] + seg.replace("EDGE_CORNER", "corner") + s[end:]
open(p, "w").write(s)
print("patched")
PY
git diff > "$LOG/lanefix-candidate.patch"
git diff --stat | tail -1
(cd packages/web-shell && npx vitest run client/components/messages/PlanExecutionView > "$LOG/vitest-lanefix.log" 2>&1; echo "[lanefix] PR PlanExecutionView suites exit=$?"); grep -E "Tests " "$LOG/vitest-lanefix.log" | sed 's/\x1b\[[0-9;]*m//g'
rm -rf packages/web-shell/dist/assets
(cd packages/web-shell && npx vite build > "$LOG/build-lanefix.log" 2>&1)
rm -rf /var/tmp/pr10938-ws-lanefix-r2; mkdir -p /var/tmp/pr10938-ws-lanefix-r2
cp -r packages/web-shell/dist/index.html packages/web-shell/dist/assets /var/tmp/pr10938-ws-lanefix-r2/
git checkout -- packages/web-shell
npm run build --workspace packages/web-shell > "$LOG/build-head-full-2.log" 2>&1 && echo "[head] lib bundle restored"
git status --porcelain -- packages | head -3
cd /root/git/pr10938-harness && PORT=4941 DAEMON_PORT=4938 ROOT=/var/tmp/pr10938-ws-lanefix-r2 setsid node base-proxy.cjs >> r2/out/proxy-lanefix.log 2>&1 < /dev/null &
sleep 1; echo "[lanefix] proxy :4941 $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4941/)"
