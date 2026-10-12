# usage: probediff.py <baseline-file>... -- <mutant-file>   prints the H2 probe lines whose outcome differs from head
import re,sys
i=sys.argv.index('--'); bases=sys.argv[1:i]; mut=sys.argv[i+1]
def load(paths):
    d={}
    for p in paths:
        for line in open(p,errors='replace'):
            m=re.match(r'PROBE (\S+) (h2|mysql) (.*?) :: (.*)$',line.rstrip('\n'))
            if not m or m.group(2)!='h2': continue
            key=re.sub(r'^(\S+) ','',m.group(3),count=0)
            d[m.group(3)]=re.sub(r'readbacks=\d+ ','',m.group(4))
    return d
b=load(bases); m=load([mut])
changed=[k for k in sorted(m) if k in b and b[k]!=m[k]]
print(f'{len(m)} probe lines, {len(changed)} differ from head')
for k in changed:
    print('  *',k[:110]); print('      head  :',b[k][:230]); print('      mutant:',m[k][:230])
