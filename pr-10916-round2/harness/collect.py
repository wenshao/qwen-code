import json, os, re, glob
R='/root/verify/pr10916/r2/runs'
out={'arms':{'main':'origin/main a011f66944','pr':'3fb6a1f042 merged with a011f66944 -> 09741fcd71 (clean)',
             'fix':'pr + harness/fix-r7-1-agent-history.patch',
             'mut-r11-1':'copy of pr dist/ with normalizeMcpToolError split restored to lastIndexOf (R11-1 negative control)',
             'mut-r11-2':'copy of pr dist/ with the immediate-drain clearToolErrorStreaks() removed (R11-2 negative control)'},
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
 'focused_pr':'11 files, 1926 passed (loopDetection, client, agent-headless, agent-core, shell, truncation, tool-response-finalizer, loggers, qwen-logger, log-to-span-processor, coreToolScheduler)',
 'mutations_on_pr':{
   'M-patchB: remove the steer accept() on halt (client.ts)':'client.test.ts 1 failed / 480 (settles a steer carrier written by the halt as accepted, not restored)',
   'M-mcp: MCP split back to lastIndexOf':'loopDetectionService.test.ts 1 failed / 173 (does not collapse MCP errors whose untrusted payloads quote the separator)',
   'M-wait: remove post-wait clearToolErrorStreaks()':'agent-headless.test.ts 1 failed / 76 (bounds the error streak to the prompt ...)',
   'M-drain: remove immediate-drain clearToolErrorStreaks()':'src/agents/runtime ALL GREEN 1376 passed / 7 skipped -- no unit witness; caught only by E2E S13'},
 'fix_arm':'src/agents/runtime + loopDetectionService + client: 2030 passed / 7 skipped; negative control (agent-core hunk reverted): agent-headless 1 failed / 77; core tsc --noEmit exit 0; eslint --max-warnings 0 exit 0; prettier clean'}
json.dump(out, open('/root/verify/pr10916/r2/runs/results.json','w'), indent=1, ensure_ascii=False)
print(len(out['runs']), 'runs')
