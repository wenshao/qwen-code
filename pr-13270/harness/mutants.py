#!/usr/bin/env python3
"""Targeted mutants of PR #13270's production lines, each run against the PR's
own tests in an isolated copy of .github/ + scripts/ (the worktree is never
touched). A mutant is KILLED when at least one PR test fails."""
import json, os, re, shutil, subprocess, sys

WT = '/root/git/qwen-code-pr13270'
SP = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SP, 'mut')

Q = "''"  # YAML-escaped single quote inside runs-on strings
MUTANTS = [
    ('M01', 'codeql gate: != success -> == failure (the failure()-only class)', '.github/workflows/codeql.yml',
     "needs.codeql.result != 'success'", "needs.codeql.result == 'failure'"),
    ('M02', 'codeql gate: drop always()', '.github/workflows/codeql.yml',
     "always() && ", ""),
    ('M03', 'codeql gate: drop the schedule-only clause', '.github/workflows/codeql.yml',
     " && github.event_name == 'schedule'", ""),
    ('M04', 'codeql report job: drop issues: write', '.github/workflows/codeql.yml',
     "      issues: 'write'\n", ""),
    ('M05', 'codeql job name: drop the parenthesised leg suffix', '.github/workflows/codeql.yml',
     "name: 'CodeQL (${{ matrix.language }})'", "name: 'CodeQL ${{ matrix.language }}'"),
    ('M06', 'reporter: stop naming cancelled legs', '.github/scripts/codeql-failure-issue.sh',
     ' or .conclusion == "cancelled"', ''),
    ('M07', 'reporter: drop the dedup label on create', '.github/scripts/codeql-failure-issue.sh',
     "  --label 'type/bug' \\\n  --label \"${DEDUP_LABEL}\"", "  --label 'type/bug'"),
    ('M08', 'reporter: comment path removed (always create)', '.github/scripts/codeql-failure-issue.sh',
     'if [[ -n "${existing}" ]]; then', 'if false; then'),
    ('M09', 'serve-ab: budget back to the 10s default', '.github/scripts/serve-ab-drive.mjs',
     'export const INITIALIZE_TIMEOUT_MS = 60_000;', 'export const INITIALIZE_TIMEOUT_MS = 10_000;'),
    ('M10', 'serve-ab: flag dropped from serveArgs', '.github/scripts/serve-ab-drive.mjs',
     "    '--initialize-timeout-ms',\n    String(INITIALIZE_TIMEOUT_MS),\n", ''),
    ('M11', 'tui-parity parity: same-repo clause dropped', '.github/workflows/tui-parity.yml',
     "github.event.pull_request.head.repo.full_name == github.repository || ", "", 1),
    ('M12', 'tui-parity noflicker: write-access clause dropped', '.github/workflows/tui-parity.yml',
     f"|| contains(fromJSON({Q}[\"OWNER\",\"MEMBER\",\"COLLABORATOR\"]{Q}), github.event.pull_request.author_association)", "", 2),
    ('M13', 'flyway: kill-switch clause dropped', '.github/workflows/sdk-java.yml',
     f"vars.MAINTAINER_ECS_RUNNER_DISABLED != {Q}true{Q} && ", "", 'after:  flyway-migrations:'),
    ('M14', 'assign: guards pull_request instead of pull_request_target (forks reach the pool)', '.github/workflows/assign-pr-owner.yml',
     f"github.event_name != {Q}pull_request_target{Q}", f"github.event_name != {Q}pull_request{Q}"),
    ('M15', 'assign: ownership restore moved after checkout', '.github/workflows/assign-pr-owner.yml', None, None),
    ('M16', 'tui-parity parity: setup-node runs on the pool too', '.github/workflows/tui-parity.yml',
     "      - uses: 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e' # v6.4.0\n        if: \"${{ runner.environment == 'github-hosted' }}\"\n",
     "      - uses: 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e' # v6.4.0\n", 1),
    ('M17', 'tui-parity noflicker: disk-floor gate removed', '.github/workflows/tui-parity.yml',
     "      - name: 'Disk floor gate (self-hosted)'\n        if: \"${{ runner.environment == 'self-hosted' }}\"\n        run: 'bash .github/scripts/check-disk-floor.sh \"${GITHUB_WORKSPACE}\" \"${RUNNER_TEMP:-/tmp}\"'\n", "", 2),
    ('M18', 'codeql report job: moved onto the ECS pool', '.github/workflows/codeql.yml',
     "    needs: ['codeql']\n    if: \"${{ always() && github.repository == 'QwenLM/qwen-code' && github.event_name == 'schedule' && needs.codeql.result != 'success' }}\"\n    runs-on: 'ubuntu-latest'",
     "    needs: ['codeql']\n    if: \"${{ always() && github.repository == 'QwenLM/qwen-code' && github.event_name == 'schedule' && needs.codeql.result != 'success' }}\"\n    runs-on: ['self-hosted', 'linux', 'x64', 'ecs-qwen']"),
    ('M19', 'noflicker: per-runner OUT dropped (back to the shared /tmp default)', '.github/workflows/tui-parity.yml',
     "        env:\n          # The script's default report dir is a fixed /tmp path, which\n          # concurrent runs on one ECS host would share.\n          OUT: '${{ runner.temp }}/opentui-noflicker-out'\n", ''),
    ('M20', 'noflicker: OUT pinned to the shared /tmp path explicitly', '.github/workflows/tui-parity.yml',
     "OUT: '${{ runner.temp }}/opentui-noflicker-out'", "OUT: '/tmp/opentui-noflicker-out'"),
]


