#!/usr/bin/env python3
"""PR #13355 arm driver: revert arms, base-with-PR-tests arm, and a per-arm
mutation matrix of the new commit-time validator. Each arm is a copy of
managed-agent-server (plus the shared contract fixtures, which the Java
contract tests find by walking up), patched by exact-string replacement that
must match exactly once, then run offline against the store test classes."""
import concurrent.futures as cf
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = '/root/verify/pr13355'
ARMS = f'{ROOT}/arms'
HEAD = f'{ROOT}/head'
BASE = f'{ROOT}/base'
MOD = 'packages/sdk-java/managed-agent-server'
PKG = 'src/main/java/com/alibaba/qwen/code/managedagent/store'
TPKG = 'src/test/java/com/alibaba/qwen/code/managedagent'
STORE = f'{PKG}/ManagedExtensionRecordStore.java'
PROJ = f'{PKG}/ManagedExtensionProjection.java'
AGENT = f'{PKG}/ManagedAgentStore.java'
TESTS = ','.join([
    'ManagedExtensionRecordStoreTest', 'ManagedExtensionProjectionContractTest',
    'ManagedSessionStoreContractFixtureTest', 'ManagedActionsTest',
    'ToolPublicationStoreTest', 'ManagedSessionStoreIntegrationTest',
    'ManagedAgentApiContractTest', 'ManagedHookAdmissionIndexTest',
])
ENV = dict(os.environ, JAVA_HOME='/root/Install/jdk21',
           PATH='/root/Install/jdk21/bin:/root/Install/maven/bin:' + os.environ['PATH'])


def make(name, src):
    dest = f'{ARMS}/{name}'
    if os.path.exists(dest):
        shutil.rmtree(dest)
    os.makedirs(f'{dest}/packages/sdk-java')
    os.makedirs(f'{dest}/packages/core/src/managed-runtime')
    shutil.copytree(f'{src}/{MOD}', f'{dest}/{MOD}',
                    ignore=shutil.ignore_patterns('target'))
    shutil.copytree(f'{src}/packages/core/src/managed-runtime/contracts',
                    f'{dest}/packages/core/src/managed-runtime/contracts')
    return dest


def patch(dest, rel, old, new):
    path = f'{dest}/{MOD}/{rel}'
    text = open(path).read()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{dest}: pattern matched {count}x in {rel}: {old[:80]!r}')
    open(path, 'w').write(text.replace(old, new))


def run(dest):
    log = f'{dest}/mvn.log'
    cmd = ['mvn', '-o', '-B', '-q', '--no-transfer-progress',
           f'-Dmaven.repo.local={ROOT}/m2/repository', '-Djacoco.skip=true',
           '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true',
           '-Dsurefire.failIfNoSpecifiedTests=false', f'-Dtest={TESTS}', 'test']
    with open(log, 'w') as out:
        code = subprocess.call(cmd, cwd=f'{dest}/{MOD}', stdout=out,
                               stderr=subprocess.STDOUT, env=ENV)
    failed, total = [], 0
    for report in glob.glob(f'{dest}/{MOD}/target/surefire-reports/TEST-*.xml'):
        for case in ET.parse(report).getroot().iter('testcase'):
            total += 1
            if case.find('failure') is not None or case.find('error') is not None:
                node = case.find('failure') if case.find('failure') is not None else case.find('error')
                msg = (node.get('message') or '').replace('\n', ' ')[:220]
                failed.append(f"{case.get('classname').split('.')[-1]}.{case.get('name')} :: {msg}")
    compiled = total > 0
    return {'exit': code, 'total': total, 'failed': sorted(failed),
            'compileError': not compiled and 'COMPILATION ERROR' in open(log).read()}


# ---------------------------------------------------------------- arms
def arm_control():
    return make('control', HEAD)


def arm_revert_r1():
    d = make('revert-r1', HEAD)
    patch(d, PROJ, '''            case SETTLED -> "not_started".equals(executionStatus)
                    || "cancelled".equals(executionStatus)
                            && dispatchGeneration == 0
                    ? "not_started_proven" : "settled";''',
          '''            case SETTLED -> "not_started".equals(executionStatus)
                    ? "not_started_proven" : "settled";''')
    return d


