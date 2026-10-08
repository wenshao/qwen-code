import subprocess, sys, re, os, time
R='/Users/wenshao/pr13544-rig'; W=f'{R}/src-mut'; S=f'{W}/packages/sdk-java/managed-agent-server'
MIG=f'{S}/src/main/resources/db/migration/V51__managed_workspace_roles.sql'
J=f'{S}/src/main/java/com/alibaba/qwen/code/managedagent/store'
REG=f'{J}/ManagedWorkspaceRegistry.java'; STORE=f'{J}/ManagedAgentStore.java'; EXE=f'{J}/WorkspaceExecutionStore.java'
TARGET='ManagedWorkspaceRolesMigrationTest,ManagedSessionOwnerTest'
M0=[
 ('M1 drop role CHECK', MIG, "ALTER TABLE managed_workspace_access\n    ADD CONSTRAINT managed_workspace_access_role\n    CHECK (role IN ('READER', 'OPERATOR', 'OWNER'));\n", "", TARGET),
 ("M2 restore DEFAULT 'READER'", MIG, "MODIFY COLUMN role VARCHAR(16) NOT NULL;", "MODIFY COLUMN role VARCHAR(16) NOT NULL DEFAULT 'READER';", TARGET),
 ('M3 keep can_read=FALSE rows', MIG, "DELETE FROM managed_workspace_access WHERE can_read = FALSE;\n", "", TARGET),
 ('M4 swap OPERATOR/READER backfill', MIG, "CASE WHEN can_create THEN 'OPERATOR' ELSE 'READER' END", "CASE WHEN can_create THEN 'READER' ELSE 'OPERATOR' END", TARGET),
 ('M5 drop owner backfill', MIG, "UPDATE managed_agent_session SET owner_actor_key = creator_actor_key;", "", TARGET),
 ('M6 creation writes owner NULL', STORE, "actorKey, actorKey);", "actorKey, null);", TARGET),
 ('M7 canRead narrowed to OPERATOR+', REG, "AND actor_id = ? AND role IN ('READER', 'OPERATOR',\"\n                + \" 'OWNER')\",\n                Integer.class", "AND actor_id = ? AND role IN ('OPERATOR',\"\n                + \" 'OWNER')\",\n                Integer.class", '*Test'),
 ("M8 list filter as role >= 'READER' (collation trap)", STORE, "AND wa.role IN ('READER', 'OPERATOR', 'OWNER')))", "AND wa.role >= 'READER'))", '*Test'),
 ('M9 cwd facts admit READER', STORE, "r.state = 'ACTIVE' AND a.role IN ('OPERATOR',\"\n                        + \" 'OWNER')\"", "r.state = 'ACTIVE' AND a.role IN ('READER', 'OPERATOR',\"\n                        + \" 'OWNER')\"", '*Test'),
 ('M10 passive attachment admits READER', EXE, ".atLeast(WorkspaceAccess.OPERATOR)", ".atLeast(WorkspaceAccess.READER)", '*Test'),
 ('M11 canCreateSession admits READER', REG, ".atLeast(WorkspaceAccess.OPERATOR)\n                        && \"ACTIVE\"", ".atLeast(WorkspaceAccess.READER)\n                        && \"ACTIVE\"", '*Test'),
]
M=list(M0)
if '--full' in sys.argv:
    M=[(n+' [full suite]',f,o,nw,'*Test') for (n,f,o,nw,t) in M0 if n.split()[0] in ('M1','M2')]
only = [a for a in sys.argv[1:] if a!='--full']
env=dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:'+os.environ['PATH'])
out=open(f'{R}/out/mutation.txt','a')
for name,f,old,new,tests in M:
    if only and name.split()[0] not in only: continue
    src=open(f).read()
    if src.count(old)!=1:
        out.write(f'{name}: ANCHOR count={src.count(old)} SKIPPED\n'); out.flush(); continue
    open(f,'w').write(src.replace(old,new))
    t=time.time()
    log=f'{R}/out/mut-{name.split()[0]}.log'
    with open(log,'w') as L:
        rc=subprocess.run(['/Users/wenshao/Install/maven/bin/mvn','-B','-ntp',f'-Dmaven.repo.local={R}/m2-mut','-Dcheckstyle.skip=true','-Dspotbugs.skip=true','-Dsurefire.failIfNoSpecifiedTests=false',f'-Dtest={tests}','clean','test'],cwd=S,stdout=L,stderr=subprocess.STDOUT,env=env).returncode
    subprocess.run(['git','checkout','--',f],cwd=W)
    txt=open(log).read()
    tot=re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$',txt,re.M)
    failing=sorted(set(re.findall(r'\[ERROR\]\s+(\w+)\.(\w+)',txt)))
    verdict='KILLED' if rc!=0 and failing else ('SURVIVED' if rc==0 else 'BUILD-ERROR')
    out.write(f'{name}: {verdict} tests={tests} totals={tot[-1] if tot else None} killers={[a+"."+b for a,b in failing][:6]} {int(time.time()-t)}s\n'); out.flush()
