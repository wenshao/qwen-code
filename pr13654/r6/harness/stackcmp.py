import re,sys
def runs(path):
    out={}; cur=None
    for line in open(path,errors='replace'):
        m=re.match(r'=== R(\d+) \[[^\]]+\] (.*?) \(\d\d:\d\d:\d\d\)',line)
        if m: cur=m.group(2); out[cur]=[]; continue
        if cur and re.match(r'\[(turn|ops|objects|bytes stdout|bytes stderr)\]',line):
            l=line.strip()
            l=re.sub(r' \d+ms$','',l)                       # turn duration
            l=re.sub(r'managed-tool-results/\S+','<object>',l)
            out[cur].append(l)
    return out
a=runs(sys.argv[1]); b=runs(sys.argv[2])
same=diff=0
for k in b:
    if k not in a: continue
    if a[k]==b[k]: same+=1; print('SAME   ',k)
    else:
        diff+=1; print('DIFF   ',k)
        for x,y in zip(a[k],b[k]):
            if x!=y: print('    r5:',x[:160]); print('    r6:',y[:160])
print(f'{same} same, {diff} different')
