#!/bin/bash
# Usage: run-stack.sh <config-name>...  (one fresh DB + Spring JVM + Harness per config)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/54b7ab90-ab14-4aaa-958e-1d2b84bfc2f7/scratchpad
cd $S/rig || exit 2
for N in "$@"; do
  [ -f configs/$N.json ] || { echo "$N MISSING-CONFIG"; continue; }
  node hub.mjs configs/$N.json > $S/runs/$N.out 2>&1
  R=$(grep -a '^RESULT ' $S/runs/$N.out | sed 's/^RESULT //')
  [ -n "$R" ] || { echo "$(date +%H:%M:%S) $N NO-RESULT" | tee -a $S/runs/summary.txt; continue; }
  echo "$R" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const b=r.beforeSubmit??{};console.log(`${new Date().toISOString().slice(11,19)} ${r.name}: err=${r.error?r.error.slice(0,60):null} open=${r.subsOpenBeforeSubmit}/${r.subscribers} openMax=${r.openMsMax} carriers=${b.carrierThreads} busy=${b.carriersBusy} busyInHub=${b.carriersInHubWait} hubWaiters=${b.hubWaiters} pinned=${b.hubWaitersPinned} unmounted=${b.hubWaitersUnmounted} settleMs=${r.settleMs} status=${JSON.stringify(r.turnStatus)} sawDone=${r.subsSawCompletion??"-"} doneP50=${r.completionMsP50??"-"} doneMax=${r.completionMsMax??"-"} sVd=${JSON.stringify(r.streamVsDurable?{i:r.streamVsDurable.identical,p:r.streamVsDurable.strictPrefix,d:r.streamVsDurable.diverged}:"-")} openEnd=${r.subsOpenAtEnd??"-"} ka=${JSON.stringify(r.keepalives??"-")} stmtPerSubMin=${r.statementsPerSubPerMin??"-"}`)})' | tee -a $S/runs/summary.txt
done
