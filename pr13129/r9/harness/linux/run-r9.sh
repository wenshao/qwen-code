#!/bin/sh
export PATH=/lx/node-v22.23.2-linux-arm64/bin:$PATH
killw() { for p in $(ps -eo pid,args | awk '/[m]anaged-runtime-worker/{print $1}'); do kill $p 2>/dev/null; done; sleep 2; echo "workers left: $(ps -eo args | grep -c '[m]anaged-runtime-worker')"; }
mkdir -p /sys/fs/cgroup/hooks
for i in $(seq 1 90); do mysql -h127.0.0.1 -P33129 -uroot -prig13129 -e "select 1" >/dev/null 2>&1 && break; sleep 1; done
cd /Users/wenshao/pr13129-rig && (cd probe && DB=lx9 node manifest.mjs) && CGROOT=/sys/fs/cgroup/hooks WORKER_DIST=head11 ./spring.sh head6 lx9 | tail -1
grep -o "Successfully applied [0-9]* migrations[^\"]*" run/lx9/spring-0.log | head -1
cd /Users/wenshao/pr13129-rig/probe; rm -f /lx/cmd/ledger.jsonl
run() { echo "=== $* $(date -u +%T)"; env DB=lx9 ARM=head11 "$@" 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-420; }
run ARGV_FIXED=1 node s9-linux.mjs
killw
run node s2b-lease.mjs ws-t1 a yes SIGKILL
killw
run node s5b-lost.mjs - ws-t9b
killw
run node s11-cancel.mjs
killw
run SET=8 node s17-cancel-window.mjs
killw
run SET=a node s18-refusal-recovery.mjs
killw
run node s20-bounded-refusal.mjs
killw
run node s12-lifecycle.mjs
cd /Users/wenshao/pr13129-rig && ./stop.sh lx9 >/dev/null 2>&1; killw
echo "=== unit core"; cd /work/packages/core && QWEN_MANAGED_HOOK_CGROUP_ROOT=/sys/fs/cgroup/hooks npx vitest run src/hooks/hook-command-cgroup.test.ts src/hooks/hook-runner-managed-process.test.ts src/hooks/httpHookRunner.test.ts --reporter=dot --coverage.enabled=false 2>&1 | grep -E "Test Files|Tests |FAIL" | tail -3
echo "=== unit cli"; cd /work/packages/cli && QWEN_MANAGED_HOOK_CGROUP_ROOT=/sys/fs/cgroup/hooks npx vitest run src/serve/managed-hook-runtime.test.ts src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-harness-session.test.ts --reporter=dot --coverage.enabled=false 2>&1 | grep -E "Test Files|Tests |FAIL|×" | tail -6
echo "=== ALL-DONE $(date -u +%T)"
