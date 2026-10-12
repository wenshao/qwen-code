#!/usr/bin/env python3
# Round 5 (bot R8-1): after a scenario, list every publication object row with its catalog state and whether the
# bytes stored in the fake OSS still match the catalog sha256 (read from the OSS double's data file, not its metadata).
# usage: objcheck.py <TAG> <DB>
import json, glob, subprocess, sys, hashlib, os
R = os.path.dirname(os.path.abspath(sys.argv[0])); TAG, DB = sys.argv[1], sys.argv[2]
d = json.load(open(sorted(glob.glob(f'{R}/out/s654-{TAG}.json'))[-1]))
def sql(q):
    out = subprocess.run([f'{R}/sql.sh', '-N', '-B', '-e', q], env={'DB': DB, 'PATH': '/usr/bin:/bin'}, capture_output=True, text=True).stdout
    return [l.split('\t') for l in out.strip().splitlines() if l]
for p in d['pubs']:
    pid = p['id']
    ops = sql(f"SELECT operation_id, slot_key, state, COALESCE(failure_status,'-'), COALESCE(failure_code,'-') FROM qwen_tool_publication_operation WHERE publication_id = '{pid}' ORDER BY created_at")
    print(f"[objcheck] pub={pid[:8]} ops: " + '; '.join(f"{o[1]}={o[2]}" + (f"({o[3]}/{o[4]})" if o[2] == 'FAILED' else '') for o in ops))
    for slot, state, key, sha, length in sql(f"SELECT slot_key, state, COALESCE(object_key,'-'), sha256, byte_length FROM qwen_tool_publication_object WHERE publication_id = '{pid}' ORDER BY slot_key"):
        if key == '-':
            verdict = 'inline'
        else:
            f = f"{R}/oss-data/{hashlib.sha256(key.encode()).hexdigest()}"
            if not os.path.exists(f):
                verdict = 'object_absent'
            else:
                b = open(f, 'rb').read()
                verdict = 'stored_bytes_match_catalog' if len(b) == int(length) and hashlib.sha256(b).hexdigest() == sha else f'stored_bytes_DIFFER({len(b)}B)'
        if state != 'VERIFIED' or verdict not in ('inline', 'stored_bytes_match_catalog'):
            print(f"[objcheck]   {slot} {state} {length}B {verdict}")
    nv = sql(f"SELECT state, COUNT(*) FROM qwen_tool_publication_object WHERE publication_id = '{pid}' GROUP BY state")
    print(f"[objcheck]   object states: " + ' '.join(f"{a}={b}" for a, b in nv))
