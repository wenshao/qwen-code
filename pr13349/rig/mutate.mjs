// Mutation check of the PR's unit-test pins, in a dedicated worktree.
// Each mutant is an anchored replacement (fails closed if the anchor is not
// found exactly once); the targeted test class runs offline against the head
// arm's isolated m2; the file is restored with git checkout afterwards.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const WT = '/Users/wenshao/git/pr13349-mut';
const R = '/Users/wenshao/git/pr13349-rig';
const SDK = `${WT}/packages/sdk-java`;
const CLIENT = `${SDK}/qwencode/src/main/java/com/alibaba/qwen/code/daemon/HostedHarnessClient.java`;
const COORD = `${SDK}/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/service/HarnessCoordinator.java`;
const suites = {
  client: { dir: `${SDK}/qwencode`, test: 'HostedHarnessClientTest' },
  server: { dir: `${SDK}/managed-agent-server`, test: 'HarnessCoordinatorTest' },
};
const mutants = [
  { id: 'BASELINE-client', suite: 'client', file: CLIENT, from: null },
  { id: 'BASELINE-server', suite: 'server', file: COORD, from: null },
  { id: 'C1 no reclassification', suite: 'client', file: CLIENT, from: 'throw namedLoadRefusal(error);', to: 'throw error;' },
  { id: 'C2 pattern accepts any char', suite: 'client', file: CLIENT, from: '"[a-z0-9_]{1,128}"', to: '".{1,128}"' },
  { id: 'C2b pattern DOTALL any char', suite: 'client', file: CLIENT, from: '"[a-z0-9_]{1,128}"', to: '"(?s).{1,128}"' },
  { id: 'C3 pattern unbounded length', suite: 'client', file: CLIENT, from: '"[a-z0-9_]{1,128}"', to: '"[a-z0-9_]+"' },
  { id: 'C4 reads error field not code', suite: 'client', file: CLIENT, from: '"load refusal response"),\n                    "code");', to: '"load refusal response"),\n                    "error");' },
  { id: 'C5 classifies transport failures', suite: 'client', file: CLIENT, from: '        if (!(error.getCause() instanceof DaemonHttpException)) {\n            return error;\n        }\n        DaemonHttpException http', to: '        DaemonHttpException http' },
  { id: 'C6 null code not guarded', suite: 'client', file: CLIENT, from: 'if (code == null || !REFUSAL_CODE_PATTERN', to: 'if (!REFUSAL_CODE_PATTERN' },
  { id: 'C7 parse failure propagates', suite: 'client', file: CLIENT, from: '        } catch (DaemonProtocolException parseFailure) {\n            return error;\n        }', to: '        } catch (DaemonProtocolException parseFailure) {\n            throw parseFailure;\n        }' },
  { id: 'S1 terminal keeps hosted_harness_unavailable', suite: 'server', file: COORD, from: '            if (error instanceof HarnessSessionRefusedException refusal) {\n                return fail(turn, refusal.getCode(),', to: '            if (false && error instanceof HarnessSessionRefusedException refusal) {\n                return fail(turn, refusal.getCode(),' },
  { id: 'S2 refusal fails immediately', suite: 'server', file: COORD, from: '            terminal = transientFailure(claimed, submissionAttempted.get(),\n                    error);\n        } catch (DaemonHttpException error) {', to: '            terminal = fail(claimed, error.getCode(), "refused");\n        } catch (DaemonHttpException error) {' },
  { id: 'S3 log label is class name', suite: 'server', file: COORD, from: '        return error instanceof HarnessSessionRefusedException refusal\n                ? refusal.getCode()\n                : error.getClass().getSimpleName();', to: '        return error.getClass().getSimpleName();' },
  { id: 'S4 explicit refusal catch removed', suite: 'server', file: COORD, from: '        } catch (HarnessSessionRefusedException error) {', to: '        } catch (IllegalMonitorStateException error) {' },
];
const only = process.argv.slice(2);
for (const m of mutants) {
  if (only.length && !only.some((o) => m.id.startsWith(o))) continue;
  const original = readFileSync(m.file, 'utf8');
  if (m.from !== null) {
    const count = original.split(m.from).length - 1;
    if (count !== 1) throw new Error(`${m.id}: anchor found ${count} times`);
    writeFileSync(m.file, original.replace(m.from, m.to));
  }
  const s = suites[m.suite];
  const started = Date.now();
  const run = spawnSync(`${R}/mvn.sh`, ['head', '-o', '-B', '-Dcheckstyle.skip', '-Dspotbugs.skip', '-Dgpg.skip', '-Djacoco.skip=true', `-Dtest=${s.test}`, '-Dsurefire.failIfNoSpecifiedTests=false', 'test'], { cwd: s.dir, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  execFileSync('git', ['-C', WT, 'checkout', '--', m.file]);
  const outText = (run.stdout ?? '') + (run.stderr ?? '');
  writeFileSync(`${R}/results/mut-${m.id.split(' ')[0]}.log`, outText);
  const summary = [...outText.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].pop();
  const compileError = /COMPILATION ERROR/.test(outText);
  const failedTests = [...new Set([...outText.matchAll(/\[ERROR\]\s+\S+Test\.(\w+)/g)].map((x) => x[1]))];
  let verdict;
  if (!summary) verdict = compileError ? 'KILLED(compile)' : 'NO-RESULT';
  else {
    const [, total, fail, err] = summary.map(Number);
    if (m.from === null) verdict = fail + err === 0 && run.status === 0 ? `PASS(${total})` : `BASELINE-FAILED(${fail}+${err}/${total})`;
    else verdict = fail + err > 0 ? `KILLED(${fail + err}/${total})` : `SURVIVED(${total})`;
  }
  const line = `RESULT\t${m.id}\t${verdict}\t${failedTests.join(',') || '-'}\t${Math.round((Date.now() - started) / 1000)}s`;
  appendFileSync(`${R}/results/mutants.tsv`, line + '\n');
  console.log(line);
}
