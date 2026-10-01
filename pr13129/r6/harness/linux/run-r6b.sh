#!/bin/sh
export PATH=/lx/node-v22.23.2-linux-arm64/bin:$PATH
killw() { for p in $(ps -eo pid,args | awk '/[m]anaged-runtime-worker/{print $1}'); do kill $p 2>/dev/null; done; sleep 2; echo "workers left: $(ps -eo args | grep -c '[m]anaged-runtime-worker')"; }
mkdir -p /sys/fs/cgroup/hooks
for i in $(seq 1 90); do mysql -h127.0.0.1 -P33129 -uroot -prig13129 -e "select 1" >/dev/null 2>&1 && break; sleep 1; done
cd /Users/wenshao/pr13129-rig && CGROOT=/sys/fs/cgroup/hooks WORKER_DIST=head8 ./spring.sh head6 lx6 | tail -1
cd /Users/wenshao/pr13129-rig/probe
run() { echo "=== $* $(date -u +%T)"; env DB=lx6 ARM=head8 "$@" 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-420; }
run SET=8 ARM=head8 node s17-cancel-window.mjs
killw
run node s12-lifecycle.mjs
cd /Users/wenshao/pr13129-rig && ./stop.sh lx6 >/dev/null 2>&1; killw
echo "=== unit cli"; cd /work/packages/cli && QWEN_MANAGED_HOOK_CGROUP_ROOT=/sys/fs/cgroup/hooks npx vitest run src/serve/managed-hook-runtime.test.ts src/serve/hosted-workspace-tool-turn.test.ts --reporter=dot --coverage.enabled=false 2>&1 | grep -E "Test Files|Tests |FAIL|×" | tail -6
echo "=== ALL-DONE $(date -u +%T)"
