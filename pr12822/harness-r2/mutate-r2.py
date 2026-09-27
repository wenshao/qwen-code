#!/usr/bin/env python3
"""Mutation pass over the PR's new managed-agent-server code.

Each mutant is a single literal replacement (asserted to match exactly once),
followed by the module's full `mvn test` (102 tests). The file is restored with
`git checkout HEAD -- <file>` after every run; the worktree is clean at the PR
head beforehand.
"""
import json
import os
import re
import subprocess
import sys
import time

SP = '$SCRATCH'
WT = f'{SP}/wt-pr'
MOD = f'{WT}/packages/sdk-java/managed-agent-server'
SRC = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/'
MVN = ['mvn', '--batch-mode', '--no-transfer-progress', '-s', f'{SP}/m2settings.xml',
       f'-Dmaven.repo.local={SP}/m2repo', '-Dcheckstyle.skip', 'test']
ENV = dict(os.environ, JAVA_HOME=os.path.expanduser('~/Install/jdk21'),
           PATH=os.path.expanduser('~/Install/jdk21/bin') + ':' + os.path.expanduser('~/Install/maven/bin') + ':' + os.environ['PATH'])

MUTANTS = [
    ('M1', 'Drop the preset JSON content type on error responses', 'api/ApiExceptionHandler.java',
     """        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(envelope(request, code, message));""",
     """        return ResponseEntity.status(status)
                .body(envelope(request, code, message));"""),
    ('M2', 'Accept any header value as the request id (no SAFE pattern)', 'api/RequestIdFilter.java',
     'Pattern.compile("[\\\\x21-\\\\x7E]{1,128}")', 'Pattern.compile("(?s).{1,128}")'),
    ('M3', 'Echo any body requestId (skip the SAFE check)', 'api/RequestIdFilter.java',
     'if (requestId != null && SAFE.matcher(requestId).matches()) {', 'if (requestId != null) {'),
    ('M4', 'Stop echoing the body requestId', 'api/RequestIdFilter.java',
     """        if (requestId != null && SAFE.matcher(requestId).matches()) {
            use(request, response, requestId);
        }""", """        if (requestId != null && SAFE.matcher(requestId).matches()) {
        }"""),
    ('M6', 'Store the literal "1" instead of the configured revision', 'store/ManagedAgentStore.java',
     'tenantId, sessionId, agentId, agentRevision, title, now, now,',
     'tenantId, sessionId, agentId, "1", title, now, now,'),
    ('M8', 'snapshot_through_sequence = last sequence', 'service/ManagedAgentService.java',
     """                store.findSnapshotCoveredSequence(session.tenantId(),
                        session.sessionId()),""",
     """                session.lastSequence(),"""),
    ('M9', 'snapshot_through_sequence always 0', 'store/ManagedAgentStore.java',
     'return rows.isEmpty() ? 0 : rows.getFirst();', 'return 0;'),
    ('M10', 'Report items capability as false', 'service/ManagedAgentService.java',
     'new SessionCapabilities(true, false, false, false);', 'new SessionCapabilities(false, false, false, false);'),
    ('M11', 'Report resync capability as true', 'service/ManagedAgentService.java',
     'new SessionCapabilities(true, false, false, false);', 'new SessionCapabilities(true, false, false, true);'),
    ('M12', 'replay_floor_sequence = 1', 'service/ManagedAgentService.java',
     'session.lastSequence(), 0,', 'session.lastSequence(), 1,'),
    ('M13', 'input_item_id no longer matches the materialized Item id', 'service/ManagedAgentService.java',
     'turn.sessionId(), StoreModels.inputItemId(turn.turnId()),', 'turn.sessionId(), "item_" + turn.turnId(),'),
    ('M14', 'Put nothing in the log MDC', 'api/RequestIdFilter.java',
     '        MDC.put(MDC_KEY, requestId);\n', ''),
    ('M15', 'Run the request-id filter after tenant resolution', 'api/RequestIdFilter.java',
     '@Order(Ordered.HIGHEST_PRECEDENCE)', '@Order(Ordered.LOWEST_PRECEDENCE)'),
    ('M16', 'Reject the legacy "text" spelling', 'service/ManagedAgentService.java',
     'Set.of("input_text",\n            "text");', 'Set.of("input_text");'),
    ('M17', 'Drop X-Request-Id from successful responses', 'api/RequestIdFilter.java',
     '        response.setHeader(HEADER, requestId);\n', ''),
    ('M5', 'Remove the agent_revision check (store, new admissions)', 'store/ManagedAgentStore.java',
     'if (requested != null && !requested.equals(agentRevision)) {', 'if (false) {'),
    ('M18', 'Check the revision before the Workspace replay lookup', 'store/ManagedAgentStore.java',
     """        List<WorkspaceCommand> existing = findWorkspaceCommand(tenantId,
                actorId, idempotencyKey);
        if (!existing.isEmpty()) {""",
     """        requireAgentRevision(requestedRevision);
        List<WorkspaceCommand> existing = findWorkspaceCommand(tenantId,
                actorId, idempotencyKey);
        if (!existing.isEmpty()) {"""),
    ('M19', 'Skip the replay lookup before insert (plain create)', 'service/ManagedAgentService.java',
     """        Admission replay = replay(tenantId, CREATE, idempotencyKey,
                requestDigest);""", """        Admission replay = null;"""),
    ('M20', 'Leave agent_revision out of the digest (plain create)', 'service/ManagedAgentService.java',
     """        if (agentRevision != null) {
            semantic.put("agentRevision", agentRevision);
        }
        semantic.put("title", effectiveTitle);
        semantic.put("input", input);
        String requestDigest = digests.digest(semantic);
        Admission replay""", """        semantic.put("title", effectiveTitle);
        semantic.put("input", input);
        String requestDigest = digests.digest(semantic);
        Admission replay"""),
    ('M21', 'Leave agent_revision out of the digest (Workspace create)', 'service/ManagedAgentService.java',
     """        if (agentRevision != null) {
            semantic.put("agentRevision", agentRevision);
        }
        semantic.put("title", effectiveTitle);
        semantic.put("input", input);
        semantic.put("workspace", selection == null""", """        semantic.put("title", effectiveTitle);
        semantic.put("input", input);
        semantic.put("workspace", selection == null"""),
    ('M22', 'Drop the 406 handler (back to the catch-all 500)', 'api/ApiExceptionHandler.java',
     '    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)\n', ''),
    ('M23', 'Drop the committed-response guard', 'api/ApiExceptionHandler.java',
     'if (response.isCommitted()) {', 'if (false) {'),
]


