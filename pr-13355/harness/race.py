import sys, subprocess, os, shutil
sys.path.insert(0, '/root/verify/pr13355/arms')
import driver
arms = {'race': None, 'race-nolock': ('''                        + " session_id = ? FOR UPDATE",
                sessionMapper, tenantId, tenantId, sessionId).stream()
                .findFirst();
        if (session.isEmpty() || "DELETING".equals(session.get().status())
                || "DELETED".equals(session.get().status())) {
            return;
        }
        // The lock above''', '''                        + " session_id = ?",
                sessionMapper, tenantId, tenantId, sessionId).stream()
                .findFirst();
        if (session.isEmpty() || "DELETING".equals(session.get().status())
                || "DELETED".equals(session.get().status())) {
            return;
        }
        // The lock above''')}
for name, mut in arms.items():
    d = driver.make(name, driver.HEAD)
    if mut:
        driver.patch(d, driver.AGENT, *mut)
    shutil.copy('RaceProbe.java.txt', f'{d}/{driver.MOD}/{driver.TPKG}/Pr13355OutboxRaceProbeTest.java')
procs = {}
for name in arms:
    d = f'/root/verify/pr13355/arms/{name}'
    out = f'/root/verify/pr13355/arms/race-{name}.json'
    url = f'jdbc:mysql://127.0.0.1:33356/race_{name.replace("-", "_")}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false'
    cmd = ['mvn', '-o', '-B', '-q', '-Dmaven.repo.local=/root/verify/pr13355/m2/repository',
           '-Djacoco.skip=true', '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true',
           '-Dtest=Pr13355OutboxRaceProbeTest',
           f'-DargLine=-Dprobe.out={out} -Dmysql.url={url} -Dmysql.user=root -Dmysql.password=runtime-broker',
           'test']
    procs[name] = subprocess.Popen(cmd, cwd=f'{d}/{driver.MOD}', env=driver.ENV,
                                   stdout=open(f'{d}/race.log', 'w'), stderr=subprocess.STDOUT)
for name, p in procs.items():
    print(name, 'exit', p.wait())
    out = f'/root/verify/pr13355/arms/race-{name}.json'
    print(open(out).read() if os.path.exists(out) else open(f'/root/verify/pr13355/arms/{name}/race.log').read()[-3000:])
