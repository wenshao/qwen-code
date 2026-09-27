# Workflow/POM/sweeper guard mutants, run in a separate worktree (wt-guard).
import os, subprocess, json, sys
SP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WT = os.path.join(SP, 'wt-guard')
env = dict(os.environ)
env['PATH'] = os.path.expanduser('~/.local/share/fnm/node-versions/v22.23.2/installation/bin') + ':' + env['PATH']

CI = '.github/workflows/ci.yml'
JAVA = '.github/workflows/sdk-java.yml'
POM = 'packages/sdk-java/managed-agent-server/pom.xml'
TEST = 'integration-tests/cli/hosted-harness-process.test.ts'
CLS = '.github/scripts/ci/classify-profile.mjs'
SCR = 'integration-tests/scratch-dir.ts'
MARIA_RUN = "-Pmysql-integration\n          -Dmysql.url='jdbc:mysql://127.0.0.1:3306/managed_agent_test"
PR_TRIG = "      - 'packages/cli/src/config/**'\n      - 'packages/core/src/config/**'"
HOSTED_PROFILE_FAILSAFE = "<includes>\n                                <include>**/Hosted*IT.java</include>\n                            </includes>"

GUARD = 'scripts/tests/hosted-process-ci.test.js'
SWEEP = 'integration-tests/globalSetup.test.ts'

M = [
  ('C0', 'no mutation (control)', GUARD, []),
  ('C1', 'smoke titles renamed (portable startup: -> portable smoke:)', GUARD, [(TEST, "'portable startup:", "'portable smoke:", 2)]),
  ('C2', 'Hosted job narrows again: -Dit.test=HostedHarnessMySqlIT', GUARD, [(JAVA, '-Phosted-harness-mysql\n', '-Phosted-harness-mysql -Dit.test=HostedHarnessMySqlIT\n', 1)]),
  ('C3', 'MariaDB job narrows: -Dit.test=ManagedAgentMySqlIT', GUARD, [(JAVA, MARIA_RUN, MARIA_RUN.replace('-Pmysql-integration', '-Pmysql-integration -Dit.test=ManagedAgentMySqlIT'), 1)]),
  ('C4', 'POM exclude back to single class name', GUARD, [(POM, '<exclude>**/Hosted*IT.java</exclude>', '<exclude>**/HostedHarnessMySqlIT.java</exclude>', 1)]),
  ('C5', 'POM include back to single class name', GUARD, [(POM, '<include>**/Hosted*IT.java</include>', '<include>**/HostedHarnessMySqlIT.java</include>', 1)]),
  ('C6', "fifth trigger glob packages/cli/src/config/** dropped (pull_request only)", GUARD, [(JAVA, PR_TRIG, "      - 'packages/core/src/config/**'", 2, 1)]),
  ('C7', 'Hosted helper reclassified as github_ci_only', GUARD, [(CLS, "  '.github/actionlint.yaml',", "  '.github/actionlint.yaml',\n  'integration-tests/helpers/hosted-harness-process.ts',", 1)]),
  ('C8', 'classifier never returns docs_only', GUARD, [(CLS, 'if (isDocsOnlyFile(file)) return CI_PROFILES.DOCS_ONLY;', '', 1)]),
  ('C9', 'Hosted root prefix leaves qwen-e2e-home-', SWEEP, [(SCR, "HOSTED_HOME_PREFIX = 'qwen-e2e-home-hosted-'", "HOSTED_HOME_PREFIX = 'hosted-no-tool-'", 1)]),
  ('C10', 'Store root prefix leaves qwen-e2e-home-', SWEEP, [(SCR, "HOSTED_STORE_PREFIX = 'qwen-e2e-home-hosted-store-'", "HOSTED_STORE_PREFIX = 'hosted-store-'", 1)]),
  # Extra probes (not in the PR's matrix)
  ('X1', 'exclude only commented out (<!-- ... -->) in MariaDB profile', GUARD, [(POM, '<exclude>**/Hosted*IT.java</exclude>', '<!-- <exclude>**/Hosted*IT.java</exclude> -->', 1)]),
  ('X2', 'D1: <includes> narrows the MariaDB profile to ManagedAgentMySqlIT', GUARD, [(POM, '<excludes>\n', '<includes><include>**/ManagedAgentMySqlIT.java</include></includes>\n                            <excludes>\n', 1)]),
  ('X3', 'D1: -Dit.test via MAVEN_ARGS on the MariaDB step', GUARD, [(JAVA, "toolchains.xml'\n        run: >-\n          mvn --batch-mode --no-transfer-progress " + MARIA_RUN, "toolchains.xml -Dit.test=ManagedAgentMySqlIT'\n        run: >-\n          mvn --batch-mode --no-transfer-progress " + MARIA_RUN, 1)]),
  ('X4', 'third portable-startup case added', GUARD, [(TEST, "    it('portable startup: refuses", "    it('portable startup: extra', () => {});\n\n    it('portable startup: refuses", 1)]),
  ('X5', 'Hosted suite wrapped in describe.skip', GUARD, [(TEST, 'describe(\n', 'describe.skip(\n', 1)]),
]

def run(target, label):
    out = os.path.join(SP, 'guard', f'{label}.json')
    cmd = (['npx', 'vitest', 'run', '--config', './scripts/tests/vitest.config.ts', target] if target == GUARD
           else ['npx', 'vitest', 'run', '--root', './integration-tests', 'globalSetup.test.ts'])
    p = subprocess.run(cmd + ['--reporter=json', f'--outputFile={out}'], cwd=WT, env=env, capture_output=True, text=True, timeout=600)
    try:
        r = json.load(open(out))
        tests = [(a['title'], a['status'], (a.get('failureMessages') or [''])[0].split('\n')[0][:150]) for tr in r['testResults'] for a in tr['assertionResults']]
    except Exception as e:
        tests = [('RUNNER', 'failed', str(e) + p.stdout[-300:] + p.stderr[-300:])]
    return p.returncode, tests

rows = []
for mid, desc, target, edits in M:
    touched = []
    try:
        ok = True
        for e in edits:
            f, old, new, want = e[:4]; limit = e[4] if len(e) > 4 else -1
            path = os.path.join(WT, f); s = open(path, encoding='utf-8').read()
            n = s.count(old)
            if n != want:
                print(f'{mid}: anchor hits {n} != {want} in {f}', flush=True); ok = False; break
            open(path, 'w', encoding='utf-8').write(s.replace(old, new, limit)); touched.append(f)
        if not ok: continue
        code, tests = run(target, mid)
        failed = [t for t in tests if t[1] != 'passed' and t[1] != 'skipped']
        verdict = 'KILLED' if code != 0 else 'SURVIVED'
        print(f'{mid} {verdict} exit={code} failed={len(failed)}/{len(tests)} :: {desc}', flush=True)
        for t in failed: print(f'     x {t[0][:70]} | {t[2]}', flush=True)
        rows.append({'id': mid, 'desc': desc, 'verdict': verdict, 'exit': code, 'failed': failed, 'total': len(tests)})
    finally:
        if touched: subprocess.run(['git', 'checkout', '--'] + sorted(set(touched)), cwd=WT)
json.dump(rows, open(os.path.join(SP, 'guard', 'results.json'), 'w'), indent=1)
print(subprocess.run(['git', 'status', '--short'], cwd=WT, capture_output=True, text=True).stdout or 'wt-guard clean')
