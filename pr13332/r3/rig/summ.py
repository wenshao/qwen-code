import json,sys
import os
S=os.environ.get('SUMM_DIR','/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/6e71d8f5-1773-47a3-9ac8-2a5067bb20d2/scratchpad/pr13332')
for k in sys.argv[1:]:
    d=json.load(open('%s/%s.json'%(S,k)))
    fails=[(r['name'].split('/packages/')[-1],a['fullName']) for r in d['testResults'] for a in r['assertionResults'] if a['status']=='failed']
    ferr=[(r['name'].split('/packages/')[-1], r.get('message','')[:200]) for r in d['testResults'] if r['status']=='failed' and not any(a['status']=='failed' for a in r['assertionResults'])]
    print(k,'files',len(d['testResults']),'tests',d['numTotalTests'],'passed',d['numPassedTests'],'failed',d['numFailedTests'],'skipped',d['numPendingTests'])
    for f in fails: print('   FAIL',f)
    for f in ferr: print('   FILE-ERR',f)
