#!/bin/bash
# Pin tamper: flip one byte of the stored launch envelope's script after the parent commits it and
# before the relay (scan-delay 20s) reads it. Evidence: envelope digest vs bytes, child turn, harness log.
DB=$1; ID=$2; source ./lib.sh
P=$(newp "PARENT::wfbg::$ID::tamper Run the workflow."); echo "parent $P  $(date -u +%T.%N | cut -c1-12)"
for i in $(seq 400); do
  RID=$(sq "SELECT record_resource_id FROM qwen_managed_session_extension_record WHERE session_id='$P' AND domain='child_run' LIMIT 1")
  [ -n "$RID" ] && break; sleep 0.05; done
IN=$(./mysql.sh sql -N -B --raw $DB -e "SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE resource_id='$RID'" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['inputRef']['resourceId'])")
KIDS_BEFORE=$(sq "SELECT COUNT(*) FROM managed_agent_session WHERE parent_session_id='$P'")
sq "UPDATE qwen_managed_session_resource SET inline_bytes = REPLACE(inline_bytes, 'PIN-A', 'PIN-B') WHERE resource_id='$IN'"
echo "tampered envelope $IN at $(date -u +%T.%N | cut -c1-12); children before tamper=$KIDS_BEFORE"
./mysql.sh sql -N -B --raw $DB -e "SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE resource_id='$IN'" | python3 -c "
import sys,json,hashlib; e=json.loads(sys.stdin.read()); print('  pinned digest', e['definition']['definitionDigest'][:16], ' sha256(stored script)', hashlib.sha256(e['script'].encode()).hexdigest()[:16], ' marker', 'PIN-B' if 'PIN-B' in e['script'] else 'PIN-A')"
sleep 45
kids $P; turns $P; ledger $P
sq "SELECT CONCAT('child created ', FROM_UNIXTIME(created_at/1000,'%H:%i:%s.%f')) FROM managed_agent_session WHERE parent_session_id='$P'"
grep -h "pin does not match" runs/$DB/harness.log | tail -2 | cut -c1-300
