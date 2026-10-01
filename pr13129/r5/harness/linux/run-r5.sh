#!/bin/sh
export PATH=/lx/node-v22.23.2-linux-arm64/bin:$PATH
mkdir -p /sys/fs/cgroup/hooks
for i in $(seq 1 60); do mysql -h127.0.0.1 -P33129 -uroot -prig13129 -e "select 1" >/dev/null 2>&1 && break; sleep 1; done
cd /Users/wenshao/pr13129-rig && (cd probe && DB=lx5 node manifest.mjs) && CGROOT=/sys/fs/cgroup/hooks WORKER_DIST=head7 ./spring.sh head6 lx5 | tail -1
grep -o "Successfully applied [0-9]* migrations[^\"]*" run/lx5/spring-0.log | head -1
echo "=== unit core"; cd /work/packages/core && QWEN_MANAGED_HOOK_CGROUP_ROOT=/sys/fs/cgroup/hooks npx vitest run src/hooks/hook-command-cgroup.test.ts src/hooks/hook-runner-managed-process.test.ts src/hooks/httpHookRunner.test.ts --reporter=dot --coverage.enabled=false 2>&1 | grep -E "Test Files|Tests |FAIL" | tail -3
echo "=== unit cli"; cd /work/packages/cli && QWEN_MANAGED_HOOK_CGROUP_ROOT=/sys/fs/cgroup/hooks npx vitest run src/serve/managed-hook-runtime.test.ts --reporter=dot --coverage.enabled=false 2>&1 | grep -E "Test Files|Tests |FAIL" | tail -3
cd /Users/wenshao/pr13129-rig/probe; rm -f /lx/cmd/ledger.jsonl
run() { echo "=== $* $(date -u +%T)"; env DB=lx5 ARM=head7 "$@" 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-300; }
run ARGV_FIXED=1 node s9-linux.mjs
run node s2b-lease.mjs ws-t1 a yes SIGKILL
run node s5b-lost.mjs - ws-t9b
run node s11-cancel.mjs
echo "=== ALL-DONE $(date -u +%T)"
