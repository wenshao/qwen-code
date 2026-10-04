#!/bin/bash
# Usage: run-stack.sh <config-name>...  (one fresh MySQL db + Spring JVM + Harness per config)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/412871d7-f412-4b9c-905e-0d2a8afab8a8/scratchpad
cd $S/rig || exit 2
for N in "$@"; do
  [ -f configs/$N.json ] || { echo "$N MISSING-CONFIG"; continue; }
  node burst.mjs configs/$N.json > $S/runs/$N.out 2>&1
  echo "$(date +%H:%M:%S) $N: $(grep -a '^.\{12\} ROUND' $S/runs/$N.out | sed 's/.*ROUND //' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const l of s.trim().split("\n").filter(Boolean)){const r=JSON.parse(l);console.log(`n=${r.n} rep=${r.rep} submit=${JSON.stringify(r.submit)} settleMs=${r.settleMs} status=${JSON.stringify(r.turnStatus)} carriers=${r.carrierThreads??"-"} busy=${r.carriersBusy??"-"} pinned=${r.pinnedVirtualThreads??"-"}${r.subscribers?` subs=${r.subsOpen}/${r.subscribers} sawDone=${r.subsSawCompletion} before=${JSON.stringify(r.beforeSubmit)}`:""}`)}})' | tr '\n' ';') $(grep -a '^RESULT' $S/runs/$N.out | sed 's/^RESULT //' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(`err=${r.error?r.error.slice(0,80):null} lockErr=${r.springCannotAcquireLock} pinTraces=${r.pinnedTraces} frames=${JSON.stringify(r.pinnedMonitorFrames)}`)})')" | tee -a $S/runs/summary.txt
done
