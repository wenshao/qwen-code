#!/usr/bin/env python3
"""Sequential in-place mutation sweep for PR #13013's witness tests.

Each mutant: back up the target file(s), apply one textual edit, run the two
witness files with the JSON reporter, restore from the byte-exact backup
(never `git checkout`), and assert the sha256 matches the pristine copy.
"""
import hashlib, json, os, shutil, subprocess, sys

ROOT = '/root/verify/pr13013/pr'
BASE = '/root/verify/pr13013/base'
OUT = '/root/verify/pr13013/out/mutants'
os.makedirs(OUT, exist_ok=True)

CLI = 'integration-tests/test-helper.ts'
SDK = 'integration-tests/sdk-typescript/test-helper.ts'
DEF = 'integration-tests/e2e-memory-defaults.ts'

CLI_MEM = "      memory: { ...E2E_MEMORY_SETTINGS_DEFAULTS, ...memorySettings },\n"
SDK_MEM = "        memory: { ...E2E_MEMORY_SETTINGS_DEFAULTS, ...memorySettings },\n"

def sub(old, new, count=1):
    def f(text):
        assert text.count(old) >= 1, f'anchor not found: {old!r}'
        return text.replace(old, new, count)
    return f

def from_base(path):
    def f(_text):
        return open(os.path.join(BASE, path)).read()
    return f

MUTANTS = [
    ('M0 control (no edit)', []),
    ('M1 shared default enableManagedAutoMemory -> true',
     [(DEF, sub('enableManagedAutoMemory: false', 'enableManagedAutoMemory: true'))]),
    ('M2 shared default enableManagedAutoDream -> true',
     [(DEF, sub('enableManagedAutoDream: false', 'enableManagedAutoDream: true'))]),
    ('M3 TestRig drops the memory default (CLI line deleted)',
     [(CLI, sub(CLI_MEM, ''))]),
    ('M4 SDKTestHelper drops the memory default (SDK line deleted)',
     [(SDK, sub(SDK_MEM, ''))]),
    ('M5 TestRig merge order flipped (defaults beat suite override)',
     [(CLI, sub(CLI_MEM, CLI_MEM.replace('...E2E_MEMORY_SETTINGS_DEFAULTS, ...memorySettings', '...memorySettings, ...E2E_MEMORY_SETTINGS_DEFAULTS')))]),
    ('M6 SDKTestHelper merge order flipped',
     [(SDK, sub(SDK_MEM, SDK_MEM.replace('...E2E_MEMORY_SETTINGS_DEFAULTS, ...memorySettings', '...memorySettings, ...E2E_MEMORY_SETTINGS_DEFAULTS')))]),
    ('M7 TestRig shallow replace (suite memory object wins wholesale)',
     [(CLI, sub(CLI_MEM, "      memory: Object.keys(memorySettings).length ? memorySettings : E2E_MEMORY_SETTINGS_DEFAULTS,\n"))]),
    ('M8 SDKTestHelper shallow replace',
     [(SDK, sub(SDK_MEM, "        memory: Object.keys(memorySettings).length ? memorySettings : E2E_MEMORY_SETTINGS_DEFAULTS,\n"))]),
    ('M9 TestRig default placed before the suite spread',
     [(CLI, lambda t: sub(CLI_MEM, '')(t).replace(
         "      ...options.settings, // Allow tests to override/add settings\n",
         "      memory: { ...E2E_MEMORY_SETTINGS_DEFAULTS },\n      ...options.settings, // Allow tests to override/add settings\n"))]),
    ('NC negative control: both harnesses reverted to merge-base 6b66321a5a',
     [(CLI, from_base(CLI)), (SDK, from_base(SDK))]),
]

def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()

env = {k: v for k, v in os.environ.items() if k.lower() not in (
    'http_proxy', 'https_proxy', 'all_proxy')}
env.update(CI='true', QWEN_SANDBOX='false', FORCE_COLOR='0')

rows = []
for idx, (label, edits) in enumerate(MUTANTS):
    pristine = {}
    for path, _ in edits:
        full = os.path.join(ROOT, path)
        pristine[path] = (open(full, 'rb').read(), sha(full))
    try:
        for path, fn in edits:
            full = os.path.join(ROOT, path)
            text = open(full).read()
            new = fn(text)
            assert new != text, f'{label}: edit was a no-op'
            tmp = full + '.mut'
            open(tmp, 'w').write(new)
            os.replace(tmp, full)
        report = os.path.join(OUT, f'm{idx:02d}.json')
        subprocess.run(
            ['npx', 'vitest', 'run', '--root', './integration-tests',
             '--reporter=json', f'--outputFile={report}', '--retry=0',
             'test-helper.test.ts', 'sdk-typescript/test-helper.test.ts'],
            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        data = json.load(open(report))
        failed = []
        for f in data['testResults']:
            for a in f['assertionResults']:
                if a['status'] != 'passed':
                    failed.append(f"{os.path.relpath(f['name'], ROOT + '/integration-tests')} :: {a['title']}")
        witness_fail = [x for x in failed if 'managed auto-memory' in x or 'opt back in' in x or 'managed memory' in x]
        rows.append({'mutant': label, 'failed': failed,
                     'verdict': 'control-green' if idx == 0 and not failed else ('KILLED' if failed else 'SURVIVED')})
    finally:
        for path, (blob, digest) in pristine.items():
            full = os.path.join(ROOT, path)
            open(full + '.rst', 'wb').write(blob)
            os.replace(full + '.rst', full)
            assert sha(full) == digest, f'restore mismatch {path}'

status = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT,
                        capture_output=True, text=True).stdout
json.dump(rows, open(os.path.join(OUT, 'summary.json'), 'w'), indent=2)
for r in rows:
    print(f"{r['verdict']:14} {r['mutant']}")
    for x in r['failed']:
        print(f"{'':16}- {x}")
print('git status (tracked) after sweep:', repr(status))
