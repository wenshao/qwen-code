import sys,re
# parse `am instrument -r` raw output: prints per-test status + summary
t=open(sys.argv[1],errors='replace').read()
blocks=re.split(r'\nINSTRUMENTATION_STATUS_CODE: (-?\d+)',t)
cur={}; res=[]
text=blocks[0]
for i in range(1,len(blocks),2):
    code=int(blocks[i]); body=text
    cls=re.findall(r'INSTRUMENTATION_STATUS: class=(\S+)',body); name=re.findall(r'INSTRUMENTATION_STATUS: test=(\S+)',body)
    stack=re.search(r'INSTRUMENTATION_STATUS: stack=(.*?)(?:\nINSTRUMENTATION_STATUS: |\Z)',body,re.S)
    if code!=1 and cls and name:
        c=cls[-1].split('.')[-1]; n=name[-1]
        label={0:'OK',-1:'ERROR',-2:'FAIL',-3:'IGNORED',-4:'ASSUMPTION-SKIP'}.get(code,str(code))
        msg=''
        if stack: msg=stack.group(1).strip().split('\n')[0][:220]
        res.append((c,n,label,msg))
    text=blocks[i+1] if i+1<len(blocks) else ''
from collections import Counter
for c,n,l,m in res: print(f'{l:16} {c}.{n}' + (f'  | {m}' if m and l!='OK' else ''))
print('SUMMARY', Counter(l for _,_,l,_ in res), 'total', len(res))
tail=re.findall(r'INSTRUMENTATION_CODE: (-?\d+)',t); print('INSTRUMENTATION_CODE', tail, re.findall(r'\n(OK \(\d+ tests?\)|FAILURES!!!.*)',t))
