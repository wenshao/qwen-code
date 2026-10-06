import json, os, subprocess, sys, threading, time
sys.path.insert(0, '/Users/wenshao/pr13335-rig/rig')
from drive import *
R = '/Users/wenshao/pr13335-rig'
FAKE_LOG = f'{R}/fake-requests.jsonl'
LEASE = os.environ.get('LEASE', '120')
HOLD = int(os.environ.get('HOLD', '20'))
results = []
for arm in sys.argv[1:] or ('base', 'merge'):
    a, b = f't2-lease-{arm}-A', f't2-lease-{arm}-B'
    env = [f'QWEN_MANAGED_AGENT_DISPATCH_LEASE_DURATION={LEASE}']
    print(subprocess.run([f'{R}/rig/stack.sh', 'up', arm, a, *env], capture_output=True, text=True).stdout.strip())
    off = 21 if arm == 'base' else 31
    envb = dict(os.environ, REUSE=a, SPRING_PORT=str(18400 + off), BROKER_PORT=str(18400 + off + 2))
    print(subprocess.run([f'{R}/rig/stack.sh', 'up', arm, b, *env], capture_output=True, text=True, env=envb).stdout.strip())
    S = meta(a)['SPRING']; db = meta(a)['DB']
    marker = f'PR13335_LEASE_{arm.upper()}'
    fake_before = sum(1 for _ in open(FAKE_LOG))
    samples, stop = [], threading.Event()
    def sampler():
        while not stop.is_set():
            out = sql(db, "SELECT status, dispatch_owner, dispatch_lease_until - CAST(UNIX_TIMESTAMP(NOW(3))*1000 AS SIGNED) FROM managed_agent_turn")
            samples.append((round(time.time(), 2), out))
            time.sleep(0.2)
    th = threading.Thread(target=sampler); th.start()
    t0 = time.time()
    r = create_public(S, [{'type': 'input_text', 'text': f'{marker} HOLD{HOLD}S'}])
    sid = r['body']['id']
    term, secs, evs = wait_terminal(S, sid, timeout=HOLD + 60)
    time.sleep(3)
    stop.set(); th.join()
    fake = [json.loads(l) for l in open(FAKE_LOG).readlines()[fake_before:]]
    model_calls = [f for f in fake if f.get('marker') == marker]
    rows = [s for s in samples if s[1]]
    running = [s for s in rows if s[1].split('\t')[0] not in ('COMPLETED', 'FAILED', 'CANCELLED')]
    expired = [s for s in running if s[1].split('\t')[2] not in ('NULL', '') and int(s[1].split('\t')[2]) < 0]
    owners = sorted({s[1].split('\t')[1] for s in rows if s[1].split('\t')[1] != 'NULL'})
    def grep(tag, pat):
        try:
            return [l.strip()[:300] for l in open(f'{R}/runs/{tag}/spring.log') if pat in l]
        except FileNotFoundError:
            return []
    row = {'arm': arm, 'lease_env': LEASE, 'create': r['status'], 'terminal': [t['type'] for t in term] if term else None,
           'terminal_data': [t.get('data') for t in term] if term else None, 'secs': secs,
           'event_types': [e['type'] for e in evs],
           'samples_running': len(running), 'samples_running_lease_expired': len(expired),
           'lease_remaining_ms_first5': [s[1].split('\t')[2] for s in running[:5]],
           'distinct_dispatch_owners': owners, 'model_calls_for_marker': len(model_calls),
           'B_log_turn_lines': grep(b, 'Turn')[:8], 'A_log_warn': grep(a, ' WARN ')[:8]}
    results.append(row)
    print(json.dumps(row, indent=1))
    json.dump({'row': row, 'samples': samples}, open(f'{R}/results/t2-lease-{arm}-{LEASE}.json', 'w'), indent=1)
    for tag in (b, a):
        subprocess.run([f'{R}/rig/stack.sh', 'down', tag], capture_output=True)
