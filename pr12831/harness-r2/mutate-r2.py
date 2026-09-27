# Mutation sample on the round-2 fixes (wt-r2), restored with git checkout.
import subprocess, os, re
SP = os.path.dirname(os.path.abspath(__file__))
WT = f'{SP}/wt-r2'
T = 'packages/cli/src/serve/hosted-workspace-tool-turn.ts'
W = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/service/WorkspaceRuntimeTransport.java'
J = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java'
MUT = [
  ('R1 definite refusal still recovery-blocks', [(T, "          this.uncertain = false;\n          throw cause;\n", "          throw new HostedToolRecoveryRequiredError(cause);\n")], 'ts'),
  ('R2 any 409 counts as definite (code check dropped)', [(T, "          cause.status === 409 &&\n          (cause.code === 'workspace_busy' ||\n            cause.code === 'workspace_unavailable')\n", "          cause.status === 409\n")], 'ts'),
  ('R3 assistant record not validated before acquire', [(T, "    this.validateAssistant(parts, model);\n", "")], 'ts'),
  ('R4 input resource size not checked', [(T, "        inputBytes.length >\n", "        inputBytes.length > Infinity &&\n        inputBytes.length >\n")], 'ts'),
  ('R5 async post-claim failure keeps its original code', [(W, "                    .exceptionally(error -> {\n                        throw acquireUncertain(error);\n                    });", "                    ;")], 'java-mas'),
  ('R6 sync post-claim failure keeps its original code', [(W, "        } catch (RuntimeException error) {\n            throw acquireUncertain(error);\n        }\n    }", "        } catch (RuntimeException error) {\n            throw error;\n        }\n    }")], 'java-mas'),
  ('R7 immediate dispatchMode guard + deferred payload guard both removed', [(J, 'if (reference == null || reference.containsKey("dispatchMode")) {', 'if (reference == null) {'), (J, 'if (payload == null && "deferred".equals(prepared.getReference().get("dispatchMode"))', 'if (false && payload == null && "deferred".equals(prepared.getReference().get("dispatchMode"))')], 'java-broker'),
]
env = dict(os.environ, JAVA_HOME=os.path.expanduser('~/Install/jdk21'), PATH=os.path.expanduser('~/Install/jdk21/bin:~/Install/maven/bin:') + os.environ['PATH'])
MVN = ['mvn', '--batch-mode', '--no-transfer-progress', '-s', f'{SP}/m2settings.xml', f'-Dmaven.repo.local={SP}/m2repo', '-Dcheckstyle.skip']
out = []
for name, edits, kind in MUT:
    files = sorted({p for p, _, _ in edits})
    for p, old, new in edits:
        f = f'{WT}/{p}'; s = open(f).read()
        assert s.count(old) == 1, (name, old[:40])
        open(f, 'w').write(s.replace(old, new))
    try:
        if kind == 'ts':
            r = subprocess.run(['npx', 'vitest', 'run', 'src/serve/hosted-workspace-tool-turn.test.ts', 'src/serve/hosted-workspace-broker.test.ts', 'src/serve/hosted-harness-session.test.ts'], cwd=f'{WT}/packages/cli', capture_output=True, text=True)
            fails = sorted(set(re.findall(r'× (.+?)(?: \d+ms)?$', r.stdout + r.stderr, re.M)))
        elif kind == 'java-mas':
            r = subprocess.run(MVN + ['-q', '-f', 'packages/sdk-java/managed-agent-server/pom.xml', 'test', '-Dtest=WorkspaceRuntimeTest,EmbeddedRuntimeBrokerTest', '-Dsurefire.failIfNoSpecifiedTests=false'], cwd=WT, env=env, capture_output=True, text=True)
            fails = sorted(set(re.findall(r'(\w+Test)\.(\w+):\d+', r.stdout + r.stderr)))
        else:
            r = subprocess.run(MVN + ['-q', '-f', 'packages/sdk-java/runtime-broker/pom.xml', 'test'], cwd=WT, env=env, capture_output=True, text=True)
            fails = sorted(set(re.findall(r'(\w+Test)\.(\w+):\d+', r.stdout + r.stderr)))
        out.append(f"{name}: {'KILLED' if r.returncode else 'SURVIVED'} by {fails[:3]}")
    finally:
        subprocess.run(['git', 'checkout', '--'] + files, cwd=WT)
    print(out[-1], flush=True)
open(f'{SP}/logs/mutants-r2.txt', 'w').write('\n'.join(out) + '\n')
