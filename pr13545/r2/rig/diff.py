import json
b=json.load(open('out/cells-base.json'))
h=json.load(open('out/cells-head.json'))
def summ(v):
    if not isinstance(v,dict): return str(v)
    if 'get' in v: return f"wsTurns={v['get'].get('workspaceTurns', v['get'].get('status'))}/{v['query'].get('workspaceTurns', 'unlisted')}"
    s=str(v.get('status'))
    if v.get('code'): s+=' '+v['code']
    if v.get('turn'): s+=' →'+(v['turn'] if isinstance(v['turn'],str) else '/'.join(v['turn']))
    if v.get('state'): s+=' →'+v['state']+(('('+v['failure']+')') if v.get('failure') else '')
    if v.get('op') and isinstance(v['op'],dict) and v['op'].get('state'): s+=' op→'+v['op']['state']
    return s
keys=[k for k in b if not k.startswith(('K|','D|'))]
same=diff=0; rows=[]
for k in keys:
    if k not in h: continue
    sb,sh=summ(b[k]),summ(h[k])
    # timing-free comparison
    if sb==sh: same+=1
    else: diff+=1; rows.append((k,sb,sh))
print(f'{len(keys)} comparable cells: {same} identical, {diff} changed')
for r in rows: print(' | '.join(r))
json.dump({'total':len(keys),'same':same,'changed':[{'k':k,'base':sb,'head':sh} for k,sb,sh in rows]},open('out/diff.json','w'),indent=1)
