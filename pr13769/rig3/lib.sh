# Shared helpers for the PR 13769 probes. Source with DB set; run under bash.
cd /Users/wenshao/git/pr13769-rig
st() { python3 -c "import json;print(json.load(open('runs/$DB/state.json'))['$1'])"; }
SCTL=$(( $(st storeProxyPort) + 1 )); BCTL=$(( $(st brokerProxyPort) + 1 )); HP=$(st harnessPort)
sq() { ./mysql.sh sql -N -B $DB -e "$1"; }
ledger() { sq "SELECT r.domain, r.record_id, r.revision, IFNULL(r.task_state,'-'), IFNULL(r.delivery_state,'-'), IFNULL(l.state,'-'), IFNULL(l.attempts,'-'), IFNULL(LEFT(l.last_error,140),'-') FROM qwen_managed_session_extension_record r LEFT JOIN qwen_managed_child_result_relay l ON l.parent_session_id=r.session_id AND l.child_run_id=r.record_id WHERE r.session_id='$1' ORDER BY r.domain, r.record_id" | sed 's/^/   ledger  /'; }
turns() { sq "SELECT IF(s.parent_session_id IS NULL,'parent','child '), t.status, IFNULL(t.error_code,'-'), FROM_UNIXTIME(t.created_at/1000,'%H:%i:%s'), IFNULL(FROM_UNIXTIME(t.completed_at/1000,'%H:%i:%s'),'-'), LEFT(IFNULL(t.error_message,'-'),150) FROM managed_agent_turn t JOIN managed_agent_session s ON s.tenant_id=t.tenant_id AND s.session_id=t.session_id WHERE s.session_id='$1' OR s.parent_session_id='$1' ORDER BY t.created_at" | sed 's/^/   turn    /'; }
kids() { sq "SELECT session_id, status FROM managed_agent_session WHERE parent_session_id='$1'" | sed 's/^/   child   /'; }
sst() { sq "SELECT status FROM managed_agent_session WHERE session_id='$1'"; }
lastturn() { sq "SELECT CONCAT(status,' ',IFNULL(error_code,'-')) FROM managed_agent_turn WHERE session_id='$1' ORDER BY created_at DESC LIMIT 1"; }
lastturnid() { sq "SELECT turn_id FROM managed_agent_turn WHERE session_id='$1' ORDER BY created_at DESC LIMIT 1"; }
running() { sq "SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='$1' AND status='RUNNING'"; }
crunning() { sq "SELECT COUNT(*) FROM managed_agent_turn t JOIN managed_agent_session s USING(tenant_id,session_id) WHERE s.parent_session_id='$1' AND t.status='RUNNING'"; }
childruns() { sq "SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='$1' AND domain='child_run'"; }
waitterm() { local s; for i in $(seq ${2:-90}); do s=$(lastturn $1); [[ "$s" =~ ^(COMPLETED|FAILED|CANCELLED) ]] && break; sleep 2; done; echo "$s"; }
newp() { node client.mjs $DB create "$1" | sed -n 's/^{"status":202,"json":{"id":"\([0-9a-f-]*\)".*/\1/p'; }
restart() { echo "   $(date -u +%T) harness stop"; node stack.mjs stop $DB harness 2>&1 | tail -1; sleep ${1:-2}; node stack.mjs harness $DB 2>&1 | tail -1; for i in $(seq 60); do curl -s -o /dev/null --noproxy '*' http://127.0.0.1:$HP/health && break; sleep 1; done; echo "   $(date -u +%T) harness back"; }
release() { curl -s http://127.0.0.1:18769/release/$1 >/dev/null; echo "   $(date -u +%T) released $1"; }
arm_store() { curl -s "http://127.0.0.1:$SCTL/arm?$1"; }
arm_broker() { curl -s "http://127.0.0.1:$BCTL/arm?$1"; }
held_store() { curl -s "http://127.0.0.1:$SCTL/held"; }
held_broker() { curl -s "http://127.0.0.1:$BCTL/held"; }
msgs() { python3 msgs.py $DB $1 ${2:-220} | sed 's/^/   msg     /'; }
# every tool_result functionResponse id in the parent's durable transcript, with counts
results() { python3 msgs.py $DB $1 120 | grep RESULT | grep -o '"id": "[^"]*"' | sort | uniq -c | sed 's/^/   results /'; }
modelsaw() { grep "$1" runs/model-requests.jsonl | python3 -c "
import sys,json
for l in sys.stdin:
    o=json.loads(l); print('   model  ', o['t'][11:23], o['role'], str(o.get('reply', o.get('toolMsgs','')))[:${2:-260}])"; }
delay() { sq "UPDATE rig_child_delay SET secs=$1"; }
# number of HELD requests (not the armed rule) whose marker/path mentions $2, on control port $1
heldn() { curl -s "http://127.0.0.1:$1/held" | python3 -c "import sys,json; print(sum(1 for x in json.load(sys.stdin)['held'] if '$2' in x['marker'] or '$2' in x['path']))"; }
# round 3: the session's checkpoints (newest last): id, phase, activation (short), agentWait runs+consumed
ckpts() { ./mysql.sh sql -N -B --raw $DB -e "SELECT resource_id, CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='$1' AND kind='managed-checkpoint' ORDER BY created_at, resource_id" | python3 -c "
import sys,json
rows=[l.split('\t',1) for l in sys.stdin.read().splitlines() if '\t' in l]
for rid,b in rows[-${2:-3}:]:
    o=json.loads(b); i=o['identity']; w=o.get('agentWait')
    runs=','.join(r['functionCallId'].split('_')[-1]+('=consumed' if r['consumed'] else '=waiting') for r in w['runs']) if w else '-'
    print('   ckpt   ', i['checkpointId'], o['continuation']['phase'], 'act='+i['activationId'][:8], 'agentWait=['+runs+']', 'res='+rid[:8])"; }
ckpt() { ckpts $1 3; }
ckptrid() { ./mysql.sh sql -N -B $DB -e "SELECT resource_id FROM qwen_managed_session_resource WHERE session_id='$1' AND kind='managed-checkpoint' ORDER BY created_at DESC, resource_id DESC LIMIT 1"; }
