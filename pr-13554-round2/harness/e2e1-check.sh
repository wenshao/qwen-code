#!/bin/bash
# post-checks for E2E-1: row audit, ledger audit, recovery reader on the PR arm and the merge-base arm, log counters
E=/root/verify/pr13554/e2e; export DB=$1; ARMX=$2; OUT=$3
sql() { docker exec pr13554-mysql84 mysql -uroot -pverify $DB "$@" 2>/dev/null; }
sql -e "select tenant_id, session_id, state, count(*) n, sum(byte_length) bytes, sum(inline_bytes is null) null_inline, sum(state='PUBLISHED' and sha2(inline_bytes,256)=sha256) digest_ok from qwen_managed_session_resource group by tenant_id, session_id, state order by session_id" | tee $OUT/audit-rows.txt
sql -e "select c.session_id, c.gc_generation gen, c.gc_blocker, c.collected_bytes, (select sum(byte_length) from qwen_managed_session_resource r where r.tenant_id=c.tenant_id and r.session_id=c.session_id and r.state='COLLECTED') collected_rows_bytes from qwen_managed_session_resource_collection c order by c.session_id" | tee $OUT/audit-ledger.txt
C=$(sql -N -e "select resource_id from qwen_managed_session_resource where session_id='s1-bg-shell-40mib' and kind='managed-tool-result-content' order by resource_id limit 1")
L=$(sql -N -e "select resource_id from qwen_managed_session_resource where session_id='s4-live-control' and kind='managed-tool-result-content' order by resource_id limit 1")
{ echo "$ARMX arm collected row (s1): $(ARM=$ARMX $E/tool.sh recovery tenant-a ws-1 s1-bg-shell-40mib $C | grep -v Commons)"
  echo "$ARMX arm live row (s4):      $(ARM=$ARMX $E/tool.sh recovery tenant-a ws-1 s4-live-control $L | grep -v Commons)"
  echo "base arm collected row (s1): $(ARM=base $E/tool.sh recovery tenant-a ws-1 s1-bg-shell-40mib $C | grep -v Commons)"; } | tee $OUT/recovery-reader.txt
echo "completions=$(grep -c 'Stream capture collection completed' $E/run/e2e1-A.log) warn-retry=$(grep -c 'will retry' $E/run/e2e1-A.log) errors=$(grep -c ' ERROR ' $E/run/e2e1-A.log) object-store-calls=$(grep -c 'object-store-call' $E/run/e2e1-A.log)" | tee $OUT/log-counters.txt
