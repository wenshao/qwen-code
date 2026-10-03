import json, os, re, glob
R='/root/verify/pr10916/r3/runs'
out={'arms':{'main':'origin/main bfb32c780d','pr':'72f3d0ae04 merged with bfb32c780d (clean) -> c72e773b17',
             'mut-r71':'copy of pr dist/ with only the 72f3d0ae04 agent-core hunk removed (R7-1 negative control)'},
     'runs':{}}
def flat(c): return c if isinstance(c,str) else ''.join(p.get('text','') for p in c) if isinstance(c,list) else ''
for d in sorted(os.listdir(R)):
    p=f'{R}/{d}'
    if not os.path.isdir(p) or not os.path.exists(f'{p}/requests.jsonl'): continue
    reqs=[json.loads(l) for l in open(f'{p}/requests.jsonl')]
    rec={'requests_by_kind':{}}
    for r in reqs: rec['requests_by_kind'][r['kind']]=rec['requests_by_kind'].get(r['kind'],0)+1
    if os.path.exists(f'{p}/exit_code'): rec['exit_code']=int(open(f'{p}/exit_code').read().strip() or -1)
    for f in ['stdout.txt','stderr.txt']:
        if os.path.exists(f'{p}/{f}'):
            ls=[l for l in open(f'{p}/{f}').read().splitlines() if l.strip()]
            rec[f.split('.')[0]+'_last']=ls[-1] if ls else ''
    if os.path.exists(f'{p}/result.json'):
        rec['result']={k:v for k,v in json.load(open(f'{p}/result.json')).items() if not k.startswith('screen')}
    for f in ['mcp-hits.jsonl','hook-calls.jsonl']:
        if os.path.exists(f'{p}/{f}'): rec[f]=[json.loads(l) for l in open(f'{p}/{f}')]
    if os.path.exists(f'{p}/ws/notes.txt'): rec['notes_txt_on_disk']=open(f'{p}/ws/notes.txt').read()
    # tool results as seen by the model (last occurrence of each call id)
    tr={}
    for r in reqs:
        for m in r['messages']:
            if m.get('role')=='tool': tr[m.get('tool_call_id')]=flat(m.get('content'))[:600]
    rec['tool_results_seen_by_model']=tr
    st=None
    for r in reqs:
        for m in r['messages']:
            c=flat(m.get('content'))
            mm=re.search(r'<status>([^<]+)</status>', c)
            if 'task-notification' in c and mm: st=mm.group(1)
    if st: rec['background_agent_status']=st
    out['runs'][d]=rec
for f in ['full-core-pr.json','full-core-main.json']:
    p=f'{R}/{f}'
    if os.path.exists(p):
        d=json.load(open(p))
        fails=sorted(f"{t['name'].split('packages/core/')[-1]} > {a['fullName']}" for t in d['testResults'] for a in t['assertionResults'] if a['status']=='failed')
        out.setdefault('full_core_suite',{})[f.split('-')[2].split('.')[0]]={k:d[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']} | {'failed':fails}
out['unit']={
 'focused_pr':'src/agents/runtime + loopDetectionService + client: 28 files, 2031 passed / 7 skipped',
 'negative_control':'agent-core hunk of 72f3d0ae04 reverted in source: agent-headless.test.ts 1 failed / 77 (records the halting round results in history so the calls stay paired (issue #10887))',
 'static':'packages/core tsc --noEmit exit 0; eslint --max-warnings 0 exit 0 and prettier clean on both changed files',
 'cli':'packages/cli nonInteractiveCli.test.ts 180 passed / 1 skipped'}
json.dump(out, open('/root/verify/pr10916/r3/runs/results.json','w'), indent=1, ensure_ascii=False)
print(len(out['runs']), 'runs')
