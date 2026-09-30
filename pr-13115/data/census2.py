import sys, os, re, glob, json
# per profile/arm: recovery-fencing awaits, awaits whose first answer was fenced, total fenced replies, test results
rows=[]
for d in sys.argv[1:]:
    label=os.path.basename(d)
    res=[l.rstrip('\n').split('\t') for l in open(os.path.join(d,'results.tsv')) if l[0].isdigit()]
    for arm in ('head','base','fix'):
        f=os.path.join(d,f'census-{arm}.tsv')
        if not os.path.exists(f): continue
        awaits=first_fenced=fenced=timeouts=0; pending=0
        for line in open(f):
            p=line.rstrip('\n').split('\t')
            if len(p)<5 or 'recovery fencing' not in p[2]: continue
            code=(re.search(r'code=(\w+)',p[4]) or [None,'ok'])[1]
            if p[3]=='REJECT':
                pending+=1
                if code=='runtime_provision_fenced': fenced+=1
                if code=='runtime_broker_reconcile_timeout': timeouts+=1
            else:
                awaits+=1
                if pending: first_fenced+=1
                pending=0
        r=[x for x in res if x[1]==arm]
        tests=sum(int(re.search(r'Tests run: (\d+)',x[4]).group(1)) for x in r if 'Tests run' in x[4])
        bad=sum(int(m.group(1))+int(m.group(2)) for x in r for m in [re.search(r'Failures: (\d+), Errors: (\d+)',x[4])] if m)
        fence_sites={}
        ff=os.path.join(d,f'fence-{arm}.tsv')
        if os.path.exists(ff):
            for line in open(ff):
                p=line.rstrip('\n').split('\t')
                key=' <- '.join(p[3:6])
                fence_sites[key]=fence_sites.get(key,0)+1
        rows.append(dict(profile=label,arm=arm,runs=len(r),tests=tests,failed=bad,awaits=awaits,
                         first_fenced=first_fenced,fenced_replies=fenced,timeout_replies=timeouts,fence_sites=fence_sites))
for x in rows:
    print(f"{x['profile']:16} {x['arm']:4} runs={x['runs']} tests={x['tests']} failed={x['failed']} awaits={x['awaits']} first-answer-fenced={x['first_fenced']} fenced-replies={x['fenced_replies']} timeout-replies={x['timeout_replies']}")
json.dump(rows,open('/root/verify/pr13115/stress/census-summary.json','w'),indent=1)
