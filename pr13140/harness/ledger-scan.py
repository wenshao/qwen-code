import json, glob, re
for f in sorted(glob.glob('/home/node/ledgers/*-*.jsonl')):
    reqs = [json.loads(l) for l in open(f)]
    if not reqs: continue
    sysmsg = next((m['content'] for m in reqs[0]['messages'] if m['role'] == 'system'), '')
    if not isinstance(sysmsg, str): sysmsg = json.dumps(sysmsg)
    sec = re.search(r'# Tool Execution Sandbox[^\n]*\n([^\n]*)', sysmsg)
    line = sec.group(0) if sec else '(no sandbox section)'
    net = re.findall(r'(command network policy is \w+|Command network policy is \w+|command network access follows the operator policy|Closed networking prevents new ordinary IP connections[^.]*\.)', line)
    tool = [m for r in reqs for m in r['messages'] if m['role'] == 'tool']
    tr = tool[-1]['content'] if tool else '(no tool result)'
    if not isinstance(tr, str): tr = json.dumps(tr)
    print(f.split('/')[-1], '| header:', line.split('\n')[0], '| network phrases:', net, '| tool result:', ' '.join(tr.split())[:200])
