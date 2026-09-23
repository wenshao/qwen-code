# Dump GET /tool-calls for every turn of the given sessions (turn-index paged backwards).
import json, sys, urllib.request
base, out = sys.argv[1], sys.argv[2]
wsid = open('run-main/wsid').read().strip()
H = {'authorization': 'Bearer tok-12466'}
def get(p):
    with urllib.request.urlopen(urllib.request.Request(base + p, headers=H)) as r: return json.loads(r.read())
res = {}
for sid in sys.argv[3:]:
    page = get(f'/workspaces/{wsid}/session/{sid}/turn-index?limit=250')
    turns = page['turns']
    while page.get('start', 0) > 0:
        page = get(f"/workspaces/{wsid}/session/{sid}/turn-index?snapshot={page['snapshot']}&start={max(0, page['start'] - 250)}&limit={min(250, page['start'])}")
        turns = page['turns'] + turns
    for t in turns:
        res[f"{sid}:{t['turnId']}"] = get(f"/workspaces/{wsid}/session/{sid}/tool-calls?turnId={t['turnId']}")
json.dump(res, open(out, 'w'), sort_keys=True)
print(len(res), 'turns', sum(len(v.get('events') or []) for v in res.values()), 'events')
