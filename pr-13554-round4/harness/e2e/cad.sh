#!/bin/bash
# CAD: R2-5 A/B. The JVM wall clock steps back 10 minutes at runtime (libfaketime, monotonic clock
# untouched, DB clock untouched). A tombstone that becomes due after the step needs a ledger scan.
# usage: cad.sh <arm> <port>
ARM=$1; PORT=$2
E=/Users/wenshao/pr13554-rig/e2e; DB=pr13554_cad_$ARM; export DB ARM; OUT=$E/out-cad-$ARM; rm -rf $OUT; mkdir -p $OUT
sql() { mysql -hmysql84 -uroot -pverify $DB "$@" 2>/dev/null; }
mysql -hmysql84 -uroot -pverify -e "drop database if exists $DB" 2>/dev/null
TS=$E/run/cad-$ARM.faketime; echo "+0" > $TS
FAKETS=$TS GRACE=PT5S $E/start.sh $ARM cad-$ARM $PORT $DB
for i in $(seq 1 120); do grep -q "E2E-RIG collector-owner" $E/run/cad-$ARM.log && break; sleep 1; done
T0=$(date +%s)
log() { echo "t=$(( $(date +%s) - T0 ))s $*" | tee -a $OUT/timeline.txt; }
ledger() { sql -N -e "select concat('ledger=', count(*), ' done=', ifnull(sum(collected_at is not null),0), ' bytes=', ifnull(sum(collected_bytes),0)) from qwen_managed_session_resource_collection where session_id='$1'"; }
$E/tool.sh seed $PORT tenant-c ws-1 before-step 1 2 1 31 | grep seeded
$E/tool.sh retire tenant-c before-step delete-before-step
for i in $(seq 1 100); do l=$(ledger before-step); case "$l" in *done=1*) break;; esac; sleep 1; done
log "control before the step: $l"
echo "-600" > $TS; sleep 2
log "JVM wall clock stepped back 600 s (faketime file now '-600'); DB clock unchanged"
$E/tool.sh seed $PORT tenant-c ws-1 after-step 1 2 1 32 | grep seeded
$E/tool.sh retire tenant-c after-step delete-after-step
TR=$(date +%s)
first=""
for i in $(seq 1 200); do
  l=$(ledger after-step)
  case "$l" in ledger=1*) [ -z "$first" ] && first=$(( $(date +%s) - TR )) && log "after-step ledger created ${first}s after retirement: $l";; esac
  case "$l" in *done=1*) log "after-step collected $(( $(date +%s) - TR ))s after retirement: $l"; break;; esac
  sleep 1
done
log "final after-step: $(ledger after-step) (waited up to 200 s)"
sql -e "select r.session_id, from_unixtime(r.retired_at/1000) retired, c.created_at ledger_created, c.collected_bytes, c.collected_at is not null done from qwen_output_session_retirement r left join qwen_managed_session_resource_collection c on c.tenant_key=r.tenant_key and c.session_key=r.session_key" | tee $OUT/final.txt
kill $(cat $E/run/cad-$ARM.pid)
echo "CAD-DONE $ARM"
