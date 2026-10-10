# usage: rlen.py <db> <sessionId> — per functionResponse: output length, truncation marker, record bytes
import json, subprocess, sys
db, sid = sys.argv[1], sys.argv[2]
out = subprocess.run(['/Users/wenshao/git/pr13769-rig/mysql.sh', 'sql', '-N', '-B', '--raw', db, '-e',
    f"SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='{sid}' AND kind='managed-message' ORDER BY created_at, resource_id"],
    capture_output=True, text=True).stdout
for line in out.splitlines():
    try: o = json.loads(line)
    except Exception: continue
    for p in o.get('message', {}).get('parts', []):
        fr = p.get('functionResponse')
        if fr:
            r = fr.get('response', {}); txt = r.get('output') or r.get('error') or ''
            print('   rlen   ', fr['id'], 'chars=%d' % len(txt), 'marker=%s' % ('truncated: the full result is on the acceptance record' in txt),
                  'record_bytes=%d' % len(line.encode()), 'head=%r' % txt[:34])
