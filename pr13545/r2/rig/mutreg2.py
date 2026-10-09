import subprocess, re, os
RIG='/Users/wenshao/pr13545-rig'
REG='packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/api/SurfaceRegistry.java'
env=dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:'+os.environ['PATH'])
for arm,wt,m2,muts in [('head','src-regh','m2-head',[('PUBLIC_CWD_CHANGE','OPERATOR','READER'),('WEBSHELL_CWD_CHANGE','OPERATOR','READER')]),
                       ('base','src-regb','m2-base',[('PUBLIC_CWD_CHANGE','OWNER','READER'),('WEBSHELL_CWD_CHANGE','OWNER','READER')])]:
    path=f'{RIG}/{wt}/{REG}'; orig=open(path).read(); src=orig
    for entry,frm,to in muts:
        m=re.search(r'(\n    '+entry+r'\((?:.|\n)*?RuleClass\.)'+frm+r'\b', src); assert m,(arm,entry)
        src=src[:m.end(1)]+to+src[m.end():]
    open(path,'w').write(src)
    r=subprocess.run(['/Users/wenshao/Install/maven/bin/mvn','-B','-ntp',f'-Dmaven.repo.local={RIG}/{m2}','-Dcheckstyle.skip=true','-Dspotbugs.skip=true',
        '-Dtest=SurfaceAdmissionAcceptanceTest,SurfaceRegistryGate*Test','-Dsurefire.failIfNoSpecifiedTests=false','test'],
        cwd=f'{RIG}/{wt}/packages/sdk-java/managed-agent-server',env=env,capture_output=True,text=True)
    open(f'{RIG}/out/mutreg2-{arm}.log','w').write(r.stdout)
    tot=re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\n',r.stdout)
    fails=sorted(set(re.findall(r'\[ERROR\]   (\S+?)(?::\d+)? ',r.stdout)))[:6]
    print(arm,'R5 cwd twin family -> READER',{'exit':r.returncode,'totals':tot[-1] if tot else None,'failing':fails},flush=True)
    open(path,'w').write(orig)
