import json,sys,os,glob
def cls_tool(r,x):
    s=x['content']
    if r.get('marker') and r['marker'] in s: return 'REAL'
    if 'was not recorded' in s: return 'PLACEHOLDER'
    return 'OTHER:'+s[:50]
def cls(r,p):
    if not p: return 'n/a'
    if not p.get('load',{}).get('ok'): return 'LOAD-FAIL:'+json.dumps(p['load'].get('error',{}).get('data'))
    pr=p.get('prompt') or {}
    fr=p.get('firstRequest')
    if not pr.get('ok'):
        return 'PROMPT-FAIL:%s nreq=%d'%((pr.get('error') or {}).get('data',{}).get('errorKind') if isinstance((pr.get('error') or {}).get('data'),dict) else pr.get('error'),p['modelRequests'])
    if not fr: return 'ok nreq=%d'%p['modelRequests']
    return 'nreq=%d %s'%(p['modelRequests'],[(x['id'],cls_tool(r,x)) for x in fr['tools']])
def tr_count(path):
    if not os.path.exists(path): return None
    n=0
    for l in open(path):
        if not l.strip(): continue
        j=json.loads(l); ms=j.get('managedSession') or {}
        if ms.get('kind')=='message.committed' and ms.get('payload',{}).get('role')=='tool_result': n+=1
    return n
rows=[]
for d in sorted(glob.glob('*/*')):
    try: r=json.load(open(d+'/report.json'))
    except Exception as e: print(d,'NOREPORT'); continue
    ph={p['name']:p for p in r['phases']}
    p1=ph['phase1']; c=p1['log']['counts']
    rows.append((d, 'intent=%s receipt=%s tool_result=%s'%(c.get('tool.intent',0),c.get('tool.receipt',0),tr_count(d+'/log-after-phase1.jsonl')),
      cls(r,ph.get('phase2-reopen')), 'tool_result_after_open1=%s'%tr_count(d+'/log-after-phase2.jsonl'),
      cls(r,ph.get('phase3-second-open')), 'tool_result_after_open2=%s'%tr_count(d+'/log-after-phase3.jsonl'), 'FATAL' if r.get('fatal') else ''))
for row in rows: print(' | '.join(row))
