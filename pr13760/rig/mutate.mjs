// Focused mutants of the cwdChange capability predicate (PR #13760), run against the two
// test classes that assert it. Each mutant: fail-closed anchor replace -> mvn test -> restore.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const R = '/Users/wenshao/pr13760-rig';
const MOD = `${R}/mut/sdk-java/managed-agent-server`;
const F = `${MOD}/src/main/java/com/alibaba/qwen/code/managedagent/service/ManagedAgentService.java`;
const orig = fs.readFileSync(F, 'utf8');
const TWIN = `    private boolean mayChangeCwd(SessionRecord session,
            Map<String, ManagedWorkspaceRegistry.ReadableGrant> grants,
            java.util.Set<String> executable) {
        if (!mayChangeCwdShape(session)) {
            return false;
        }
        var grant = grants.get(session.workspace().getWorkspaceId());
        return grant != null && grant.canCreateSession()
                && executable.contains(session.sessionId());
    }`;
const SHAPE = `        return session.workspace() != null && "ACTIVE".equals(session.status())
                && session.deletedAt() == null && store.workspaceFilesEnabled();`;
const mutants = [
  ['J1 twin drops the creator-keyed facts', TWIN, TWIN.replace(`grant.canCreateSession()
                && executable.contains(session.sessionId())`, 'grant.canCreateSession()')],
  ['J2 twin drops the OPERATOR role (any readable grant)', TWIN, TWIN.replace('grant != null && grant.canCreateSession()', 'grant != null')],
  ['J3 shape drops status ACTIVE', SHAPE, SHAPE.replace(' && "ACTIVE".equals(session.status())', '')],
  ['J4 shape drops deletedAt == null', SHAPE, SHAPE.replace('\n                && session.deletedAt() == null && store', '\n                && store')],
  ['J5 shape drops the deployment opt-in', SHAPE, SHAPE.replace(' && store.workspaceFilesEnabled()', '')],
  ['J6 facts batch covers submit-shaped ids only', `                        : store.sessionsWithExecutionRegistryFacts(tenantId,
                                candidateIds);`, `                        : store.sessionsWithExecutionRegistryFacts(tenantId,
                                shaped);`],
  ['J7 grant batch covers submit-shaped workspaces only', `                        .filter(session -> candidateIds.contains(
                                session.sessionId()))`, `                        .filter(session -> shaped.contains(
                                session.sessionId()))`],
  ['J8 facts read no longer skipped for reader-only pages', `candidateIds.isEmpty() || !operatorGrant ? Set.of()`, `candidateIds.isEmpty() ? Set.of()`],
  ['J9 cwdChange reuses the Turn predicate', `                        mayChangeCwd(session, grants, executable)))`, `                        maySubmitWorkspaceTurn(session, grants, executable)))`],
  ['J10 cwdChange hard-wired false', `                        retention, retention, supportsDelete(session, retention),
                        mayChangeCwd));`, `                        retention, retention, supportsDelete(session, retention),
                        false));`],
];
const only = process.argv[2] ? process.argv[2].split(',') : null;
const results = [];
const env = { ...process.env, JAVA_HOME: '/Users/wenshao/Install/jdk21', PATH: `/Users/wenshao/Install/jdk21/bin:${process.env.PATH}` };
for (const [name, from, to] of mutants) {
  const id = name.split(' ')[0];
  if (only && !only.includes(id)) continue;
  const count = orig.split(from).length - 1;
  if (count !== 1 || from === to) { results.push({ id, name, verdict: `ANCHOR(${count})` }); console.log(id, 'ANCHOR', count); continue; }
  fs.writeFileSync(F, orig.replace(from, to));
  const t0 = Date.now();
  const r = spawnSync('/Users/wenshao/Install/maven/bin/mvn', ['-B', '-ntp', '-o', `-Dmaven.repo.local=${R}/m2-head`, '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true', 'test', '-Dtest=Issue13181QueryBudgetTest,ManagedAgentApiContractTest', '-Dsurefire.failIfNoSpecifiedTests=false'], { cwd: MOD, env, encoding: 'utf8', maxBuffer: 512 << 20 });
  fs.writeFileSync(F, orig);
  const log = r.stdout + r.stderr;
  fs.writeFileSync(`${R}/mut/${id}.log`, log);
  const total = [...log.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+)/g)].at(-1);
  const failing = [...new Set([...log.matchAll(/\[ERROR\]\s+(?:Failures|Errors)?:?\s*(\w+Test)\.(\w+)/g)].map((m) => `${m[1]}.${m[2]}`))];
  const compileError = /COMPILATION ERROR/.test(log);
  const verdict = compileError ? 'COMPILE' : r.status === 0 ? 'SURVIVED' : 'KILLED';
  results.push({ id, name, verdict, run: total ? `${total[1]} run / ${total[2]} fail / ${total[3]} err` : null, killers: failing.slice(0, 6), sec: Math.round((Date.now() - t0) / 1000) });
  console.log(id, verdict, total?.[0], failing.slice(0, 4).join(' '));
  fs.writeFileSync(`${R}/mut/results.json`, JSON.stringify(results, null, 2));
}
fs.writeFileSync(F, orig);
console.log('MUT-DONE');
