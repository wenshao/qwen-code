import subprocess, shutil, os
WT = os.path.expanduser('~/git/qwen-code-pr12733')
env = dict(os.environ); env['PATH'] = os.path.expanduser('~/.local/share/fnm/node-versions/v22.23.2/installation/bin') + ':' + env['PATH']
CI = '.github/workflows/ci.yml'; JV = '.github/workflows/sdk-java.yml'; PK = 'package.json'
SMOKE = """      - name: 'Hosted portable process smoke'
        if: "${{ needs.classify_pr.outputs.skip_ci != 'true' }}"
        timeout-minutes: 5
        run: npm run test:integration:hosted:sandbox:none -- -t 'portable startup'

"""
MUT = [
 ('G1 drop Windows smoke step (2nd occurrence)', CI, SMOKE, '', 'last'),
 ('G2 smoke filter renamed', CI, "-t 'portable startup'", "-t 'portable startups'", 'all'),
 ('G3 MySQL verify step continue-on-error', JV, "      - name: 'Verify Hosted Java, Spring and MySQL processes'\n        timeout-minutes: 5\n", "      - name: 'Verify Hosted Java, Spring and MySQL processes'\n        continue-on-error: true\n        timeout-minutes: 5\n", 'all'),
 ('G4 MySQL image swapped to MariaDB', JV, "image: 'mysql:8.4.6'", "image: 'mariadb:11.4'", 'all'),
 ('G5 hosted file dropped from no-AK gate', PK, " ./cli/hosted-harness-process.test.ts", "", 'all'),
 ('G6 sdk-java paths lose packages/cli/src/serve/**', JV, "      - 'packages/cli/src/serve/**'\n", "", 'all'),
]
for name, f, old, new, mode in MUT:
    p = os.path.join(WT, f); src = open(p).read(); n = src.count(old)
    if n == 0: print(name, 'ANCHOR MISSING'); continue
    shutil.copy2(p, p + '.gbak')
    try:
        if mode == 'last':
            i = src.rfind(old); out = src[:i] + new + src[i+len(old):]
        else: out = src.replace(old, new)
        open(p, 'w').write(out)
        r = subprocess.run(['npx', 'vitest', 'run', '--config', './scripts/tests/vitest.config.ts', 'scripts/tests/hosted-process-ci.test.js', 'scripts/tests/no-ak-integration-ci.test.js'], cwd=WT, env=env, capture_output=True, text=True)
        import re
        summary = [l for l in re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr).splitlines() if re.search(r'^\s+Tests\s', l)]
        print(f"{name}: hits={n} exit={r.returncode} -> {'KILLED' if r.returncode else 'SURVIVED'} {summary}")
    finally:
        shutil.copy2(p + '.gbak', p); os.remove(p + '.gbak')
