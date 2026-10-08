# shared helpers for round-3 batches
cd /Users/wenshao/git/pr13550-rig
sq() { ./mysql.sh sql -N -B $DB -e "$1"; }
ledger() { sq "SELECT r.domain, r.revision, IFNULL(r.task_state,'-'), IFNULL(r.delivery_state,'-'), IFNULL(l.state,'-'), IFNULL(l.attempts,'-'), IFNULL(LEFT(l.last_error,140),'-') FROM qwen_managed_session_extension_record r LEFT JOIN qwen_managed_child_result_relay l ON l.parent_session_id=r.session_id AND l.child_run_id=r.record_id WHERE r.session_id='$1' ORDER BY r.domain, r.record_id"; }
consumed_wait() { for i in $(seq ${2:-60}); do n=$(sq "SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE session_id='$1' AND delivery_state='consumed'"); [ "$n" -ge ${3:-2} ] && { echo "   consumed>=${3:-2} after ~${i}s"; return 0; }; sleep 1; done; echo "   NOT consumed within ${2:-60}s"; }
modelsaw() { grep "::$1\b\|::$1::" runs/model-requests.jsonl | python3 -c "
import sys,json
for l in sys.stdin:
    o=json.loads(l); print('   model', o['t'][11:23], o['role'], str(o['reply'])[:${2:-300}])"; }
notif() { ./mysql.sh sql -N -B --raw $DB -e "SELECT kind, byte_length, CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='$1' AND kind IN ('managed-input','managed-message') AND CAST(inline_bytes AS CHAR) LIKE '%task-notification%'" | python3 -c "
import sys,json
for l in sys.stdin:
    k,n,b=l.rstrip('\n').split('\t',2)
    if k=='managed-input':
        t=json.loads(b)['text']; r=t[t.index('<result>')+8:t.index('</result>')]
        tid=t[t.index('<task-id>')+9:t.index('</task-id>')]
        print('   input', n, 'bytes; task-id', tid, '; result chars', len(r), '; newlines', r.count(chr(10)), '; truncated', 'truncated:' in r, '; tail', json.dumps(r[-70:]))
    else:
        o=json.loads(b); print('  ', k, o.get('type'), n, 'bytes')"; }
