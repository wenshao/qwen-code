# usage: toolres.py <db> <sessionId> — full functionResponse payloads of the session, one JSON per line
import json, subprocess, sys
db, sid = sys.argv[1], sys.argv[2]
out = subprocess.run(['/Users/wenshao/git/pr13858-rig/mysql.sh', 'sql', '-N', '-B', '--raw', db, '-e',
    f"SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='{sid}' AND kind='managed-message' ORDER BY created_at, resource_id"],
    capture_output=True, text=True).stdout
for line in out.splitlines():
    try: o = json.loads(line)
    except Exception: continue
    for p in o.get('message', {}).get('parts', []):
        if 'functionResponse' in p:
            print(json.dumps(p['functionResponse']['response'], ensure_ascii=False))
