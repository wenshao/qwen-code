# Same three batch mutants, run against the OLD cleanup.test.ts (ae8fd0a5) and
# the NEW one (b83983c19). Only the test file differs between the two columns.
import subprocess, os
REPO='/Users/wenshao/git/qwen-12374-head'; CLI=os.path.join(REPO,'packages/cli')
SRC=os.path.join(REPO,'packages/cli/src/utils/housekeeping/cleanup.ts')
TST=os.path.join(REPO,'packages/cli/src/utils/housekeeping/cleanup.test.ts')
env=dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
FN='export async function cleanupOldDebugLogs('
MUT=[('M15',"for (let i = 0; i < logFiles.length; i += SWEEP_CONCURRENCY) {","for (let i = 0; i < logFiles.length; i += 100000000) {"),
     ('M17',"const batch = logFiles.slice(i, i + SWEEP_CONCURRENCY);","const batch = logFiles.slice(i, i + SWEEP_CONCURRENCY - 1);"),
     ('M19',"for (let i = 0; i < logFiles.length; i += SWEEP_CONCURRENCY) {","for (let i = 0; i < logFiles.length; i += SWEEP_CONCURRENCY + 1) {")]
old_test=subprocess.run(['git','show','ae8fd0a5:packages/cli/src/utils/housekeeping/cleanup.test.ts'],cwd=REPO,capture_output=True,text=True,check=True).stdout
new_test=open(TST,encoding='utf-8').read(); src0=open(SRC,encoding='utf-8').read()
def run():
    p=subprocess.run(['npx','vitest','run','src/utils/housekeeping/cleanup.test.ts','src/services/housekeeping/scheduler.test.ts','--reporter=dot','--coverage.enabled=false'],cwd=CLI,capture_output=True,text=True,env=env,timeout=900)
    return 'KILLED' if p.returncode else 'SURVIVED'
res={}
try:
    for label,test in (('old test file (ae8fd0a5)',old_test),('new test file (b83983c19)',new_test)):
        open(TST,'w',encoding='utf-8').write(test)
        res[(label,'unmutated')]=run()
        for mid,a,b in MUT:
            i=src0.find(FN); body=src0[i:]; assert body.count(a)==1
            open(SRC,'w',encoding='utf-8').write(src0[:i]+body.replace(a,b,1))
            res[(label,mid)]=run(); open(SRC,'w',encoding='utf-8').write(src0)
            print(label,mid,res[(label,mid)],flush=True)
finally:
    open(TST,'w',encoding='utf-8').write(new_test); open(SRC,'w',encoding='utf-8').write(src0)
for k,v in res.items(): print(k,v)
