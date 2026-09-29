#!/bin/bash
cd /root/verify/pr9466/merged
/root/verify/pr9466/build-arm.sh /root/verify/pr9466/merged
start=$(date +%s); npm run typecheck > typecheck.log 2>&1; echo "TYPECHECK_EXIT=$? t=$(( $(date +%s)-start ))s"
/root/verify/pr9466/run-units.sh /root/verify/pr9466/merged merged
