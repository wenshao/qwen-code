#!/bin/bash
cd /root/verify/pr11071-r4/head/packages/cli
start=$(date +%s)
CI=true npx vitest run src/serve/channel-management-service.test.ts src/serve/channel-settings-store.test.ts src/serve/channel-worker-manager.test.ts src/serve/run-qwen-serve.test.ts src/serve/server.test.ts > /root/verify/pr11071-r4/logs/unit-head.log 2>&1
echo "EXIT=$? $(( $(date +%s)-start ))s" >> /root/verify/pr11071-r4/logs/unit-head.log
