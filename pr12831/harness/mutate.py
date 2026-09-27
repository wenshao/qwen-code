# Mutation sampling on the PR worktree (restored with git checkout after each).
import subprocess, sys, os, re
SP = os.path.dirname(os.path.abspath(__file__))
WT = f'{SP}/wt-pr'
J = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java'
B = 'packages/cli/src/serve/hosted-workspace-broker.ts'
T = 'packages/cli/src/serve/hosted-workspace-tool-turn.ts'
MUTANTS = [
  ('J1 start skips payload digest check', J, 'if (!digest.equals(record.getRequestDigest())) {', 'if (false && !digest.equals(record.getRequestDigest())) {', 'java'),
  ('J2 immediate endpoint accepts dispatchMode', J, 'if (reference == null || reference.containsKey("dispatchMode")) {', 'if (reference == null) {', 'java'),
  ('J3 deferred dispatch without payload allowed', J, 'if (payload == null && "deferred".equals(prepared.getReference().get("dispatchMode"))', 'if (false && payload == null && "deferred".equals(prepared.getReference().get("dispatchMode"))', 'java'),
  ('T1 lost start reply re-sends start', B, '        // A lost start reply is not permission to start another invocation.\n', '        response = await this.request(`${path}:start`, { payloadJson });\n', 'ts'),
  ('T2 wait checkpoint committed after dispatch', T, '      await this.harness.commitAwaitRuntimeBatch(bindings);\n      const responses: Part[] = [];\n', '      const responses: Part[] = [];\n', 'ts'),
]
env = dict(os.environ, JAVA_HOME=os.path.expanduser('~/Install/jdk21'), PATH=os.path.expanduser('~/Install/jdk21/bin:~/Install/maven/bin:') + os.environ['PATH'])
out = []
for name, path, old, new, kind in MUTANTS:
    p = f'{WT}/{path}'
    s = open(p).read()
    assert s.count(old) == 1, name
    if name.startswith('T2'):
        # move the checkpoint commit after the execution loop
        s2 = s.replace(old, new).replace('      this.uncertain = false;\n      return responses;', '      await this.harness.commitAwaitRuntimeBatch(bindings);\n      this.uncertain = false;\n      return responses;')
    else:
        s2 = s.replace(old, new)
    open(p, 'w').write(s2)
    try:
        if kind == 'java':
            r = subprocess.run(['mvn', '--batch-mode', '--no-transfer-progress', '-s', f'{SP}/m2settings.xml', f'-Dmaven.repo.local={SP}/m2repo', '-q', '-f', 'packages/sdk-java/runtime-broker/pom.xml', 'test', '-Dcheckstyle.skip'], cwd=WT, env=env, capture_output=True, text=True)
            log = r.stdout + r.stderr
            fails = sorted(set(re.findall(r'(\w+Test)\.(\w+):\d+', log)))
        else:
            r = subprocess.run(['npx', 'vitest', 'run', 'src/serve/hosted-workspace-tool-turn.test.ts', 'src/serve/hosted-workspace-broker.test.ts'], cwd=f'{WT}/packages/cli', capture_output=True, text=True)
            log = r.stdout + r.stderr
            fails = sorted(set(re.findall(r'× (.+?)(?: \d+ms)?$', log, re.M)))
        verdict = 'KILLED' if r.returncode != 0 else 'SURVIVED'
        out.append(f'{name}: {verdict} rc={r.returncode} by {fails[:3]}')
    finally:
        subprocess.run(['git', 'checkout', '--', path], cwd=WT)
    print(out[-1], flush=True)
open(f'{SP}/logs/mutants.txt', 'w').write('\n'.join(out) + '\n')
