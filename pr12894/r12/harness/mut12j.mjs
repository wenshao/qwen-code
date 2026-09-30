// Round 12 Java mutants on af423eb7 (R5-1 pre-dispatch not_started).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr12894-mut3`;
const MVN = process.argv[2];
const T = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/service/WorkspaceRuntimeTransport.java';
const B = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java';
const TW = `cd ${W} && ${MVN} -f packages/sdk-java/managed-agent-server/pom.xml -Dtest=WorkspaceRuntimeTest -Dsurefire.failIfNoSpecifiedTests=false test 2>&1`;
const TB = `cd ${W} && ${MVN} -f packages/sdk-java/runtime-broker/pom.xml -Dtest=RuntimeBrokerServiceTest -Dsurefire.failIfNoSpecifiedTests=false test 2>&1`;
const mutants = [
  ['K1 executeV3 ownership refusal thrown again (transport)', T, TW, `        try {\n            requireOwnedWorkspace(lease, session);\n        } catch (RuntimeException error) {\n            String code`, `        try {\n            requireOwnedWorkspace(lease, session);\n        } catch (RuntimeException error) {\n            if (true) throw error;\n            String code`],
  ['K2 Broker ignores a settled not_started executeV3 answer', B, TB, `                            if (error == null && answer != null\n                                    && "settled".equals(answer.get("state"))`, `                            if (false && error == null && answer != null\n                                    && "settled".equals(answer.get("state"))`],
];
const run = (cmd) => { let out = '', ok = true; try { out = execSync(cmd, { encoding: 'utf8', maxBuffer: 256 << 20, shell: '/bin/bash' }); } catch (e) { ok = false; out = (e.stdout ?? '') + (e.stderr ?? ''); } const line = (out.match(/Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+(?!,)/g) ?? ['? ' + out.slice(-400)]).at(-1); const failed = [...out.matchAll(/\[ERROR\]\s+(\S+)\s+(?:--|Time)/g)].map((m) => m[1]).slice(0, 3); return { ok, line, failed }; };
for (const [n, cmd] of [['transport', TW], ['broker', TB]]) { const b = run(cmd); console.log(`baseline ${n}: ${b.ok ? 'PASS' : 'FAIL'} ${b.line}`); }
for (const [label, file, cmd, from, to] of mutants) {
  const p = `${W}/${file}`; const src = fs.readFileSync(p, 'utf8');
  if (!src.includes(from)) { console.log(`${label}: anchor not found`); continue; }
  fs.writeFileSync(p, src.replace(from, to)); const r = run(cmd); fs.writeFileSync(p, src);
  console.log(`${label}: ${r.ok ? 'SURVIVED' : 'KILLED'} (${r.line})${r.ok ? '' : ' ' + r.failed.join(', ')}`);
}
execSync(`cd ${W} && git status --short`, { stdio: 'inherit' });
