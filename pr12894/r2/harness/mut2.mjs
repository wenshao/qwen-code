import fs from 'node:fs';
import { execSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr12894-mut`;
const MVN = `${process.env.S}/rig/mvn.sh`;
const T = {
  cli: `cd ${W}/packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts 2>&1`,
  broker: `cd ${W} && ${MVN} -o -f packages/sdk-java/runtime-broker/pom.xml test -Dtest=RuntimeBrokerHttpServerTest,HttpRuntimeTransportTest -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip 2>&1`,
};
const mutants = [
  ['M6 recovery swallows ACK 409 again', 'cli', 'packages/cli/src/serve/hosted-harness-session.ts',
    `    } catch (cause) {\n      writeStderrLineSafe(\n        'qwen serve: Tool v3 ACK failed during recovery: ' + String(cause),\n      );`,
    `    } catch (cause) {\n      if (String(cause).includes('409')) return promptId && receipts.some((item) => item.promptId === promptId) ? promptId : null;\n      writeStderrLineSafe(\n        'qwen serve: Tool v3 ACK failed during recovery: ' + String(cause),\n      );`],
  ['M7 execute 501 swallowed again', 'broker', 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java',
    `                            if (unsupportedToolV3(error)) {\n                                throw new CompletionException(unwrap(error));\n                            }\n                            return null;`, `                            return null;`],
  ['M8 status 501 keeps polling', 'broker', 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java',
    `                        if (unsupportedToolV3(error)) {\n                            answer.completeExceptionally(unwrap(error));\n                            return;\n                        }\n`, ``],
  ['M9 transport 501 not classified', 'broker', 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/HttpRuntimeTransport.java',
    `        if (response.statusCode() == 501\n                && (V3_EXECUTE_PATH.equals(path) || V3_STATUS_PATH.equals(path))) {`, `        if (false && response.statusCode() == 501\n                && (V3_EXECUTE_PATH.equals(path) || V3_STATUS_PATH.equals(path))) {`],
];
const run = (kind) => {
  let out = '', ok = true;
  try { out = execSync(T[kind], { encoding: 'utf8', maxBuffer: 64 << 20, shell: '/bin/bash' }); } catch (e) { ok = false; out = (e.stdout ?? '') + (e.stderr ?? ''); }
  const line = kind === 'broker' ? (out.match(/Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+(?![\s\S]*Tests run:)/) ?? ['?'])[0] : (out.match(/Tests\s+\d+[^\n]*/g) ?? ['?']).at(-1);
  return { ok, line };
};
for (const k of Object.keys(T)) { const r = run(k); console.log(`baseline ${k}: ${r.ok ? 'PASS' : 'FAIL'} ${r.line}`); }
for (const [label, kind, file, from, to] of mutants) {
  const p = `${W}/${file}`; const src = fs.readFileSync(p, 'utf8');
  if (!src.includes(from)) { console.log(`${label}: anchor not found`); continue; }
  fs.writeFileSync(p, src.replace(from, to)); const r = run(kind); fs.writeFileSync(p, src);
  console.log(`${label}: ${r.ok ? 'SURVIVED' : 'KILLED'} (${kind}: ${r.line})`);
}
execSync(`cd ${W} && git status --short`, { stdio: 'inherit' });
