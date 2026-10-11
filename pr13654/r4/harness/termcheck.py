#!/usr/bin/env python3
# Round 4: after a scenario, show the terminal (finish) state of its publication in MySQL and in the fake OSS.
# usage: termcheck.py <TAG> <DB>
import json, glob, subprocess, sys, urllib.request, hashlib
R = sys.argv[0].rsplit('/', 1)[0]; TAG, DB = sys.argv[1], sys.argv[2]
d = json.load(open(sorted(glob.glob(f'{R}/out/s654-{TAG}.json'))[-1]))
t0 = min(e['t'] for e in d['ledger']) - 5000 if d['ledger'] else 0
def sql(q):
    out = subprocess.run([f'{R}/sql.sh', '-N', '-B', '-e', q], env={'DB': DB, 'PATH': '/usr/bin:/bin'}, capture_output=True, text=True).stdout
    return [l.split('\t') for l in out.strip().splitlines() if l]
suffix = hashlib.sha256(b'terminal').hexdigest()
for p in d['pubs']:
    pid = p['id']
    scope, phase, used, q = sql(f"SELECT scope_key, producer_phase, producer_used_bytes, CASE WHEN quarantined THEN 1 ELSE 0 END FROM qwen_tool_publication WHERE publication_id = '{pid}'")[0]
    key = f'managed-tool-results/{scope}/{pid}/{suffix}'
    ops = sql(f"SELECT operation_id, state, COALESCE(failure_code,'-') FROM qwen_tool_publication_operation WHERE publication_id = '{pid}' AND slot_key = 'terminal' ORDER BY created_at")
    rows = sql(f"SELECT slot_key, state FROM qwen_tool_publication_object WHERE publication_id = '{pid}' AND slot_key LIKE 'terminal%'")
    nonv = sql(f"SELECT COUNT(*) FROM qwen_tool_publication_object WHERE publication_id = '{pid}' AND state <> 'VERIFIED'")[0][0]
    refs = sql(f"SELECT COUNT(*) FROM qwen_tool_publication_object WHERE object_key = '{key}'")[0][0]
    st = json.load(urllib.request.urlopen(f'http://127.0.0.1:18657/state?keys=1&prefix={key}'))
    led = json.load(urllib.request.urlopen(f'http://127.0.0.1:18657/ledger?since={t0}'))
    term = [f"{e['method']}:{e['status']}" for e in led if e['key'] == key]
    print(f"[terminal] pub={pid[:8]} finish_ops={ops} producer_phase={phase} producer_used_bytes={used} quarantined={q}")
    print(f"[terminal] db_terminal_rows={rows} non_verified_rows={nonv} db_rows_referencing_terminal_object={refs}")
    print(f"[terminal] fake_oss_terminal_object={'present ' + str(st['keys'][0]['length']) + ' B' if st['objects'] else 'absent'} oss_requests_on_terminal_key={term}")
