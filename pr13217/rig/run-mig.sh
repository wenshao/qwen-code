#!/bin/bash
cd /Users/wenshao/pr13217-rig
echo "=== $(date +%T) scale"
node scale.mjs r13217_ab_main r13217_ab_main r13217_mig 100
node -e '
const fs=require("fs"); const s=JSON.parse(fs.readFileSync("state/r13217_ab_main.json"));
s.list.sessions=s.list.sessions.map(x=>({...x, sessionId: x.sessionId+"-1"})); delete s.migrated;
fs.writeFileSync("state/r13217_mig.json", JSON.stringify(s,null,2));'
for c in mig-pr mig-main; do echo "=== $(date +%T) $c"; node rig.mjs configs/$c.json > runs-$c.out 2>&1; grep -E "RESULT" runs-$c.out; done
echo "=== $(date +%T) MIG-DONE"