def arm_revert_r2():
    """Base's apply() validation, with head's announce (outbox) kept."""
    d = make('revert-r2', HEAD)
    base_store = open(f'{BASE}/{MOD}/{STORE}').read()
    base_store = base_store.replace(
        '''        sessions.appendLiveSessionEventIfAbsent(tenantId, sessionId,
                "task.updated", Map.of("taskId", taskId, "state", state),
                "task:" + taskId + ":" + revision);''',
        '''        sessions.appendLiveSessionTaskEvent(tenantId, sessionId, taskId,
                state, revision, "task:" + taskId + ":" + revision);''')
    assert 'appendLiveSessionTaskEvent' in base_store
    open(f'{d}/{MOD}/{STORE}', 'w').write(base_store)
    return d


def arm_revert_r3():
    """Head, but the task announcement rides the Session event stream again."""
    d = make('revert-r3', HEAD)
    patch(d, AGENT, '''        // The lock above serializes the writers of this outbox, so the next
        // sequence is the one after the highest committed.
        Long current = jdbc.queryForObject("SELECT MAX(sequence_id) FROM"
                        + " managed_agent_task_event WHERE tenant_id = ?"
                        + " AND session_id = ?",
                Long.class, tenantId, sessionId);
        jdbc.update("INSERT INTO managed_agent_task_event"
                        + " (tenant_id, session_id, sequence_id, task_id,"
                        + " task_state, revision, source_key, created_at)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                tenantId, sessionId, (current == null ? 0 : current) + 1,
                taskId, state, revision, sourceKey, clock.millis());''',
          '''        if (!hasSourceEvent(tenantId, sessionId, sourceKey)) {
            appendEvent(tenantId, sessionId, null, "task.updated",
                    Map.of("taskId", taskId, "state", state), false,
                    sourceKey, clock.millis());
        }''')
    return d


def arm_base_prtests():
    """Base production code running the PR's new witness tests."""
    d = make('base-prtests', BASE)
    for name in ['ManagedExtensionRecordStoreTest.java', 'ExtensionRecordJournal.java',
                 'ActionJournal.java', 'ManagedExtensionProjectionContractTest.java']:
        shutil.copy(f'{HEAD}/{MOD}/{TPKG}/{name}', f'{d}/{MOD}/{TPKG}/{name}')
    for name in ['managed-extension-projection-v1.fixtures.json']:
        shutil.copy(f'{HEAD}/packages/core/src/managed-runtime/contracts/{name}',
                    f'{d}/packages/core/src/managed-runtime/contracts/{name}')
    # Base's executionOf takes two arguments; keep the PR's fixture rows.
    path = f'{d}/{MOD}/{TPKG}/ManagedExtensionProjectionContractTest.java'
    text = open(path).read()
    new = text.replace('''status.isNull() ? null : status.textValue(),
                            fixture.required("dispatchGeneration")
                                    .longValue()),''', '''status.isNull() ? null : status.textValue()),''')
    if new == text:
        raise SystemExit('base-prtests: executionOf call not adapted')
    open(path, 'w').write(new)
    return d


