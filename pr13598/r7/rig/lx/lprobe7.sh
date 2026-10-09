#!/bin/bash
# usage: lprobe7.sh <db> — inside the container. Snapshot the wedge, then replay ONE explicit release of the
# RELEASING wake Runtime Session through the Broker tap (same body shape the Harness sent), and re-snapshot.
cd /rig; DB=$1; D=runs/$DB; L=$D/actions.log
RS=$(mysql -h127.0.0.1 -uroot -N -e "select runtime_session_id from qwen_runtime_session where session_state='RELEASING' limit 1" $DB)
HS=$(mysql -h127.0.0.1 -uroot -N -e "select harness_session_id from qwen_runtime_session where runtime_session_id='$RS'" $DB)
TOK=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("'$D'/state.json")).brokerToken)')
BT=$(node -e 'const s=JSON.parse(require("fs").readFileSync("'$D'/state.json"));console.log(s.brokerTapPort??s.brokerPort)')
./lst7.sh $DB R1 R2 2>/dev/null | grep -v "aftermath could not" > $D/wedge-before.txt
echo "aftermath failures before probe: $(grep -c 'aftermath could not' $D/harness.log)" >> $D/wedge-before.txt
echo "$(date -u +%T) PROBE: one explicit release of $RS (RELEASING) via the Broker" >> $L
curl -s -w ' http=%{http_code}\n' -XPOST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  "http://127.0.0.1:$BT/internal/runtime-broker/v1/tool-sessions/$RS:release" \
  -d "{\"protocolVersion\":1,\"requestId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"harnessSessionId\":\"$HS\",\"runtimeSessionId\":\"$RS\"}" | tee -a $L
sleep 90
./lst7.sh $DB R1 R2 2>/dev/null | grep -v "aftermath could not" > $D/wedge-after.txt
echo "aftermath failures after probe: $(grep -c 'aftermath could not' $D/harness.log)" >> $D/wedge-after.txt
echo "$(date -u +%T) PROBE done" >> $L
