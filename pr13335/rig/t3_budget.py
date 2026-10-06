import json, subprocess, sys, time, os
sys.path.insert(0, '/Users/wenshao/pr13335-rig/rig')
from drive import *
R = '/Users/wenshao/pr13335-rig'
FAKE_LOG = f'{R}/fake-requests.jsonl'
EMOJI = '\U0001F600'

def blocks(case, sizes, ch='a'):
    out = []
    for i, n in enumerate(sizes):
        prefix = f'PR13335_IB_{case} ' if i == 0 else ''
        if ch == 'a':
            text = prefix + 'a' * (n - len(prefix))
        else:  # astral: n code points, prefix counted as code points too
            text = prefix + EMOJI * (n - len(prefix))
        out.append({'type': 'input_text', 'text': text})
    return out

CASES = [
    ('C1_4X1M', 'public-create', [1_000_000] * 4, 'a'),
    ('C2_5X1M', 'public-create', [1_000_000] * 5, 'a'),
    ('C3_4M_PLUS_1', 'public-create', [1_000_000] * 4 + [1], 'a'),
    ('C4_1X1000001', 'public-create', [1_000_001], 'a'),
    ('C5_1X1M_ASTRAL', 'public-create', [1_000_000], 'e'),
    ('C6_4X1M_ASTRAL', 'public-create', [1_000_000] * 4, 'e'),
    ('C8_WS_SUBMIT_5X1M', 'ws-submit', [1_000_000] * 5, 'a'),
    ('C9_PUBLIC_SUBMIT_5X1M', 'public-submit', [1_000_000] * 5, 'a'),
    ('C7_100X1M', 'public-create', [1_000_000] * 100, 'a'),
]
only = os.environ.get('ONLY')
for arm in sys.argv[1:] or ('base', 'merge'):
    tag = f't3-budget-{arm}'
    print(subprocess.run([f'{R}/rig/stack.sh', 'up', arm, tag], capture_output=True, text=True).stdout.strip(), flush=True)
    S = meta(tag)['SPRING']; db = meta(tag)['DB']
    # A pre-existing session for the submit paths.
    host = create_public(S, [{'type': 'input_text', 'text': 'PR13335_IB_HOST hi'}])['body']['id']
    wait_terminal(S, host, 60)
    wsh = ws_create(S, [{'type': 'input_text', 'text': 'PR13335_IB_WSHOST hi'}])['body']['sessionId']
    wait_terminal(S, wsh, 60)
    rows = []
    for case, path, sizes, ch in CASES:
        if only and case not in only.split(','):
            continue
        b = blocks(case, sizes, ch)
        fake_before = sum(1 for _ in open(FAKE_LOG))
        if path == 'public-create':
            r = create_public(S, b); sid = r['body'].get('id') if isinstance(r.get('body'), dict) else None
        elif path == 'ws-submit':
            r = ws_submit(S, wsh, b); sid = wsh if r['status'] == 202 else None
        else:
            r = submit_public(S, host, b); sid = host if r['status'] == 202 else None
        body = r.get('body')
        err = body.get('error') if isinstance(body, dict) else body
        row = {'arm': arm, 'case': case, 'path': path, 'blocks': len(sizes),
               'code_points': sum(sizes), 'utf16_units': sum(sizes) * (2 if ch == 'e' else 1),
               'http': r['status'], 'error': err if r['status'] != 202 else None, 'elapsed_s': r['elapsed']}
        if r['status'] == 202 and sid:
            cnt = 2 if path != 'public-create' else 1
            term, secs, evs = wait_terminal(S, sid, timeout=180, count=cnt)
            row['terminal'] = (term[-1]['type'], term[-1].get('data')) if term else 'TIMEOUT'
            row['secs_to_terminal'] = secs
            time.sleep(1)
            fake = [json.loads(l) for l in open(FAKE_LOG).readlines()[fake_before:]]
            hits = [f for f in fake if f.get('marker') == f'PR13335_IB_{case}']
            row['model_requests'] = len(hits)
            row['model_body_bytes'] = [f['bodyBytes'] for f in hits]
        if r.get('error'):
            row['transport_error'] = r['error']
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    json.dump(rows, open(f'{R}/results/t3-budget-{arm}.json', 'w'), indent=1, ensure_ascii=False)
    subprocess.run(['cp', f'{R}/runs/{tag}/spring.log', f'{R}/results/t3-budget-{arm}.spring.log'])
    subprocess.run([f'{R}/rig/stack.sh', 'down', tag], capture_output=True)
