import json, sys
# Summarise a transcript: user prompts (with promptId ordinals), telemetry
# prompt ids, and file_history_snapshot ordinals (with tracked backups).
path = sys.argv[1]
recs = [json.loads(l) for l in open(path) if l.strip()]
sid = recs[0].get('sessionId')
def ordn(pid):
    if isinstance(pid, str) and pid.startswith(sid + '########'):
        return pid.split('########', 1)[1]
    return pid
for i, r in enumerate(recs):
    t, st = r.get('type'), r.get('subtype')
    if t == 'user':
        txt = ''.join(p.get('text', '') for p in (r.get('message') or {}).get('parts', []) if isinstance(p, dict))
        print(f"{i:3} user      uuid={r['uuid'][:8]} parent={str(r.get('parentUuid'))[:8]} promptId={ordn(r.get('promptId'))} text={txt[:40]!r}")
    elif t == 'system' and st == 'file_history_snapshot':
        snaps = (r.get('systemPayload') or {}).get('snapshots', [])
        print(f"{i:3} snapshot  " + ', '.join(f"{ordn(s.get('promptId'))}:{sorted((s.get('trackedFileBackups') or {}).keys())}" for s in snaps))
    elif t == 'system' and st == 'ui_telemetry':
        pid = ((r.get('systemPayload') or {}).get('uiEvent') or {}).get('prompt_id')
        print(f"{i:3} telemetry prompt_id={ordn(pid)} parent={str(r.get('parentUuid'))[:8]}")
    elif t == 'system':
        print(f"{i:3} system    {st} parent={str(r.get('parentUuid'))[:8]}")