def replace_nth(text, old, new, nth):
    """nth: None = must be unique; k = replace the k-th occurrence (1-based);
    'after:<anchor>' = first occurrence after the anchor."""
    if isinstance(nth, str) and nth.startswith('after:'):
        a = text.index(nth[6:])
        i = text.index(old, a)
        return text[:i] + new + text[i + len(old):]
    count = text.count(old)
    if nth is None:
        assert count == 1, f'expected 1 occurrence, found {count}: {old!r}'
        return text.replace(old, new)
    assert count >= nth, f'expected >= {nth} occurrences, found {count}'
    idx = -1
    for _ in range(nth):
        idx = text.index(old, idx + 1)
    return text[:idx] + new + text[idx + len(old):]


def make_tree(d):
    if os.path.exists(d):
        shutil.rmtree(d)
    os.makedirs(d)
    for sub in ('.github', 'scripts'):
        shutil.copytree(os.path.join(WT, sub), os.path.join(d, sub), symlinks=True)
    shutil.copy(os.path.join(WT, 'package.json'), d)
    os.symlink(os.path.join(WT, 'node_modules'), os.path.join(d, 'node_modules'))
    # sdk-java-workflow.test.js scans packages/sdk-java for db/migration dirs.
    os.makedirs(os.path.join(d, 'packages'))
    os.symlink(os.path.join(WT, 'packages', 'sdk-java'), os.path.join(d, 'packages', 'sdk-java'))


def run_tests(d):
    node = subprocess.run(
        ['node', '--test', '.github/scripts/serve-ab-drive.test.mjs',
         '.github/scripts/ci-runner-routing.test.mjs', '.github/scripts/assign-pr-owner.test.mjs'],
        cwd=d, capture_output=True, text=True)
    m = re.search(r'^# fail (\d+)', node.stdout, re.M)
    node_fail = int(m.group(1)) if m else -1
    import_err = 'SyntaxError' in node.stdout
    vit = subprocess.run(
        ['npx', 'vitest', 'run', '--config', './scripts/tests/vitest.config.ts',
         'scripts/tests/codeql-workflow.test.js', 'scripts/tests/sdk-java-workflow.test.js'],
        cwd=d, capture_output=True, text=True, env={**os.environ, 'CI': 'true', 'NO_COLOR': '1'})
    m = re.search(r'Tests\s+(?:(\d+) failed)?', vit.stdout)
    vfail = int(m.group(1)) if m and m.group(1) else 0
    failed_names = re.findall(r'^\s*(?:not ok \d+ - (.+))$', node.stdout, re.M)
    vnames = re.findall(r'FAIL\s+\S+ > (.+)$', vit.stdout, re.M)
    return node.returncode, node_fail, import_err, vit.returncode, vfail, failed_names, vnames


results = []
which = sys.argv[1:] or [m[0] for m in MUTANTS] + ['M00']
for mid in which:
    d = os.path.join(OUT, mid)
    make_tree(d)
    if mid == 'M00':
        desc, path = 'unmutated control', None
    else:
        spec = next(m for m in MUTANTS if m[0] == mid)
        desc, path, old, new = spec[1], spec[2], spec[3], spec[4]
        nth = spec[5] if len(spec) > 5 else None
        p = os.path.join(d, path)
        text = open(p).read()
        if mid == 'M15':
            heal_start = text.index("      - name: 'Restore workspace ownership'")
            co_start = text.index("      - name: 'Checkout owner map'")
            heal = text[heal_start:co_start]
            co_end = text.index("      - name: 'Assign area owner'")
            checkout = text[co_start:co_end]
            mutated = text[:heal_start] + checkout + heal + text[co_end:]
        else:
            mutated = replace_nth(text, old, new, nth)
        assert mutated != text, mid
        os.unlink(p) if os.path.islink(p) else None
        open(p, 'w').write(mutated)
    nrc, nfail, imp, vrc, vfail, names, vnames = run_tests(d)
    killed = nrc != 0 or vrc != 0
    results.append({'id': mid, 'desc': desc, 'file': path, 'killed': killed,
                    'node_fail': nfail, 'node_import_error': imp, 'vitest_fail': vfail,
                    'first_failures': (names + vnames)[:4]})
    print(f"{mid} {'KILLED ' if killed else 'SURVIVED'} node_fail={nfail}{' (import error)' if imp else ''} vitest_fail={vfail}  {desc}", flush=True)
    shutil.rmtree(d)

json.dump(results, open(os.path.join(SP, os.environ.get('MUT_JSON','mutants.json')), 'w'), indent=2)
