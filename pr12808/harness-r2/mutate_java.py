#!/usr/bin/env python3
"""Java mutation matrix for PR 12808. Each mutant is applied to a clean tree,
then ManagedAgentApiContractTest (new) and ManagedAgentServerIntegrationTest
(pre-existing) run; the verdict and the drift lines are recorded."""
import json, os, re, subprocess, sys

WT = os.path.expanduser('~/git/pr12808-mut')
MOD = f'{WT}/packages/sdk-java/managed-agent-server'
S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4e2fef2a-1851-4d5c-9a46-2dd6291c0a8f/scratchpad/r2'
MVN = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4e2fef2a-1851-4d5c-9a46-2dd6291c0a8f/scratchpad/mvn21'
J = 'src/main/java/com/alibaba/qwen/code/managedagent'
GAPS = 'src/test/resources/openapi/contract-known-gaps.txt'

MUTANTS = [
  ('M1', 'extra property on WebShellSession record', f'{J}/api/ApiModels.java',
   '            WebShellTurn activeTurn, Object environment, long lastSequence,\n            WebShellWorkspace workspace) {\n    }',
   '            WebShellTurn activeTurn, Object environment, long lastSequence,\n            WebShellWorkspace workspace) {\n        @JsonProperty("debugNote")\n        public String debugNote() {\n            return "x";\n        }\n    }', 1),
  ('M2', 'new mapped route GET /v1/agents/sessions/{id}/debug', f'{J}/api/PublicAgentController.java',
   '    @GetMapping("/{sessionId}")\n',
   '    @GetMapping("/{sessionId}/debug")\n    public String debug(@PathVariable String sessionId) {\n        return sessionId;\n    }\n\n    @GetMapping("/{sessionId}")\n', 1),
  ('M3', 'known-gap line deleted (archive 202 vs 200)', GAPS,
   'response archiveSession: expected 202, got 200\n', '', 1),
  ('M4', 'stale known-gap line added', GAPS,
   'response deleteSession: expected 202, got 200\n',
   'response deleteSession: expected 202, got 200\nresponse getSession 200: / required foo\n', 1),
  ('M5', 'createSession answers 200 instead of 202', f'{J}/api/PublicAgentController.java',
   '                tenant.actorId(), admission.sessionId());\n        return ResponseEntity.status(HttpStatus.ACCEPTED)',
   '                tenant.actorId(), admission.sessionId());\n        return ResponseEntity.status(HttpStatus.OK)', 1),
  ('M6', 'rename/archive/unarchive drop X-Qwen-Idempotent-Replay', f'{J}/api/PublicAgentController.java',
   '        return ResponseEntity.ok()\n                .header("X-Qwen-Idempotent-Replay",\n                        Boolean.toString(result.replayed()))\n                .body(result.body());\n    }\n}',
   '        return ResponseEntity.ok()\n                .body(result.body());\n    }\n}', 1),
  ('M7', 'PublicSession last_event_id renamed', f'{J}/api/ApiModels.java',
   '@JsonProperty("last_event_id") long lastEventId,\n            @JsonProperty("workspace")',
   '@JsonProperty("last_event_seq") long lastEventId,\n            @JsonProperty("workspace")', 1),
  ('M8a', 'public SSE id = event_id (catch-up path)', f'{J}/service/ManagedEventStreamService.java',
   'PublicEvent event = agentService.publicEvent(record);\n                        if (!stillReadable(emitter, closed, actorId, session)) {\n                            break;\n                        }\n                        emitter.send(SseEmitter.event()\n                                .id(Long.toString(event.sequence()))',
   'PublicEvent event = agentService.publicEvent(record);\n                        if (!stillReadable(emitter, closed, actorId, session)) {\n                            break;\n                        }\n                        emitter.send(SseEmitter.event()\n                                .id(event.eventId())', 1),
  ('M8b', 'public SSE id = event_id (live path)', f'{J}/service/ManagedEventStreamService.java',
   '                            .id(Long.toString(publicEvent.sequence()))',
   '                            .id(publicEvent.eventId())', 1),
  ('M8c', 'WebShell SSE id = eventId (catch-up path)', f'{J}/service/ManagedEventStreamService.java',
   'WebShellEvent event = agentService.webShellEvent(record);\n                        if (!stillReadable(emitter, closed, actorId, session)) {\n                            break;\n                        }\n                        emitter.send(SseEmitter.event()\n                                .id(Long.toString(event.sequence()))',
   'WebShellEvent event = agentService.webShellEvent(record);\n                        if (!stillReadable(emitter, closed, actorId, session)) {\n                            break;\n                        }\n                        emitter.send(SseEmitter.event()\n                                .id(event.eventId())', 1),
  ('M8d', 'WebShell SSE id = eventId (live path)', f'{J}/service/ManagedEventStreamService.java',
   '                            .id(Long.toString(webEvent.sequence()))',
   '                            .id(webEvent.eventId())', 1),
  ('M9', 'PublicSession status not lower-cased (ACTIVE)', f'{J}/service/ManagedAgentService.java',
   '        return new PublicSession(session.sessionId(), "agent.session",\n                session.agentId(), session.status().toLowerCase(),',
   '        return new PublicSession(session.sessionId(), "agent.session",\n                session.agentId(), session.status(),', 1),
  ('M10', 'session list object "list" -> "page"', f'{J}/service/ManagedAgentService.java',
   'return new PublicList<>("list", sessions', 'return new PublicList<>("page", sessions', 1),
  ('M11', 'session id not a UUID (sess_ prefix)', f'{J}/store/ManagedAgentStore.java',
   '        String sessionId = UUID.randomUUID().toString();',
   '        String sessionId = "sess_" + UUID.randomUUID().toString();', 1),
  ('M12', 'WebShell commands start returning X-Request-Id', f'{J}/api/WebShellAgentController.java',
   'ResponseEntity.accepted().body(', 'ResponseEntity.accepted().header("X-Request-Id", "rig").body(', None),
  ('M13', 'PublicTurn status "accepted" -> "queued"', f'{J}/service/ManagedAgentService.java',
   '        return new PublicTurn(turn.turnId(), "agent.turn",\n                turn.sessionId(), turn.status().toLowerCase(),',
   '        return new PublicTurn(turn.turnId(), "agent.turn",\n                turn.sessionId(), turn.status().toLowerCase().replace("accepted", "queued"),', 1),
  ('M14', 'PublicEvent drops "terminal" from JSON', f'{J}/api/ApiModels.java',
   '            @JsonProperty("created_at") long createdAt,\n            Map<String, Object> data,\n            boolean terminal) {',
   '            @JsonProperty("created_at") long createdAt,\n            Map<String, Object> data,\n            @com.fasterxml.jackson.annotation.JsonIgnore boolean terminal) {', 1),
  ('M3b', 'new gap line deleted (archived status on get)', GAPS,
   'response getSession 200: /status enum\n', '', 1),
  ('M15', 'server reports archived Sessions as "active"', f'{J}/service/ManagedAgentService.java',
   '        return new PublicSession(session.sessionId(), "agent.session",\n                session.agentId(), session.status().toLowerCase(),',
   '        return new PublicSession(session.sessionId(), "agent.session",\n                session.agentId(), session.status().toLowerCase().replace("archived", "active"),', 1),
  ('M16', 'OpenApiContract: logicalAnd merge reverted to put (last wins)', 'src/test/java/com/alibaba/qwen/code/managedagent/OpenApiContract.java',
   '            properties.merge(field.getKey(), planned(field.getValue()),\n                    Boolean::logicalAnd);',
   '            properties.put(field.getKey(), planned(field.getValue()));', 1),
]