# ------------------------------------------------------------ mutants
NOOP = '{}'
MUTANTS = {
    'M01-unknown-subtype-after-header': (STORE,
        'require(!managed, "Record line "', 'require(true, "Record line "'),
    'M02-commit-marker-cap': (STORE,
        '''                                ? ManagedSessionStoreModels
                                        .MAX_COMMIT_MARKER_BYTES''',
        '''                                ? Integer.MAX_VALUE'''),
    'M03-foreign-line-cap': (STORE,
        '''                                : ManagedSessionStoreModels.MAX_EVENT_BYTES);''',
        '''                                : Integer.MAX_VALUE);'''),
    'M04-event-line-cap': (STORE,
        '''            managed = true;
            requireLineBytes(lines[index], index,
                    ManagedSessionStoreModels.MAX_EVENT_BYTES);''',
        '''            managed = true;'''),
    'M05-event-within-eventCount': (STORE,
        'require(index < eventCount, "The event of record line "',
        'require(true, "The event of record line "'),
    'M06-closed-envelope': (STORE,
        '''        require(closed, "event must be an object with exactly "''',
        '''        require(event != null && event.isObject(), "event must be an object with exactly "'''),
    'M07-event-v': (STORE,
        '''            ManagedExtensionRecords.count(event.get("v"), 1, 1, "event.v");''', ''),
    'M08-event-sequence': (STORE,
        '''            ManagedExtensionRecords.count(event.get("sequence"), sequence,
                    sequence, "event.sequence");''', ''),
    'M09-event-id-shape': (STORE,
        '''            ManagedExtensionRecords.id(event.get("eventId"), "event.eventId");''', ''),
    'M10-occurredAt': (STORE,
        '''            occurredAt = ManagedExtensionRecords.count(event.get(
                    "occurredAt"), 0, ManagedExtensionRecords.MAX_TIME,
                    "event.occurredAt");''',
        '''            occurredAt = event.path("occurredAt").asLong();'''),
    'M11-sessionKey-closed': (STORE,
        '''            ManagedExtensionRecords.closed(event.get("sessionKey"),
                    SESSION_KEY_FIELDS, "event.sessionKey");''', ''),
    'M12-kind-vocabulary': (STORE,
        '''            ManagedExtensionRecords.oneOf(event.get("kind"),
                    ManagedExtensionRecords.EVENT_KINDS, "event.kind");''', ''),
    'M13-same-session': (STORE,
        '''        require(tenantId.equals(key.get("tenantId").textValue())''',
        '''        require(true || tenantId.equals(key.get("tenantId").textValue())'''),
    'M14-reserved-event-id': (STORE,
        '''                require(!RESERVED_EVENT_ID.matcher(eventId).matches(),''',
        '''                require(true || !RESERVED_EVENT_ID.matcher(eventId).matches(),'''),
    'M15-payload-closed': (STORE,
        '''            ManagedExtensionRecords.closed(payload, PAYLOAD_FIELDS,
                    "event.payload");''', ''),
    'M16-domain-index': (STORE,
        '''            ManagedExtensionRecords.oneOf(payload.get("domain"),
                    ManagedExtensionRecords.DOMAINS, "event.payload.domain");''', ''),
    'M17-payload-version': (STORE,
        '''            ManagedExtensionRecords.count(payload.get("version"), 1, 1,
                    "event.payload.version");''', ''),
    'M18-operation-id': (STORE,
        '''            ManagedExtensionRecords.id(payload.get("operationId"),
                    "event.payload.operationId");''', ''),
    'M19-durable-ref': (STORE,
        '''            ManagedExtensionRecords.durableRef(payload.get("recordRef"),
                    "event.payload.recordRef");''', ''),
    'M20-ref-names-domain': (STORE,
        '''        require(("managed-" + domain).equals(recordRef.get("kind")''',
        '''        require(true || ("managed-" + domain).equals(recordRef.get("kind")'''),
    'M21-one-stage-h-record': (STORE,
        '''                require(applied == 0, "A transaction carries at most one"''',
        '''                require(true, "A transaction carries at most one"'''),
    'M22-stage-h-subject': (STORE,
        '''                    sessionId, firstSequence + index, body == null);''',
        '''                    sessionId, firstSequence + index, true);'''),
    'M23-generation-arm': (PROJ,
        '''                    || "cancelled".equals(executionStatus)
                            && dispatchGeneration == 0''',
        '''                    || "cancelled".equals(executionStatus)
                            && dispatchGeneration >= 0'''),
}


def arm_mutant(name):
    rel, old, new = MUTANTS[name]
    d = make(name, HEAD)
    patch(d, rel, old, new)
    return d


def main():
    which = sys.argv[1:] or ['all']
    builders = {
        'control': arm_control, 'revert-r1': arm_revert_r1,
        'revert-r2': arm_revert_r2, 'revert-r3': arm_revert_r3,
        'base-prtests': arm_base_prtests,
    }
    for m in MUTANTS:
        builders[m] = (lambda m=m: arm_mutant(m))
    names = list(builders) if which == ['all'] else which
    dests = {n: builders[n]() for n in names}
    results = {}
    with cf.ThreadPoolExecutor(max_workers=int(os.environ.get('JOBS', '6'))) as pool:
        futures = {pool.submit(run, d): n for n, d in dests.items()}
        for future in cf.as_completed(futures):
            n = futures[future]
            results[n] = future.result()
            r = results[n]
            print(f"{n:34} exit={r['exit']} tests={r['total']} failed={len(r['failed'])}"
                  f"{' COMPILE-ERROR' if r['compileError'] else ''}", flush=True)
    tag = os.environ.get('TAG') or ('all' if which == ['all'] else '-'.join(which))[:80]
    out = f'{ARMS}/results-{tag}.json'
    json.dump(results, open(out, 'w'), indent=2, sort_keys=True)
    print('wrote', out)


if __name__ == '__main__':
    main()
