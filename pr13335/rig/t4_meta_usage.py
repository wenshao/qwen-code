import json, subprocess, sys, time
sys.path.insert(0, '/Users/wenshao/pr13335-rig/rig')
from drive import *
R = '/Users/wenshao/pr13335-rig'
M = '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysqldump'
META = [
    ('m1_clientId_only', {'clientId': 'c1'}),
    ('m2_clientId_plus_other', {'clientId': 'c1', 'other': 'PR13335_META_MARK_A'}),
    ('m3_no_clientId', {'traceId': 'PR13335_META_MARK_B'}),
    ('m4_array', ['PR13335_META_MARK_C']),
    ('m5_scalar', 'PR13335_META_MARK_D'),
    ('m6_long_clientId', {'clientId': 'x' * 200}),
    ('m7_empty_object', {}),
]
out = {}
for arm in sys.argv[1:] or ('base', 'merge'):
    tag = f't4-meta-{arm}'
    print(subprocess.run([f'{R}/rig/stack.sh', 'up', arm, tag], capture_output=True, text=True).stdout.strip(), flush=True)
    S = meta(tag)['SPRING']; db = meta(tag)['DB']
    rows = []
    for name, md in META:
        r = ws_create(S, [{'type': 'input_text', 'text': f'PR13335_META_{name.upper()} hi'}], metadata=md, title=f'meta {name}')
        b = r['body']
        rows.append({'case': name, 'route': 'sessions/create', 'http': r['status'],
                     'error': b.get('error') if isinstance(b, dict) and r['status'] != 202 else None})
    # submit route with the mixed metadata, on a fresh session
    sid = ws_create(S, [{'type': 'input_text', 'text': 'PR13335_META_HOST hi'}])['body']['sessionId']
    wait_terminal(S, sid, 60)
    for name, md in META[1:3]:
        r = ws_submit(S, sid, [{'type': 'input_text', 'text': f'PR13335_META_SUBMIT_{name.upper()}'}], metadata=md)
        b = r['body']
        rows.append({'case': name, 'route': 'turns/submit', 'http': r['status'],
                     'error': b.get('error') if isinstance(b, dict) and r['status'] != 202 else None})
        if r['status'] == 202:
            wait_terminal(S, sid, 60, count=len([x for x in rows if x['route'] == 'turns/submit' and x['http'] == 202]) + 1)
    time.sleep(2)
    dump = subprocess.run([M, '-uroot', '-S', f'{R}/my/mysql.sock', '--skip-extended-insert', db], capture_output=True, text=True).stdout
    stored = {mk: dump.count(mk) for mk in ('PR13335_META_MARK_A', 'PR13335_META_MARK_B', 'PR13335_META_MARK_C', 'PR13335_META_MARK_D')}
    # usage: WebShellTurn shape while a Turn is active
    r = ws_create(S, [{'type': 'input_text', 'text': 'PR13335_USAGE HOLD8S'}])
    usid = r['body']['sessionId']
    active = None
    for _ in range(40):
        g = ws(S, 'sessions/get', {'sessionId': usid})
        active = g['body'].get('activeTurn') if isinstance(g['body'], dict) else None
        if active and active.get('status') in ('running',):
            break
        time.sleep(0.25)
    wait_terminal(S, usid, 60)
    done = ws(S, 'sessions/get', {'sessionId': usid})['body']
    pub = call('GET', f'{S}/v1/agents/sessions/{usid}/turns')['body']
    # end-to-end prompt size ceiling (public create, one ASCII block)
    ceiling = []
    for n in (60000, 65000, 66000, 70000):
        text = f'PR13335_SZ_{n} ' + 'a' * (n - len(f'PR13335_SZ_{n} '))
        cr = create_public(S, [{'type': 'input_text', 'text': text}])
        term, secs, evs = wait_terminal(S, cr['body']['id'], 60)
        ceiling.append({'chars': n, 'http': cr['status'], 'terminal': (term[0]['type'], term[0].get('data', {}).get('code')) if term else None})
    out[arm] = {'metadata': rows, 'metadata_markers_in_db_dump': stored,
                'activeTurn_running': active, 'activeTurn_keys': sorted(active.keys()) if active else None,
                'after_completion_activeTurn': done.get('activeTurn'),
                'public_turn_keys': sorted(pub['data'][0].keys()) if pub.get('data') else None,
                'prompt_ceiling': ceiling}
    print(json.dumps(out[arm], indent=1, ensure_ascii=False), flush=True)
    subprocess.run([f'{R}/rig/stack.sh', 'down', tag], capture_output=True)
json.dump(out, open(f'{R}/results/t4-meta-usage-' + '-'.join(sys.argv[1:] or ['base','merge']) + '.json', 'w'), indent=1, ensure_ascii=False)