def run(cmd, log):
    with open(log, 'w') as f:
        return subprocess.run(cmd, cwd=MOD, stdout=f, stderr=subprocess.STDOUT).returncode

def restore():
    subprocess.run(['git', 'restore', '--source=HEAD', '--worktree', '--', 'packages/sdk-java'], cwd=WT, check=True)
    st = subprocess.run(['git', 'status', '--porcelain', '--', 'packages/sdk-java'], cwd=WT, capture_output=True, text=True).stdout
    assert st.strip() == '', st

def classes(log):
    out = {}
    for line in open(log, errors='replace'):
        m = re.search(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+).* -- in com\.alibaba\.qwen\.code\.managedagent\.(\w+)', line)
        if m:
            out[m.group(4)] = 'pass' if m.group(2) == '0' and m.group(3) == '0' else f'FAIL({int(m.group(2))+int(m.group(3))}/{m.group(1)})'
    if 'COMPILATION ERROR' in open(log, errors='replace').read():
        out['compile'] = 'ERROR'
    return out

def drift(log):
    lines = []
    for line in open(log, errors='replace'):
        if re.match(r'^  [+-] (route|record|request|response) ', line):
            lines.append(line.rstrip())
    return sorted(set(lines))

only = set(sys.argv[1:])
results = []
for mid, label, path, old, new, count in MUTANTS:
    if only and mid not in only:
        continue
    restore()
    p = f'{MOD}/{path}'
    src = open(p).read()
    n = src.count(old)
    assert n >= 1 and (count is None or n == count), (mid, n)
    open(p, 'w').write(src.replace(old, new))
    diff = subprocess.run(['git', 'diff', '--stat', '--', 'packages/sdk-java'], cwd=WT, capture_output=True, text=True).stdout.strip().splitlines()[-1]
    log = f'{S}/logs/mut-{mid}.log'
    rc = run([MVN, 'test', '-Dcheckstyle.skip', '-Dsurefire.failIfNoSpecifiedTests=false',
              '-Dtest=ManagedAgentApiContractTest,ManagedAgentServerIntegrationTest'], log)
    r = {'id': mid, 'label': label, 'applied': n, 'diff': diff, 'rc': rc, 'classes': classes(log), 'drift': drift(log)}
    results.append(r)
    print(json.dumps(r), flush=True)
restore()
json.dump(results, open(f'{S}/mutation-java{"-" + "-".join(sorted(only)) if only else ""}.json', 'w'), indent=1)
