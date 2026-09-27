import sys, json
SP = '${SCRATCH}/'
sys.path.insert(0, SP + 'fig')
from card import render
OUT = SP + 'fig/'
SUB = 'macOS 26.6.2 arm64, Node 22.23.2; PR head d467f82c merged onto main 81c260bb (tree d9f8284e); pnpm install --frozen-lockfile -> build + bundle'

# 1. Route probe
probe = [l.rstrip('\n') for l in open(SP + 'route-probe.txt')]
lines = ['== ' + probe[0], '']
for l in probe[1:]:
    name = l.split('|')[0]
    if name.startswith('OLD probe'):
        lines.append('-- ' + l)
    elif 'new on main' in name:
        lines.append('>> ' + l)
    else:
        lines.append('++ ' + l)
lines += ['',
  '++ green: probes this PR adds; the default daemon serves each one (200 / 406 / 401), so a Hosted 404 is meaningful',
  '-- red: the probes this PR removes; 404 on BOTH profiles, which is why they could never fail',
  '>> cyan: POST /session/:id/mcp-app/tools/call landed on main in #12258 after this PR branched; the /session/ catch-all',
  '>>       gate hides it too (merge-ref only; not asserted by the suite)',
  '== shell route: the default daemon also answers 404, but with JSON {"error":"No session with ..."}; only the bare-body',
  '==   check [404, "Not Found"] tells it apart from the Hosted gate (with the catch-all removed, the Hosted daemon answers 403)']
render('Route probe: one packaged dist/cli.js, default profile vs --profile hosted-harness',
       'Independent script (not the suite helper): same token, same requests; ' + SUB, lines, OUT + '01-route-probe.png', size=22)

# 2. Bundle mutants
res = {r['id']: r for r in json.load(open(SP + 'mut/results-r1.json'))}
desc = {
 'M0': 'no mutation (control)',
 'D1': 'drop lenientToolWarmup (original defect 1)',
 'D2': 'unfiltered setHistory(history) (original defect 2)',
 'E': 'empty-answer filter removed (any model entry = answered)',
 'Eold': 'next-entry-is-model filter (earlier #12713 revision)',
 'G1': 'pre-authentication Hosted route gate removed',
 'G2': '/session/ catch-all gate removed',
 'G12': 'both Hosted route gates removed',
 'H3': '/health auth forcing removed at all 3 sites',
 'Hsrv': '  ...only createServeApp site (1 of 3)',
 'Hrun': '  ...only runQwenServe sites (2 of 3)',
 'W': 'Store writerId == bootId check removed',
}
why = {
 'D1': '0 model requests / 30 s settle timeouts',
 'D2': 'unanswered A must not reappear',
 'E': 'empty A reappears in B/C requests',
 'Eold': 'empty A reappears in B/C requests',
 'G1': 'GET /daemon/status (no auth): 401 != 404',
 'G2': 'POST /session/<id>/shell: 403 != 404',
 'G12': 'GET /daemon/status (no auth): 401 != 404',
 'H3': 'GET /health (no auth): 200 != 401',
 'W': 'foreign writerId: 200 != 409',
 'Hsrv': 'redundant layer, behaviour unchanged',
 'Hrun': 'redundant layer, behaviour unchanged',
}
def cell(r, k):
    x = r[k]
    return f"{x['passed']}/{x['total']} pass" if not x['failed'] else f"{len(x['failed'])} FAILED"
lines = ['== ' + f"{'id':<6}{'bundle mutant (exact-hit anchors in dist/chunks)':<58}{'main suite':<13}{'this PR':<13}{'first PR failure'}", '']
for k in ['M0', 'D1', 'D2', 'E', 'Eold', 'G1', 'G2', 'G12', 'H3', 'W', 'Hsrv', 'Hrun']:
    r = res[k]; m = cell(r, 'main'); p = cell(r, 'pr')
    if k == 'M0': pre = '++ '
    elif k in ('Hsrv', 'Hrun'): pre = '== '
    elif not r['main']['failed'] and r['pr']['failed']: pre = '++ '
    else: pre = '.. '
    lines.append(pre + f"{k:<6}{desc[k]:<58}{m:<13}{p:<13}{why.get(k, '')}")
lines += ['',
  '++ 7 mutants survive main\'s 7-case suite and each fails exactly one case of this PR\'s 8-case suite (green rows)',
  '== D1/D2 (original #12713 defects) still fail on both suites; D2 now also fails the new empty case',
  '== grey rows: removing one of the three /health requireAuth sites leaves /health at 401, so both suites pass by design',
  '== every row ran main\'s test file and then this PR\'s test file against the same mutated bundle;',
  '== dist/ restored and re-hashed afterwards: identical to its 1316-file SHA-256 manifest']
render('Bundle mutants: main\'s 7-case suite vs this PR\'s 8-case suite on the same mutated dist/',
       'npm run test:integration:hosted:sandbox:none (focused config); ' + SUB, lines, OUT + '02-bundle-mutants.png', size=22)

