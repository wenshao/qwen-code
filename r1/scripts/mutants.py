#!/usr/bin/env python3
"""Guard-deletion mutants for the JDBC repositories. Each mutant is an exact-string replacement (nth occurrence)."""
import os, shutil, subprocess, sys, json, concurrent.futures as cf
H='/root/verify/pr12390-harness'
SRC='/root/verify/pr12390/packages/sdk-java/runtime-broker'
PKG='src/main/java/com/alibaba/qwen/code/runtimebroker/'
B=PKG+'JdbcRuntimeBindingRepository.java'; S=PKG+'JdbcRuntimeSessionRepository.java'; U=PKG+'JdbcRepositorySupport.java'
M=[
 ('M01',B,'findOrCreate: generation always 1', 'long generation = slot.lastGeneration + 1;','long generation = 1;',1),
 ('M02',B,'findOrCreate: slot never records the active binding','statement.setString(2, bindingId);','statement.setString(2, null);',1),
 ('M03',B,'binding CAS: version fence removed','                    || current.getVersion() != expected.getVersion()\n','',1),
 ('M04',B,'binding CAS: sameOperation fence removed','                    || !current.sameOperation(expected)\n','',1),
 ('M05',B,'binding CAS: live-lease requirement removed','                    || !current.hasLiveOperationAt(now)) {','                    ) {',1),
 ('M06',B,'binding CAS: terminal reactivation allowed','if (!current.isActive() && replacement.isActive()) {\n                throw new IllegalArgumentException(\n                        "terminal binding','if (false) {\n                throw new IllegalArgumentException(\n                        "terminal binding',1),
 ('M07',B,'binding CAS: version not bumped','RuntimeBindingRecord updated = replacement.withVersion(\n                    expected.getVersion() + 1);','RuntimeBindingRecord updated = replacement.withVersion(\n                    expected.getVersion());',1),
 ('M08',B,'binding CAS: slot not released on terminal state','if (current.isActive() && !updated.isActive()) {','if (false) {',1),
 ('M09',B,'claim: terminal binding can be claimed','if (current == null || !current.isActive()) {','if (current == null) {',1),
 ('M10',B,'claim: same-owner fast path removed (re-claim bumps)','if (ownerId.equals(current.getOperationOwner())\n                    && current.getOperationLeaseUntil().isAfter(now)) {\n                return current;','if (false) {\n                return current;',1),
 ('M11',B,'claim: foreign live lease NOT fenced','if (current.getOperationOwner() != null\n                    && current.getOperationLeaseUntil().isAfter(now)) {\n                return null;','if (false) {\n                return null;',1),
 ('M12',B,'claim: takeover keeps operationGeneration','current.getOperationGeneration() + 1)','Math.max(1, current.getOperationGeneration()))',1),
 ('M13',B,'claim: version not bumped','current.getOperationGeneration() + 1)\n                    .withVersion(current.getVersion() + 1);','current.getOperationGeneration() + 1)\n                    .withVersion(current.getVersion());',1),
 ('M14',B,'renew: owner check removed','if (!ownerId.equals(current.getOperationOwner())\n                    || operationGeneration','if (current.getOperationOwner() == null\n                    || operationGeneration',1),
 ('M15',B,'renew: operationGeneration check removed','                    || operationGeneration\n                            != current.getOperationGeneration()\n','',1),
 ('M16',B,'renew: expired lease can be renewed','                    || !current.getOperationLeaseUntil().isAfter(now)) {\n                return null;\n            }\n            RuntimeBindingRecord renewed','                    ) {\n                return null;\n            }\n            RuntimeBindingRecord renewed',1),
 ('M17',B,'renew: terminal binding can be renewed','if (current == null || !current.isActive()) {','if (current == null) {',2),
 ('M18',B,'findActiveByIsolationKey: terminal bindings included','+ "AND binding_state NOT IN (\'FAILED\', \'RELEASED\')";','+ "";',1),
 ('M19',B,'renew: version not bumped','now.plus(duration), operationGeneration)\n                    .withVersion(current.getVersion() + 1);','now.plus(duration), operationGeneration)\n                    .withVersion(current.getVersion());',1),
 ('M20',B,'binding CAS: identity fence removed','if (current == null || !current.sameIdentity(expected)\n                    || current.getVersion()','if (current == null\n                    || current.getVersion()',1),
 ('M21',B,'binding CAS: replacement may change version','                || replacement.getVersion() != expected.getVersion()) {\n            throw new IllegalArgumentException(\n                    "replacement must preserve binding','                ) {\n            throw new IllegalArgumentException(\n                    "replacement must preserve binding',1),
 ('M22',U,'lease duration not truncated to micros','Duration normalized = duration.truncatedTo(ChronoUnit.MICROS);','Duration normalized = duration;',1),
 ('M23',U,'transaction: no rollback on SQLException','            } catch (SQLException exception) {\n                rollback(connection, exception);\n                throw failure(exception);','            } catch (SQLException exception) {\n                throw failure(exception);',1),
 ('M24',U,'transaction: no rollback on RuntimeException','            } catch (RuntimeException exception) {\n                rollback(connection, exception);','            } catch (RuntimeException exception) {',1),
 ('M25',U,'transaction: explicit commit() removed','                connection.commit();\n','',1),
 ('M26',U,'isConstraintViolation always false','if (state != null && state.startsWith("23")) {','if (false) {',1),
 ('M27',S,'session findOrCreate: existing identity not checked','return requireSameIdentity(existing, candidate);','return existing;',1),
 ('M28',S,'session findOrCreate: race winner identity not checked','return requireSameIdentity(winner, candidate);','return winner;',1),
 ('M29',S,'session CAS: version fence removed','            if (current == null || !current.sameIdentity(expected)\n                    || current.getVersion() != expected.getVersion()) {','            if (current == null || !current.sameIdentity(expected)) {',1),
 ('M30',S,'session CAS: terminal reactivation allowed','if (!current.isActive() && replacement.isActive()) {','if (false) {',1),
 ('M31',S,'session CAS: version not bumped','RuntimeSessionRecord updated = replacement.withVersion(\n                    expected.getVersion() + 1);','RuntimeSessionRecord updated = replacement.withVersion(\n                    expected.getVersion());',1),
 ('M32',S,'countActive: terminal sessions counted','+ "AND session_state NOT IN (\'RELEASED\', \'FAILED\')";','+ "";',1),
 ('M33',S,'countActive: generation filter widened (>=)','"WHERE binding_id = ? AND runtime_generation = ? "','"WHERE binding_id = ? AND runtime_generation >= ? "',1),
 ('M34',S,'session candidate: version!=0 accepted','if (candidate == null || candidate.getVersion() != 0','if (candidate == null || false',1),
 ('M35',S,'session candidate: non-ACQUIRING accepted','                || candidate.getState()\n                        != RuntimeSessionRecord.State.ACQUIRING) {','                ) {',1),
 ('M36',S,'session CAS: identity fence removed','            if (current == null || !current.sameIdentity(expected)\n                    || current.getVersion()','            if (current == null\n                    || current.getVersion()',1),
 ('M37',S,'session lookup ignores tenant scope in SQL','" FROM qwen_runtime_session WHERE scope_key = ? "','" FROM qwen_runtime_session WHERE (scope_key = ? OR 1 = 1) "',1),
 ('M38',B,'binding CAS: stale slot pointer check removed','if (current.isActive()\n                    && !current.getBindingId().equals(\n                            slot.activeBindingId)) {','if (false) {',1),
]
def nth_replace(s, old, new, n):
    idx=-1
    for _ in range(n):
        idx=s.find(old, idx+1)
        if idx<0: raise SystemExit('pattern not found: '+old[:60])
    return s[:idx]+new+s[idx+len(old):]
