import json, subprocess, sys, time, re, os
sys.path.insert(0, '/Users/wenshao/pr13335-rig/rig')
from drive import *
R = '/Users/wenshao/pr13335-rig'
JSTACK = '/Users/wenshao/Install/zulu21.52.15-ca-jdk21.0.12-macosx_aarch64/Contents/Home/bin/jstack'
GL = f'{R}/my/general.log'
HOLD = int(os.environ.get('HOLD', '40'))
out = {}
for arm in sys.argv[1:] or ('base', 'merge'):
    tag = f't6-sched-{arm}'
    print(subprocess.run([f'{R}/rig/stack.sh', 'up', arm, tag], capture_output=True, text=True).stdout.strip(), flush=True)
    S = meta(tag)['SPRING']; db = meta(tag)['DB']
    spid = open(f'{R}/runs/{tag}/spring.pid').read().strip()
    sid = create_public(S, [{'type': 'input_text', 'text': 'PR13335_SCHED hi'}])['body']['id']
    wait_terminal(S, sid, 60); time.sleep(2)
    sql(db, "SET GLOBAL general_log = 'OFF'"); open(GL, 'w').close(); sql(db, "SET GLOBAL general_log = 'ON'")
    time.sleep(5)  # pre-stall baseline window
    locker = subprocess.Popen([MYSQL, '-uroot', '-S', SOCK, db, '-e',
        f"BEGIN; SELECT session_id FROM managed_agent_session WHERE tenant_id='pr13335' AND session_id='{sid}' FOR UPDATE; SELECT SLEEP({HOLD}); COMMIT;"],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    time.sleep(0.5)
    t_lock = time.time()
    print('make target:', sql(db, f"UPDATE managed_agent_consumer_progress SET covered_sequence = covered_sequence - 1 WHERE session_id='{sid}' AND consumer_name='message_projection'; SELECT ROW_COUNT()"))
    time.sleep(5)
    js = subprocess.run([JSTACK, spid], capture_output=True, text=True).stdout
    threads = {}
    for block in js.split('\n\n'):
        m = re.match(r'"((?:scheduling|message-materialize)-\d+)"', block.strip())
        if m:
            lines = block.strip().splitlines()
            state = next((l.strip() for l in lines if 'java.lang.Thread.State' in l), '')
            ours = [l.strip() for l in lines if 'com.alibaba.qwen' in l][:3]
            threads[m.group(1)] = {'state': state, 'top_app_frames': ours}
    locker.wait(); t_unlock = time.time()
    time.sleep(5)
    sql(db, "SET GLOBAL general_log = 'OFF'")
    # bucket the scan SQL by seconds relative to lock start
    pat_dispatch = "FROM managed_agent_turn WHERE status IN ('ACCEPTED', 'RUNNING', 'CANCELLING')"
    pat_target = 'JOIN managed_agent_consumer_progress p ON'
    counts = {'pre_5s': [0, 0], 'stall': [0, 0], 'post_5s': [0, 0]}
    import datetime
    for line in open(GL, errors='replace'):
        m = re.match(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+)Z', line)
        if not m:
            continue
        ts = datetime.datetime.fromisoformat(m.group(1)).replace(tzinfo=datetime.timezone.utc).timestamp()
        win = 'pre_5s' if ts < t_lock else ('stall' if ts < t_unlock else 'post_5s')
        if pat_dispatch in line: counts[win][0] += 1
        if pat_target in line: counts[win][1] += 1
    out[arm] = {'stall_seconds': round(t_unlock - t_lock, 1), 'threads_during_stall': threads,
                'findDispatchable_count': {k: v[0] for k, v in counts.items()},
                'findMaterializationTargets_count': {k: v[1] for k, v in counts.items()}}
    print(json.dumps(out[arm], indent=1), flush=True)
    subprocess.run(['cp', GL, f'{R}/results/t6-general-{arm}.log'])
    subprocess.run([f'{R}/rig/stack.sh', 'down', tag], capture_output=True)
json.dump(out, open(f'{R}/results/t6-scheduler-' + '-'.join(sys.argv[1:] or ['base','merge']) + '.json', 'w'), indent=1)