# 3. Guard mutants
g = json.load(open(SP + 'guard/results.json'))
lines = ['== ' + f"{'id':<5}{'mutation':<66}{'result':<10}{'failing guard'}", '']
for r in g:
    t = r['failed'][0][0] if r['failed'] else ''
    fail = ('smoke-title guard' if 'portable smoke filter' in t else 'Java lane / POM guard' if 'real MySQL separate' in t
            else 'no-AK gate / classifier guard' if 'packaged suite on relevant' in t else 'sweeper: Hosted process root' if 'process root' in t
            else 'sweeper: Hosted Session Store root' if 'Session Store root' in t else t[:40])
    d = r['desc'].replace("fifth trigger glob packages/cli/src/config/** dropped (pull_request only)", "trigger glob packages/cli/src/config/** dropped (PR event)").replace(" to ManagedAgentMySqlIT", "")
    if r['id'] == 'C0': pre = '++ '; res_s = f"{r['total']}/{r['total']} pass"
    elif r['verdict'] == 'KILLED': pre = '++ '; res_s = 'killed'
    else: pre = '!! '; res_s = 'SURVIVED'
    if r['id'] == 'X1': lines.append('')
    lines.append(pre + f"{r['id']:<5}{d[:64]:<66}{res_s:<10}{fail}")
lines += ['',
  '++ C1-C10: every mutant in the PR\'s guard matrix fails exactly one guard (C9/C10 via globalSetup.test.ts sweeper cases)',
  '++ X1: a commented-out exclude is caught (the guard strips XML comments first)',
  '!! X2/X3: author\'s deferred D1 reproduced; narrowing via <includes> or MAVEN_ARGS is not seen by the command-line check',
  '!! X5: describe.skip around the suite passes the guard, and the gate then reports 8 skipped with exit 0',
  '== X4: a third "portable startup:" case trips the exact-count pin (deliberate, but it needs a guard edit)']
render('Workflow / POM / sweeper guard mutants',
       'scripts/tests/hosted-process-ci.test.js and integration-tests/globalSetup.test.ts in a separate worktree at the same merge commit; files restored by git checkout',
       lines, OUT + '03-guard-mutants.png', size=22)

# 4. Java lanes + CI
lines = [
 '== local, CI step commands verbatim (only DB host ports and a private Maven repo differ); docker mysql:8.4 (8.4.11), mariadb:10.11.18, JDK 21.0.12',
 '',
 '== ' + f"{'run':<5}{'POM':<6}{'lane / command':<48}{'integration tests selected':<60}{'result'}",
 '++ ' + f"{'J1':<5}{'PR':<6}{'Hosted: -Phosted-harness-mysql (no -Dit.test)':<48}{'HostedHarnessMySqlIT':<60}{'98 unit + 1 IT, 0 Checkstyle'}",
 '++ ' + f"{'J2':<5}{'PR':<6}{'MariaDB: -Pmysql-integration':<48}{'ManagedAgentMySqlIT':<60}{'98 unit + 9 IT, 0 Checkstyle'}",
 '',
 '== routing probes: temporary HostedZzzProbeIT + ZzzRoutingProbeIT added (unit tests skipped)',
 '++ ' + f"{'J3':<5}{'PR':<6}{'Hosted':<48}{'HostedHarnessMySqlIT, HostedZzzProbeIT':<60}{'2 IT'}",
 '++ ' + f"{'J4':<5}{'PR':<6}{'MariaDB':<48}{'ManagedAgentMySqlIT, ZzzRoutingProbeIT':<60}{'10 IT'}",
 '-- ' + f"{'J5':<5}{'main':<6}{'Hosted: -Dit.test=HostedHarnessMySqlIT':<48}{'HostedHarnessMySqlIT (probe never runs)':<60}{'1 IT'}",
 '-- ' + f"{'J6':<5}{'main':<6}{'MariaDB':<48}{'ManagedAgentMySqlIT, ZzzRoutingProbeIT, HostedZzzProbeIT':<60}{'11 IT'}",
 '-- ' + f"{'J7':<5}{'main':<6}{'Hosted without -Dit.test':<48}{'HostedHarnessMySqlIT (probe never runs)':<60}{'1 IT'}",
 '',
 '== official CI on d467f82c',
 '++ Hosted no-tool / MySQL 8.4 job: "maven cache is not found" (cold), verify step 39 s of 5 min; IT = HostedHarnessMySqlIT on 8.4.6',
 '++ MariaDB job: 98 unit + ManagedAgentMySqlIT 9/9;  required no-AK gate (ECS runner): 28 files, 213/213, Hosted file 8/8',
 '++ scheduled run 36265809340 (d6f414190a): portable smoke 2 passed + 5 skipped on macos-latest and on ecs-qwen-runner-win-hk-3',
 '',
 '== local Hosted suite (this machine): focused config 8/8, default integration config 8/8, -t "portable startup" 2 pass + 6 skipped',
 '!! -t "portable smoke" (no match): 8 skipped, exit 0 -- the silent no-op the new title guard exists for',
]
render('Java lane routing (PR POM vs main POM) and CI evidence',
       'Under main\'s POM a second Hosted IT lands in the MariaDB lane and never reaches MySQL; under this PR it runs only in the MySQL lane',
       lines, OUT + '04-java-routing-ci.png', size=22)
