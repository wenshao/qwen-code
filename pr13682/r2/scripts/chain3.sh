#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682 R2): R1 survivors (+J3 control) on head 7105fb1e: focused classes, then the full
# module suite for whatever still survives (with two same-environment full baselines).
cd /root/v13682/mutpy
O=/root/v13682/out/mut3.nohup; : > $O
python3 run_java3.py BASE J3 J4 J9 J11 J14 J16 J17 Q1 >> $O 2>&1
S=$(python3 -c "import json;d=json.load(open(\"/root/v13682/out/mut3/java-results-BASE-J3-J4-J9-J11-J14-J16-J17-Q1.json\"));print(\" \".join(k for k,v in d.items() if isinstance(v,dict) and v[\"verdict\"]==\"SURVIVED\"))")
echo "focused survivors: $S" >> $O
for i in 1 2; do FULL=1 python3 run_java3.py BASE >> $O 2>&1; cp /root/v13682/out/mut3/BASE-managed-agent-server-full.log /root/v13682/out/mut3/BASE-full-$i.log; done
[ -n "$S" ] && FULL=1 python3 run_java3.py $S >> $O 2>&1
echo CHAIN3-DONE >> $O
