#!/bin/bash
# For each arm: PR's own e2e anchoring test (mock daemon) + real-daemon probes via vite dev.
cd /root/verify/pr12434-harness
SMALL=a09eb3ca-8c42-411e-b3a6-9031d1fd3396; BIG=4fd9d932-c1bf-4c2c-b440-6ccff666cac7
summ() { node -e 'require("readline").createInterface({input:process.stdin}).on("line",l=>{try{const o=JSON.parse(l);if(o.wire)return;if(o.step==="initial"||o.step==="final")return;console.log("   probe", JSON.stringify({step:o.step,where:o.where,moved:o.moved,maxFrameDeviation:o.maxFrameDeviation,scrollDelta:o.scrollDelta,expected:o.expectedDelta,bar:o.barAfter,barH:[o.barHeightBefore,o.barHeightAfter]}))}catch{if(/FAILED|Error/.test(l))console.log("   ",l.slice(0,200))}})'; }
for ARM in ${ARMS:-M0 M1 M2 FIX}; do
  python3 arms.py $ARM || exit 1
  sleep 2
  echo "=== $ARM"
  (cd /root/verify/pr12434-head/packages/web-shell && PLAYWRIGHT_PORT=5291 timeout 300 npx playwright test client/e2e/web-shell.trajectory.spec.ts --project=chromium --reporter=line -g "keeps the reader on the same row|retries the page" > /root/verify/pr12434-harness/logs/arm-$ARM-e2e.log 2>&1; echo "   e2e exit=$? $(grep -Eo '[0-9]+ (passed|failed)' /root/verify/pr12434-harness/logs/arm-$ARM-e2e.log | tr '\n' ' ')")
  timeout 300 node scenario-walk.cjs chromium $SMALL out/arm-$ARM-small top,0.5 http://127.0.0.1:5291 2>&1 | summ
  timeout 300 node scenario-walk.cjs chromium $BIG out/arm-$ARM-big 0.5,0.5,0.5 http://127.0.0.1:5291 2>&1 | summ
  if [ "$ARM" = "FIX" ] || [ "$ARM" = "M0" ]; then
    timeout 200 node scenario-faults.cjs chromium keyboard $BIG out/arm-$ARM-kb http://127.0.0.1:5291 2>&1 | tail -n 1 | sed 's/^/   kb /'
  fi
done
python3 arms.py restore
cd /root/verify/pr12434-head && echo "git status: [$(git status --porcelain)]"
