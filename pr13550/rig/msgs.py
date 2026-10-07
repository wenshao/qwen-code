# usage: msgs.py <db> <sessionId>  — the session's durable transcript (managed-message resources), in order
import json, subprocess, sys
db, sid = sys.argv[1], sys.argv[2]
out = subprocess.run(['/Users/wenshao/git/pr13550-rig/mysql.sh', 'sql', '-N', '-B', '--raw', db, '-e',
    f"SELECT FROM_UNIXTIME(created_at/1000,'%H:%i:%s.%f'), CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='{sid}' AND kind='managed-message' ORDER BY created_at, resource_id"],
    capture_output=True, text=True).stdout
for line in out.splitlines():
    t, body = line.split('\t', 1)
    try: o = json.loads(body)
    except Exception: print(t, 'unparsable', body[:120]); continue
    m = o.get('message', {})
    for p in m.get('parts', []):
        if 'text' in p:
            kind = 'thought' if p.get('thought') else 'text'
            print(t[:12], o.get('type'), m.get('role'), kind, json.dumps(p['text'])[:int(sys.argv[3]) if len(sys.argv) > 3 else 300])
        elif 'functionCall' in p:
            print(t[:12], o.get('type'), 'CALL', json.dumps(p['functionCall'])[:300])
        elif 'functionResponse' in p:
            print(t[:12], o.get('type'), 'RESULT', json.dumps(p['functionResponse'])[:300])
