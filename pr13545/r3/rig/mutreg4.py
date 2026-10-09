import subprocess, re, os
RIG='/Users/wenshao/pr13545-rig'; wt='src-regh4'
REG='packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/api/SurfaceRegistry.java'
env=dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:'+os.environ['PATH'])
path=f'{RIG}/{wt}/{REG}'; orig=open(path).read()
import sys
plan=[('none',None,None,None),('R3 weaker','PUBLIC_SESSION_RENAME','OPERATOR','READER')]
for name,entry,frm,to in plan:
    src=orig
    if entry:
        m=re.search(r'(\n    '+entry+r'\((?:.|\n)*?RuleClass\.)'+frm+r'\b', src); src=src[:m.end(1)]+to+src[m.end():]
    open(path,'w').write(src)
    r=subprocess.run(['/Users/wenshao/Install/maven/bin/mvn','-B','-ntp',f'-Dmaven.repo.local={RIG}/m2-regh4','-Dcheckstyle.skip=true','-Dspotbugs.skip=true',
        '-Dtest=SurfaceAdmissionAcceptanceTest,SurfaceRegistryGate*Test','-Dsurefire.failIfNoSpecifiedTests=false','test'],
        cwd=f'{RIG}/{wt}/packages/sdk-java/managed-agent-server',env=env,capture_output=True,text=True)
    open(f'{RIG}/out/mutreg4-{name.split()[0]}.log','w').write(r.stdout)
    tot=re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\n',r.stdout)
    fails=sorted(set(re.findall(r'\[ERROR\]   (\S+?)(?::\d+)? ',r.stdout)))[:6]
    print(sys.argv[1] if len(sys.argv)>1 else 'h4',name,{'exit':r.returncode,'totals':tot[-1] if tot else None,'failing':fails},flush=True)
open(path,'w').write(orig)