def prepare(m):
    mid,f,desc,old,new,n=m
    d=f'{H}/mut/{mid}'
    shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(SRC, d, ignore=shutil.ignore_patterns('target'))
    p=os.path.join(d,f); s=open(p).read(); open(p,'w').write(nth_replace(s,old,new,n))
    return d
def run(m):
    d=prepare(m)
    env=dict(os.environ, JAVA_TOOL_OPTIONS='')
    r=subprocess.run(['mvn','-o','-q','--batch-mode','-Djacoco.skip=true','test'],cwd=d,env=env,capture_output=True,text=True)
    out=r.stdout+r.stderr
    if 'COMPILATION ERROR' in out: verdict='COMPILE-ERROR'
    elif r.returncode==0: verdict='SURVIVED'
    else: verdict='killed'
    open(d+'/mvn.log','w').write(out)
    return m[0],m[2],verdict
if __name__=='__main__':
    res=[]
    with cf.ThreadPoolExecutor(6) as ex:
        for r in ex.map(run,M): res.append(r); print(*r,sep=' | ',flush=True)
    json.dump(res,open(f'{H}/logs/g5-mutants-pr-suite.json','w'),indent=1)
    k=sum(1 for r in res if r[2]=='killed'); print(f'PR suite kills {k}/{len(res)}')
