import subprocess, sys, re, os, time
# Round 2 (head 28734793da): V52 + byte-exact CHECK. H2 full suite per mutant, and the
# real-engine ManagedWorkspaceRolesMySqlIT on MySQL 8.4 / MariaDB for the CHECK-shape mutants.
R='/Users/wenshao/pr13544-rig'; W=f'{R}/src-mut'; SJ=f'{W}/packages/sdk-java'; S=f'{SJ}/managed-agent-server'
MIG=f'{S}/src/main/resources/db/migration/V52__managed_workspace_roles.sql'
J=f'{S}/src/main/java/com/alibaba/qwen/code/managedagent/store'
REG=f'{J}/ManagedWorkspaceRegistry.java'; STORE=f'{J}/ManagedAgentStore.java'; EXE=f'{J}/WorkspaceExecutionStore.java'
TARGET='ManagedWorkspaceRolesMigrationTest,ManagedSessionOwnerTest'
CHK=("ALTER TABLE managed_workspace_access\n    ADD CONSTRAINT managed_workspace_access_role\n"
     "    CHECK ((role = 'READER' AND CHAR_LENGTH(role) = 6)\n        OR (role = 'OPERATOR' AND CHAR_LENGTH(role) = 8)\n"
     "        OR (role = 'OWNER' AND CHAR_LENGTH(role) = 5));\n")
INLIST=("ALTER TABLE managed_workspace_access\n    ADD CONSTRAINT managed_workspace_access_role\n"
        "    CHECK (role IN ('READER', 'OPERATOR', 'OWNER'));\n")
ENG=['mysql','mariadb']
M=[
 ('M1 drop role CHECK', MIG, CHK, "", '*Test', []),
 ("M1b CHECK back to IN-list (round-1 shape)", MIG, CHK, INLIST, '*Test', ENG),
 ("M1c READER loses its length guard", MIG, "(role = 'READER' AND CHAR_LENGTH(role) = 6)", "(role = 'READER')", '*Test', ENG),
 ("M1d OWNER loses its length guard", MIG, "(role = 'OWNER' AND CHAR_LENGTH(role) = 5)", "(role = 'OWNER')", '*Test', ENG),
 ("M2 restore DEFAULT 'READER'", MIG, "MODIFY COLUMN role VARCHAR(16) NOT NULL;", "MODIFY COLUMN role VARCHAR(16) NOT NULL DEFAULT 'READER';", '*Test', []),
 ('M3 keep can_read=FALSE rows', MIG, "DELETE FROM managed_workspace_access WHERE can_read = FALSE;\n", "", TARGET, []),
 ('M4 swap OPERATOR/READER backfill', MIG, "CASE WHEN can_create THEN 'OPERATOR' ELSE 'READER' END", "CASE WHEN can_create THEN 'READER' ELSE 'OPERATOR' END", TARGET, []),
 ('M5 drop owner backfill', MIG, "UPDATE managed_agent_session SET owner_actor_key = creator_actor_key;", "", TARGET, []),
 ('M6 creation writes owner NULL', STORE, "actorKey, actorKey);", "actorKey, null);", TARGET, []),
 ('M7 canRead narrowed to OPERATOR+', REG, "AND actor_id = ? AND role IN ('READER', 'OPERATOR',\"\n                + \" 'OWNER')\",\n                Integer.class", "AND actor_id = ? AND role IN ('OPERATOR',\"\n                + \" 'OWNER')\",\n                Integer.class", '*Test', []),
 ("M8 list filter as role >= 'READER' (collation trap)", STORE, "AND wa.role IN ('READER', 'OPERATOR', 'OWNER')))", "AND wa.role >= 'READER'))", '*Test', []),
 ('M9 cwd facts admit READER', STORE, "r.state = 'ACTIVE' AND a.role IN ('OPERATOR',\"\n                        + \" 'OWNER')\"", "r.state = 'ACTIVE' AND a.role IN ('READER', 'OPERATOR',\"\n                        + \" 'OWNER')\"", '*Test', []),
 ('M10 passive attachment admits READER', EXE, ".atLeast(WorkspaceAccess.OPERATOR)", ".atLeast(WorkspaceAccess.READER)", '*Test', []),
 ('M11 canCreateSession admits READER', REG, ".atLeast(WorkspaceAccess.OPERATOR)\n                        && \"ACTIVE\"", ".atLeast(WorkspaceAccess.READER)\n                        && \"ACTIVE\"", '*Test', []),
]
only=[a for a in sys.argv[1:] if not a.startswith('--')]
env=dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:'+os.environ['PATH'])
MVN='/Users/wenshao/Install/maven/bin/mvn'; REPO=f'-Dmaven.repo.local={R}/m2-mut'
out=open(f'{R}/out/mutation-r2.txt','a')
def w(s): out.write(s+'\n'); out.flush()
if '--install' in sys.argv:
    for mod,goal in (('qwencode','install'),('runtime-broker','install')):
        with open(f'{R}/out/mut2-install-{mod}.log','w') as L:
            rc=subprocess.run([MVN,'-B','-ntp','-q',REPO,'-DskipTests','-Dgpg.skip=true','-Dmaven.javadoc.skip=true','-Dcheckstyle.skip=true','-Dspotbugs.skip=true','clean',goal],cwd=f'{SJ}/{mod}',stdout=L,stderr=subprocess.STDOUT,env=env).returncode
        w(f'install {mod} rc={rc}')
