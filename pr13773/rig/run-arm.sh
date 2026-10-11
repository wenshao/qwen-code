#!/bin/bash
# VERIFICATION RIG ONLY (PR #13773): one arm, fresh database.  usage: run-arm.sh <db> <dist-arm>
# Groups: R = Harness restart only (previous boot's Hook lease stays), D = detach then restart (lease released; the
# issue's "restored catalog without a mount"), F = fresh Session, no restart (present Hook hold).
set -u
R=/Users/wenshao/pr13773-rig; DB=$1; DI=$2
source $R/rig.sh
sc() { printf '{"name":"%s","ws":"ws-%s","st":"st-%s","cat":%s,"bg":%s%s}' "$1" "$2" "$2" "$3" "$4" "${5:+,\"setupText\":\"$5\"}"; }
RD="[$(sc R1 a '"cat-ptu"' true),$(sc R2 b '"cat-ptu"' false),$(sc R3 c null true),$(sc R4 d '"cat-off"' true),$(sc R5 e '"cat-stop"' true),\
$(sc D1 f '"cat-ptu"' true),$(sc D2 g '"cat-ptu"' false),$(sc D3 h '"cat-ptb"' true),$(sc D4 i '"cat-ptuf"' true),$(sc D5 j '"cat-off"' true),\
$(sc D6 k '"cat-stop"' true),$(sc D7 l '"cat-once"' true 'G_READ tag=D7'),$(sc D8 m null false)]"
FR="[$(sc F1 n '"cat-ptu"' true),$(sc F2 o '"cat-off"' true)${ONLYF:+,$(sc F3 a '"cat-ptu"' false)}]"
echo "== $DB dist=$DI $(date -u +%T)"
clean || exit 3
up $DB head $DI
[ -n "${ONLYF:-}" ] && RD="[]"
X "cd $R/probe && DB=$DB ARM=$DI PHASE=setup SCEN='$RD' $N p-child.mjs" 2>&1 | grep -E "^prep|Error" | cut -c1-400
for s in $(python3 -c "import json;st=json.load(open('$R/results/$DB/state.json'));print(' '.join(v['session'] for k,v in st.items() if k.startswith('D')))"); do
  X "cd $R/probe && DB=$DB $N detach.mjs $s" | head -1 | cut -c1-200
done
X "$R/lx/stop.sh $DB harness TERM" | head -1
X "$R/lx/harness.sh $DB $DI" | tail -1
X "cd $R/probe && DB=$DB ARM=$DI PHASE=setup SCEN='$FR' $N p-child.mjs" 2>&1 | grep -E "^prep|Error" | cut -c1-400
X "cd $R/probe && DB=$DB ARM=$DI PHASE=agent NAME=agent SETTLE_MS=15000 FINAL_WAIT_MS=100000 $N p-child.mjs" 2>&1 | grep -E "^(NOTE|PASS|FAIL|==|#)|Error" | cut -c1-260
down $DB
echo "== $DB done $(date -u +%T)"
