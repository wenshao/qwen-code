# Registry-demotion mutants: declare a route's rule class weaker (or stronger) than its handler,
# run the acceptance walk + gate tests, record killed/survived. usage: python3 mutreg.py
import subprocess, re, json, os
RIG='/Users/wenshao/pr13545-rig'
REG='packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/api/SurfaceRegistry.java'
MUTS=[('none',None,None,None),
      ('R1 weaker','WEBSHELL_TURN_SUBMIT','OPERATOR','READER'),
      ('R2 weaker','PUBLIC_SESSION_DELETE','OWNER','OPERATOR'),
      ('R3 weaker','PUBLIC_SESSION_RENAME','OPERATOR','READER'),
      ('R4 stronger (control)','PUBLIC_SESSION_GET','READER','OPERATOR')]
env=dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:'+os.environ['PATH'])
out={}
for arm,wt,m2 in [('base','src-regb','m2-base'),('head','src-regh','m2-head')]:
    path=f'{RIG}/{wt}/{REG}'
    orig=open(path).read()
    for name,entry,frm,to in MUTS:
        src=orig
        if entry:
            m=re.search(r'(\n    '+entry+r'\((?:.|\n)*?RuleClass\.)'+frm+r'\b', src)
            assert m, (arm,entry)
            src=src[:m.end(1)]+to+src[m.end():]
        open(path,'w').write(src)
        log=f'{RIG}/out/mutreg-{arm}-{name.split()[0]}.log'
        r=subprocess.run(['/Users/wenshao/Install/maven/bin/mvn','-B','-ntp',f'-Dmaven.repo.local={RIG}/{m2}','-Dcheckstyle.skip=true','-Dspotbugs.skip=true',
            '-Dtest=SurfaceAdmissionAcceptanceTest,SurfaceRegistryGate*Test','-Dsurefire.failIfNoSpecifiedTests=false','test'],
            cwd=f'{RIG}/{wt}/packages/sdk-java/managed-agent-server',env=env,capture_output=True,text=True)
        open(log,'w').write(r.stdout+r.stderr)
        tot=re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\n',r.stdout)
        fails=sorted(set(re.findall(r'\[ERROR\]   (\S+?)(?::\d+)? ',r.stdout)))[:6]
        out[f'{arm}|{name}']={'exit':r.returncode,'totals':tot[-1] if tot else None,'failing':fails}
        print(arm,name,out[f'{arm}|{name}'],flush=True)
    open(path,'w').write(orig)
json.dump(out,open(f'{RIG}/out/mutreg.json','w'),indent=1)
print('MUTREG-DONE')