def run(mid):
    t0 = time.time()
    p = subprocess.run(MVN, cwd=MOD, env=ENV, capture_output=True, text=True)
    log = f'{SP}/r2/logs/mut-{mid}.log'
    open(log, 'w').write(p.stdout + p.stderr)
    summary = [l for l in p.stdout.splitlines() if re.search(r'Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$', l)]
    failing = sorted(set(re.findall(r'\[ERROR\]\s+([\w.]+Test\.\w+)', p.stdout)))
    compile_error = 'COMPILATION ERROR' in p.stdout
    return {'rc': p.returncode, 'summary': summary[-1] if summary else None, 'failing': failing[:8],
            'compileError': compile_error, 'secs': round(time.time() - t0)}


def main():
    only = set(sys.argv[1:])
    results = []
    for mid, what, rel, old, new in MUTANTS:
        if only and mid not in only:
            continue
        path = f'{WT}/{SRC}{rel}'
        text = open(path).read()
        n = text.count(old)
        if n != 1:
            print(f'{mid}: anchor matched {n} times, skipped', flush=True)
            results.append({'id': mid, 'what': what, 'error': f'anchor x{n}'})
            continue
        open(path, 'w').write(text.replace(old, new))
        try:
            r = run(mid)
        finally:
            subprocess.run(['git', 'checkout', 'HEAD', '--', f'{SRC}{rel}'], cwd=WT, check=True)
        verdict = 'COMPILE-ERROR' if r['compileError'] else ('killed' if r['rc'] != 0 else 'SURVIVED')
        results.append({'id': mid, 'what': what, 'verdict': verdict, **r})
        print(f"{mid:4} {verdict:13} {what}  [{r['summary']}] {' '.join(r['failing'][:3])}", flush=True)
    clean = subprocess.run(['git', 'status', '--short'], cwd=WT, capture_output=True, text=True).stdout
    print('worktree clean after run:', clean.strip() == '', flush=True)
    json.dump(results, open(f'{SP}/r2/out/mutation-java.json', 'w'), indent=1)


main()
