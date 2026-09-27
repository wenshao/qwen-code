// Replays one sdk-java.yml job's run: steps verbatim against local docker
// databases. Only runner-specific values are substituted (settings path,
// service ports); each step body is written to its own file unchanged
// otherwise and run under `bash --noprofile --norc -eo pipefail`, as Actions
// runs `shell: bash`.
// usage: WT=<worktree> SP=<dir> node replay.mjs <workflow.yml> <job> <out-prefix>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { WT, SP, MARIADB_HOST_PORT = '23864', MYSQL_HOST_PORT = '23865' } = process.env;
const { parse } = createRequire(`${WT}/package.json`)('yaml');
const [file, jobName, out] = process.argv.slice(2);
const job = parse(readFileSync(file, 'utf8')).jobs[jobName];
const skip = new Set([
  'Enable Corepack',
  'Install, build and bundle CLI', // done once by the same pnpm command
  'Run Runtime Broker fault gates', // after the check; not touched by this PR
]);
const sub = (text) =>
  String(text)
    .replaceAll(
      '--settings ${{ runner.temp }}/setup-java-m2/settings.xml --toolchains ${{ runner.temp }}/setup-java-m2/toolchains.xml',
      `--settings ${SP}/settings.xml -Dmaven.repo.local=${SP}/m2repo`,
    )
    .replaceAll("${{ job.services.mysql.ports['3306'] }}", MYSQL_HOST_PORT)
    .replaceAll('127.0.0.1:3306/', `127.0.0.1:${MARIADB_HOST_PORT}/`);
const q = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
const lines = ['set -u', `cd ${q(WT)}`, `export GITHUB_WORKSPACE=${q(WT)}`, 'JOB_RC=0'];
let n = 0;
for (const step of job.steps) {
  if (!step.run || skip.has(step.name)) continue;
  if (step.if) throw new Error(`unexpected if: on ${step.name}`);
  const body = sub(step.run);
  if (body.includes('${{')) throw new Error(`expression left in ${step.name}`);
  const stepFile = `${out}.step${++n}.sh`;
  writeFileSync(stepFile, `${body}\n`);
  const env = Object.entries(step.env ?? {}).map(([k, v]) =>
    k === 'MAVEN_ARGS'
      ? `export MAVEN_ARGS=${q(sub(v))}"\${EXTRA_MAVEN_ARGS:+ }\${EXTRA_MAVEN_ARGS:-}"`
      : `export ${k}=${q(sub(v))}`,
  );
  const guard =
    step.name === 'Install Managed Agent dependencies'
      ? 'if [ -n "${SKIP_INSTALL:-}" ]; then echo "::step-result:: (install skipped, done in an earlier arm)"; else '
      : '';
  lines.push(
    `${guard}echo "::step:: ${step.name}"; T0=$(date +%s)`,
    `( cd ${q(step['working-directory'] ?? '.')} && ${[...env, 'true'].join(' && ')} && bash --noprofile --norc -eo pipefail ${q(stepFile)} )`,
    `RC=$?; echo "::step-result:: ${step.name} exit=$RC secs=$(( $(date +%s) - T0 ))"; [ $RC -ne 0 ] && JOB_RC=$RC${guard ? '; fi' : ''}`,
  );
}
lines.push('echo "::job-result:: exit=$JOB_RC"', 'exit $JOB_RC');
writeFileSync(`${out}.sh`, `${lines.join('\n')}\n`);
