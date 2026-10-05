import re,os,statistics,json
rows=[]
for line in open('jobs.tsv'):
    rid,sha,jid,name,concl,runner,start,end=line.rstrip('\n').split('\t')
    t=open(f'ext/{jid}.txt',encoding='utf-8',errors='replace').read().splitlines()
    t=[l[29:] if re.match(r'\d{4}-\d\d-\d\dT',l) else l for l in t]
    filems=None; tms='-'; st='not-listed'; retry=''; filefail=''
    has_test_in_tree=None
    for l in t:
        m=re.search(r'hosted-harness-session\.test\.ts \((\d+) tests(?: \| (\d+) failed)?(?: \| \d+ skipped)?\) (\d+)ms',l)
        if m and filems is None: filems=int(m.group(3)); filefail=m.group(2) or ''
        m=re.search(r'([✓×]) Hosted Harness no-tool session > refuses a cold load when a settled file tool outcome is missing from its checkpoint +(\d+)ms( \(retry x(\d)\))?',l)
        if m:
            tms=int(m.group(2)); st='pass' if m.group(1)=='✓' else 'FAIL'; retry=m.group(4) or ''
    lines=[l for l in t if re.search(r'hosted-harness-session\.test\.ts:\d+:\d+',l)]
    rows.append(dict(job=jid,sha=sha,start=start,runner=runner,concl=concl,file_ms=filems,file_failed=filefail,test_ms=tms,status=st,retry=retry,loc=sorted(set(re.findall(r'hosted-harness-session\.test\.ts:\d+:\d+',' '.join(lines))))))
rows.sort(key=lambda r:r['start'])
with open('census.tsv','w') as f:
    f.write('job\tsha\tstarted\trunner\tconclusion\tfile_ms\tfile_failed\ttest_ms\tstatus\tretry\tfail_locs\n')
    for r in rows: f.write('\t'.join(str(r[k]) for k in ['job','sha','start','runner','concl','file_ms','file_failed','test_ms','status','retry'])+'\t'+','.join(r['loc'])+'\n')
fm=[r['file_ms'] for r in rows if r['file_ms']]
print('jobs',len(rows),'with file line',len(fm),'file median',statistics.median(fm),'max',max(fm))
from collections import Counter
print(Counter(r['status'] for r in rows))
print('retries absorbed on pass:',[ (r['job'],r['retry'],r['test_ms']) for r in rows if r['status']=='pass' and r['retry']])
listed=[r['test_ms'] for r in rows if r['status']=='pass']
print('listed pass durations', sorted(listed))
for r in rows:
    if r['concl']=='failure' or r['status']!='not-listed' or r['file_failed']:
        print(r['job'],r['sha'],r['start'][:16],r['runner'],r['concl'],r['file_ms'],'filefail='+r['file_failed'],r['status'],r['test_ms'],'retry'+r['retry'],r['loc'])
