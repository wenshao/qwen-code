import subprocess, sys, shutil, os, json
PR='/root/git/_v10300/pr'
SS=f'{PR}/packages/core/src/services/sessionService.ts'
WL=f'{PR}/packages/core/src/services/session-writer-lease.ts'

MUTS = {
 'M1 moveLedgerSidecar reverts to a direction-blind append (the R9-1 regression)': (SS,
"""      if (action === 'archive') {
        assertCanCommit?.();
        fs.appendFileSync(destinationPath, `\\n${payload}`, 'utf8');
      } else {
        const destinationContents = fs.readFileSync(destinationPath, 'utf8');
        atomicWriteFileSync(
          destinationPath,
          `${payload}${destinationContents.length > 0 ? '\\n' : ''}${destinationContents}`,
          { encoding: 'utf8', assertCanCommit },
        );
      }""",
"""      assertCanCommit?.();
      fs.appendFileSync(destinationPath, `\\n${payload}`, 'utf8');"""),

 'M2 the unarchive merge drops its assertCanCommit fence': (SS,
"""          { encoding: 'utf8', assertCanCommit },""",
"""          { encoding: 'utf8' },"""),

 'M3 the ledger source unlink drops its ownership fence': (SS,
"""    assertCanCommit?.();
    fs.unlinkSync(sourcePath);""",
"""    fs.unlinkSync(sourcePath);"""),

 'M4 assertCleanupOwned skips the dev/ino comparison': (WL,
"""    const current = this.readVerifiedLockIdentity();
    if (current.dev !== expected.dev || current.ino !== expected.ino) {
      throw new SessionWriterLostError();
    }""",
"""    this.readVerifiedLockIdentity();"""),

 'M5 readVerifiedLockIdentity ignores an in-place lock-record rewrite': (WL,
"""        record.owner_id !== this.ownerId ||
        raw !== this.lockRecordRaw""",
"""        record.owner_id !== this.ownerId"""),
}

CORE_TESTS = ['src/services/sessionService.test.ts','src/services/sessionService.corruption.test.ts','src/services/session-writer-lease.test.ts']
CLI_TESTS  = ['src/serve/server/session-archive.test.ts','src/serve/conversations/standalone-session-service.test.ts']
# the single pre-existing root-uid failure is excluded from the verdict
BASELINE_FAIL = 'classifies an unreadable owned lock as unavailable'

def run(pkg, tests):
    r = subprocess.run(['npx','vitest','run','--root',f'packages/{pkg}',*tests,'--reporter=basic'],
                       cwd=PR, capture_output=True, text=True, timeout=1800)
    out = r.stdout + r.stderr
    fails = [l.strip() for l in out.splitlines() if l.strip().startswith('×')]
    return [f for f in fails if BASELINE_FAIL not in f]

results = {}
for name,(path,old,new) in MUTS.items():
    src = open(path).read()
    if old not in src:
        results[name] = {'status':'ANCHOR MISSING'}; continue
    shutil.copy(path, path+'.bak')
    open(path,'w').write(src.replace(old,new,1))
    try:
        fails = run('core', CORE_TESTS) + run('cli', CLI_TESTS)
    finally:
        shutil.move(path+'.bak', path)
    results[name] = {'status':'killed' if fails else 'SURVIVED', 'failing': fails[:4], 'count': len(fails)}
    print(json.dumps({name:results[name]}), flush=True)
json.dump(results, open('/root/git/_v10300/h/mutations.json','w'), indent=1)
