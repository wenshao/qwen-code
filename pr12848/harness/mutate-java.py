#!/usr/bin/env python3
"""Java mutants for #12848 in wt-mut. Broker mutants run the whole runtime-broker
suite; Store/transport mutants run the PR's managed-agent-server test classes."""
import json, re, subprocess, sys, time

SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad'
WT = f'{SP}/wt-mut'
ENV = {'JAVA_HOME': '/Users/wenshao/Install/jdk21', 'PATH': '/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/maven/bin:/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': '/Users/wenshao'}
MVN = ['mvn', '--batch-mode', '--no-transfer-progress', '-s', f'{SP}/m2settings.xml', f'-Dmaven.repo.local={SP}/m2repo', '-Dcheckstyle.skip']
S = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/'
B = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/'
MAS_TESTS = 'ManagedSessionStoreIntegrationTest,WorkspaceRuntimeTest'
MUTANTS = [
  ('J1', 'Store publish skips writer fencing', S + 'store/ManagedSessionStore.java',
   '        requireWriter(head, request.writerId(), request.writerGeneration(), writerToken, now, true);\n        String scopeKey = sessionScopeKey(tenantId, sessionId);\n        ResourceRow existing',
   '        String scopeKey = sessionScopeKey(tenantId, sessionId);\n        ResourceRow existing'),
  ('J2', 'Store publish lets a resourceId change content', S + 'store/ManagedSessionStore.java',
   '                throw conflict("managed_session_resource_conflict", "A resourceId was reused with different content metadata.");',
   '                assert true;'),
  ('J3', 'Store publish ignores bytes/digest mismatch', S + 'store/ManagedSessionStore.java',
   '        if (bytes.length != request.byteLength() || !sha256(bytes).equals(request.digest())) {',
   '        if (bytes.length != request.byteLength()) {'),
  ('J4', 'Store publish accepts any kind (limit 1 MiB)', S + 'store/ManagedSessionStore.java',
   '            default -> 0;\n        };\n    }', '            default -> 1024 * 1024;\n        };\n    }'),
  ('J5', 'v3 execute skips local-process provisioner check', S + 'service/WorkspaceRuntimeTransport.java',
   '                if (v3(reference)) {\n                    captureContext = requireLocalCapture(context);\n                }',
   '                if (v3(reference)) {\n                    captureContext = context;\n                }'),
  ('J6', 'ACK of an unsettled execution', B + 'RuntimeBrokerService.java',
   '                if (!record.isSettled()\n                        || !Integer.valueOf(3)', '                if (false\n                        || !Integer.valueOf(3)'),
  ('J7', 'v3 start accepts non-Shell tools', B + 'RuntimeBrokerService.java',
   '                    || Integer.valueOf(3).equals(record.getReference().get("runtimeProtocol"))\n                        && !"run_shell_command".equals(toolName)) {',
   '                    ) {'),
  ('J8', 'publisher descriptor URL unchecked', B + 'HttpRuntimeTransport.java',
   '                || !url.matches("http://127\\\\.0\\\\.0\\\\.1:[1-9][0-9]{0,4}/internal/hosted-shell-publisher/v1")\n', ''),
  ('J9', 'v3 inputDigest format unchecked', B + 'RuntimeBrokerService.java',
   '                    || !inputDigest.matches("[0-9a-f]{64}"))) {', '                    )) {'),
  ('J10', 'dispatch omits executionCallId for v3', B + 'RuntimeBrokerService.java',
   '        reference.put("executionCallId", record.getExecutionCallId());\n', ''),
]

def mvn(pom, extra):
    t0 = time.time()
    r = subprocess.run(MVN + ['-f', pom] + extra, cwd=WT, capture_output=True, text=True, env=ENV, timeout=3600)
    out = r.stdout + r.stderr
    open(f'{SP}/logs/java-mut-{CUR[0]}-{pom.split("/")[2]}.log', 'w').write(out)
    tests = [l for l in out.splitlines() if re.search(r'Tests run: \d+, Failures', l) and 'Time elapsed' not in l]
    comp = 'COMPILATION ERROR' in out
    return r.returncode, ('compile error' if comp else (tests[-1].split('] ')[-1] if tests else out.strip().splitlines()[-1][:160])), time.time() - t0

only = sys.argv[1:]
results = []
CUR = ['']
for mid, desc, path, old, new in MUTANTS:
    if only and mid not in only:
        continue
    full = f'{WT}/{path}'
    CUR[0] = mid
    src = open(full).read()
    n = src.count(old)
    if n != 1:
        results.append((mid, desc, f'SKIP: pattern count {n}'))
        print(mid, 'SKIP count', n, flush=True)
        continue
    open(full, 'w').write(src.replace(old, new))
    try:
        if 'runtime-broker' in path:
            rc, summary, secs = mvn('packages/sdk-java/runtime-broker/pom.xml', ['test', '-Dtest=HttpRuntimeTransportTest,RuntimeBrokerHttpServerTest,RuntimeBrokerServiceTest,JdbcRepositoryTest,InMemoryRepositoryTest,ManagedToolResultConformanceTest', '-Dsurefire.failIfNoSpecifiedTests=false'])
            where = 'runtime-broker suite'
            if rc == 0:
                # Broker mutants can surface in the Spring transport tests too.
                i = subprocess.run(MVN + ['-f', 'packages/sdk-java/runtime-broker/pom.xml', '-DskipTests', '-Dgpg.skip=true', 'install'], cwd=WT, capture_output=True, text=True, env=ENV)
                rc, summary2, secs2 = mvn('packages/sdk-java/managed-agent-server/pom.xml', ['test', f'-Dtest={MAS_TESTS}'])
                summary += f' ; mas: {summary2}'
                secs += secs2
                where += ' + MAS tests'
        else:
            rc, summary, secs = mvn('packages/sdk-java/managed-agent-server/pom.xml', ['test', f'-Dtest={MAS_TESTS}'])
            where = 'MAS tests'
        verdict = 'KILLED' if rc != 0 else 'SURVIVED'
        results.append((mid, desc, f'{verdict} ({where}: {summary}; {secs:.0f}s)'))
        print(mid, verdict, summary, flush=True)
    finally:
        subprocess.run(['git', 'checkout', '--', path], cwd=WT, check=True)
        if 'runtime-broker' in path:
            subprocess.run(MVN + ['-f', 'packages/sdk-java/runtime-broker/pom.xml', '-DskipTests', '-Dgpg.skip=true', 'install'], cwd=WT, capture_output=True, text=True, env=ENV)
# restore the clean broker jar in the local repo
subprocess.run(MVN + ['-f', 'packages/sdk-java/runtime-broker/pom.xml', '-DskipTests', '-Dgpg.skip=true', 'install'], cwd=WT, capture_output=True, text=True, env=ENV)
json.dump(results, open(f'{SP}/logs/mutation-java-{"-".join(only) or "all"}.json', 'w'), indent=1)
for r in results:
    print(' | '.join(r))
