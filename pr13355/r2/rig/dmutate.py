#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13355): mutants on code guarded by tests this PR deletes;
# full managed-agent-server unit suite per mutant. usage: dmutate.py <label> <worktree> <m2>
import json, subprocess, sys, os, re
R='/Users/wenshao/git/pr13355-rig'; L, W, M2 = sys.argv[1:4]
S=W+'/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/'
env=dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:'+os.environ['PATH'])
for k in ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']: env.pop(k, None)
out=open(R+'/results/dmutants.tsv','a')
for m in json.load(open(os.environ.get('DMUT_FILE', R+'/dmutants.json'))):
    p=S+m['file']; orig=open(p).read()
    assert orig.count(m['old'])==1, m['id']
    mutated=orig.replace(m['old'], m['new'])
    if 'old2' in m:
        assert mutated.count(m['old2'])==1, m['id']
        mutated=mutated.replace(m['old2'], m['new2'])
    open(p,'w').write(mutated)
    log=f"{R}/logs/dmut-{L}-{m['id']}.log"
    try:
        rc=subprocess.run(['mvn','-B','-ntp','-o','-Dmaven.repo.local='+M2,'-Dcheckstyle.skip','-Dspotbugs.skip','test'],
            cwd=W+'/packages/sdk-java/managed-agent-server', env=env, stdout=open(log,'w'), stderr=subprocess.STDOUT).returncode
    finally:
        open(p,'w').write(orig)
    text=open(log).read()
    failed=sorted(set(re.findall(r'\[ERROR\]\s+(?:com\.[\w.]+\.)?(\w+Test)\.(\w+)', text)))
    total=(re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\n', text) or [('?','?','?','?')])[-1]
    status='COMPILE-ERROR' if 'COMPILATION ERROR' in text else ('KILLED' if rc!=0 else 'SURVIVED')
    line=f"{L}\t{m['id']}\t{status}\trun={total[0]} fail={total[1]} err={total[2]}\t{';'.join(c+'.'+t for c,t in failed)[:300]}"
    print(line, flush=True); out.write(line+'\n'); out.flush()