def it(engine, tag):
    port,pw=(13544,'') if engine=='mysql' else (13545,open(f'{R}/mariadb.pw').read().strip())
    log=f'{R}/out/mut2-{tag}-it-{engine}.log'
    with open(log,'w') as L:
        rc=subprocess.run([MVN,'-B','-ntp',REPO,'-Dcheckstyle.skip=true','-Dspotbugs.skip=true','-Pmysql-integration','-Dtest=NoSuchUnitTest','-Dsurefire.failIfNoSpecifiedTests=false','-Dit.test=ManagedWorkspaceRolesMySqlIT','-Dfailsafe.failIfNoSpecifiedTests=false',
            f'-Dmysql.url=jdbc:mysql://127.0.0.1:{port}/managed_agent_mut?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false','-Dmysql.user=root',f'-Dmysql.password={pw}','clean','verify'],cwd=S,stdout=L,stderr=subprocess.STDOUT,env=env).returncode
    txt=open(log).read()
    tot=re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$',txt,re.M)
    why=[repr(x) for x in dict.fromkeys(re.findall(r'\[role (.{1,12}?) must be rejected\]',txt))]
    return rc, (tot[-1] if tot else None), why[:3]
if '--baseline' in sys.argv:
    for e in ENG:
        rc,tot,why=it(e,'M0p')
        w(f'M0p unmutated IT (rig-widened assertion) on {e}: rc={rc} totals={tot}')
for name,f,old,new,tests,engines in M:
    key=name.split()[0]
    if only and key not in only: continue
    src=open(f).read()
    if src.count(old)!=1:
        w(f'{name}: ANCHOR count={src.count(old)} SKIPPED'); continue
    open(f,'w').write(src.replace(old,new))
    try:
        t=time.time()
        log=f'{R}/out/mut2-{key}.log'
        with open(log,'w') as L:
            rc=subprocess.run([MVN,'-B','-ntp',REPO,'-Dcheckstyle.skip=true','-Dspotbugs.skip=true','-Dsurefire.failIfNoSpecifiedTests=false',f'-Dtest={tests}','clean','test'],cwd=S,stdout=L,stderr=subprocess.STDOUT,env=env).returncode
        txt=open(log).read()
        tot=re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$',txt,re.M)
        failing=sorted(set(re.findall(r'\[ERROR\]\s+(\w+)\.(\w+)',txt)))
        verdict='KILLED' if rc!=0 and failing else ('SURVIVED' if rc==0 else 'BUILD-ERROR')
        w(f'{name}: H2 {verdict} tests={tests} totals={tot[-1] if tot else None} killers={[a+"."+b for a,b in failing][:6]} {int(time.time()-t)}s')
        for e in engines:
            t=time.time()
            rc,tot,why=it(e,key)
            w(f'{name}: IT[{e}] {"KILLED" if rc!=0 else "SURVIVED"} totals={tot} first-unrejected={why} {int(time.time()-t)}s')
    finally:
        subprocess.run(['git','checkout','--',f],cwd=W)
w('MUTATE2-DONE')
