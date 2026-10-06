#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13355): apply each mutant to the pr13355-mut worktree,
# run the targeted Java test classes offline, record killed/survived, restore.
import json, subprocess, sys, os, re, shutil
R='/Users/wenshao/git/pr13355-rig'; W=os.environ.get('MUT_WT','/Users/wenshao/git/pr13355-mut'); M2=os.environ.get('MUT_M2',R+'/m2-mut'); TAG=os.environ.get('MUT_TAG','')
S=W+'/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/'
TESTS='ManagedExtensionRecordStoreTest,ManagedExtensionProjectionContractTest,ManagedSessionStoreContractFixtureTest,ManagedSessionStoreIntegrationTest,ManagedActionsTest,ToolPublicationStoreTest,PlannedTaskContractTest'
env=dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:'+os.environ['PATH'])
for k in ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']: env.pop(k, None)
only=sys.argv[1:]
out=open(R+'/results/mutants.tsv','a')
for m in json.load(open(os.environ.get('MUT_FILE', R+'/mutants.json'))):
    if only and m['id'] not in only: continue
    p=S+m['file']; orig=open(p).read()
    if orig.count(m['old'])!=1:
        print('ANCHOR', m['id'], orig.count(m['old'])); out.write(f"{m['id']}\tANCHOR-{orig.count(m['old'])}\n"); out.flush(); continue
    mutated=orig.replace(m['old'], m['new'])
    if 'old2' in m:
        assert mutated.count(m['old2'])==1, m['id']
        mutated=mutated.replace(m['old2'], m['new2'])
    open(p,'w').write(mutated)
    log=f"{R}/logs/mut{TAG}-{m['id']}.log"
    try:
        rc=subprocess.run(['mvn','-B','-ntp','-o','-Dmaven.repo.local='+M2,'-Dcheckstyle.skip','-Dspotbugs.skip','-Dtest='+TESTS,'-Dsurefire.failIfNoSpecifiedTests=false','test'],
            cwd=W+'/packages/sdk-java/managed-agent-server', env=env, stdout=open(log,'w'), stderr=subprocess.STDOUT).returncode
    finally:
        open(p,'w').write(orig)
    text=open(log).read()
    compile_err='COMPILATION ERROR' in text
    failed=sorted(set(re.findall(r'\[ERROR\]\s+(\w+Test)\.(\w+)', text)))
    status='COMPILE-ERROR' if compile_err else ('KILLED' if rc!=0 else 'SURVIVED')
    names=';'.join(f'{c}.{t}' for c,t in failed)[:400]
    line=f"{TAG or 'head'}\t{m['id']}\t{status}\t{names}"
    print(line, flush=True); out.write(line+'\n'); out.flush()
