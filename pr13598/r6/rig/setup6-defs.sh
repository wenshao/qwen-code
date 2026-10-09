#!/bin/bash
# Round 5: definitions on a5 / s5 / f5 (every minute), Broker-tap delay rule on the first execution poll,
# and the crash scripts that SIGKILL the Harness while the wake turn waits on read_file.
cd /Users/wenshao/git/pr13598-rig
source mk4.sh
for db in a6 s6 f6; do
  echo "$db turns: $(./mysql.sh sql -N -e "select status,count(*) from managed_agent_turn group by status" $db | tr '\n\t' '; ')"
done
mkdef() {
  local db=$1 n=$2 goal=$3 prompt=$4 ov=$5
  local D=runs/$db lc
  lc=$(echo "$n" | tr 'A-Z' 'a-z')
  node client.mjs $db acreate "$(mk $(cat $D/$n) "$goal" "$prompt" $ov '* * * * *')" key-$n | tee $D/$lc-create.json | short
  node -e "console.log(JSON.parse(require('fs').readFileSync('$D/$lc-create.json')).json.id)" > $D/$lc.id
}
mkdef a6 A1 "tool crash allow" "AUTO::a1 $TOOLP" allow
mkdef a6 A2 "text crash allow" "AUTO::a2 HOLD1::a6crash::90 Reply with exactly: TICK" allow
mkdef s6 S1 "tool crash skip" "AUTO::s1 $TOOLP" skip
mkdef s6 S2 "text crash skip" "AUTO::s2 HOLD1::s6crash::80 Reply with exactly: TICK" skip
mkdef f6 F1 "tool crash allow, settlement faulted" "AUTO::f1 $TOOLP" allow
for p in 36236 36246 36256; do
  curl -s -XPOST localhost:$p/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"delay","ms":150000,"count":1}'
  echo
done
nohup ./crash5.sh a6 "A1 mid tool, A2 mid HOLD" >/dev/null 2>&1 &
nohup ./crash5.sh s6 "S1 mid tool, S2 mid HOLD" >/dev/null 2>&1 &
nohup ./crash6f.sh >/dev/null 2>&1 &
date -u +%T
