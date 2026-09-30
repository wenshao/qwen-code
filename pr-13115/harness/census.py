import sys, glob, os, collections, re
# summarize census files: per profile/arm, recovery-fencing awaits
for d in sys.argv[1:]:
    label=os.path.basename(d)
    for arm in ('head','base','fix'):
        f=os.path.join(d,f'census-{arm}.tsv')
        if not os.path.exists(f): continue
        rej=collections.Counter(); acc=collections.Counter(); iters=set()
        for line in open(f):
            p=line.rstrip('\n').split('\t')
            if len(p)<5: continue
            ts,it,what,verdict,val=p[:5]
            iters.add(it)
            if 'recovery fencing' not in what: continue
            m=re.search(r'code=(\w+)',val); code=m.group(1) if m else 'ok'
            (rej if verdict=='REJECT' else acc)[code]+=1
        print(f'{label:18} {arm:5} iters={len(iters)} accept={dict(acc)} swallowed={dict(rej)}')
