import json, subprocess, sys, time
sys.path.insert(0, '/Users/wenshao/pr13335-rig/rig')
from drive import *
R = '/Users/wenshao/pr13335-rig'
results = []
for arm in sys.argv[1:] or ('base', 'merge'):
    tag = f't1-deadline-{arm}'
    up = subprocess.run([f'{R}/rig/stack.sh', 'up', arm, tag, 'QWEN_MANAGED_AGENT_HARNESS_TURN_DEADLINE=1800'], capture_output=True, text=True)
    print(up.stdout.strip())
    S = meta(tag)['SPRING']
    r = create_public(S, [{'type': 'input_text', 'text': f'PR13335_DEADLINE_{arm.upper()} HOLD8S'}])
    sid = r['body']['id']
    term, secs, evs = wait_terminal(S, sid, timeout=60)
    turn = call('GET', f"{S}/v1/agents/sessions/{sid}/turns")['body']
    row = {'arm': arm, 'create_status': r['status'], 'terminal': term[0]['type'] if term else None,
           'terminal_data': term[0].get('data') if term else None, 'secs_to_terminal': secs,
           'events': [e['type'] for e in evs], 'turns': turn}
    results.append(row)
    print(json.dumps(row, indent=1)[:1500])
    subprocess.run([f'{R}/rig/stack.sh', 'down', tag], capture_output=True)
json.dump(results, open(f'{R}/results/t1-deadline-' + '-'.join(sys.argv[1:] or ['base','merge']) + '.json', 'w'), indent=1)
