#!/usr/bin/env python3
"""PR 17858 verify harness: A/B the workspace-settings ru/zh coverage gate.

Arms differ only by packages/web-shell/client/settings/messages.ts:
  base = blob 1a79c995d95... (== current main)
  head = blob 14fdb346e93... (PR head)
Every other gate input is byte-identical between the arms (see
files/gate-inputs.json: identical to current main too).

Scripted assertions only; prints PASS/FAIL per check and exits nonzero on an
unexpected outcome. The base arm's red is an EXPECTED control and is asserted
as such, so it counts as a pass.
"""
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys

ART = os.path.dirname(os.path.abspath(__file__))
VITEST = '/root/git/qwen-code-c1/node_modules/.bin/vitest'
PASS = 0
FAIL = 0


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'PASS  {name}' + (f'  [{detail}]' if detail else ''))
    else:
        FAIL += 1
        print(f'FAIL  {name}' + (f'  [{detail}]' if detail else ''))


def blob_sha(path):
    data = open(path, 'rb').read()
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


def run_vitest(arm, config, json_out):
    cwd = os.path.join(ART, 'run', arm)
    proc = subprocess.run(
        [VITEST, 'run', '--config', config, '--reporter=json',
         f'--outputFile={json_out}'],
        cwd=cwd, text=True, capture_output=True, timeout=300)
    return proc


def load_results(path):
    data = json.load(open(path))
    results = []
    for f in data.get('testResults', []):
        for a in f.get('assertionResults', []):
            name = (a.get('fullName') or a.get('title') or '')
            results.append({
                'name': name.replace(' > ', ' '),
                'status': a.get('status'),
                'messages': a.get('failureMessages') or [],
            })
    return data, results


art_path = ART
print('== provenance ==')
head_msg = os.path.join(art_path, 'run/head/packages/web-shell/client/settings/messages.ts')
base_msg = os.path.join(art_path, 'run/base/packages/web-shell/client/settings/messages.ts')
check('head messages.ts is PR head blob 14fdb346e93',
      blob_sha(head_msg) == '14fdb346e933574d8398bef44b0a76028481b1b0',
      blob_sha(head_msg)[:12])
check('base messages.ts is PR base blob 1a79c995d95',
      blob_sha(base_msg) == '1a79c995d950646e23027d5ff5bb2b8aebbc5e62',
      blob_sha(base_msg)[:12])
real = os.path.join(art_path, 'run/head/packages/cli/src/serve/routes/workspace-settings.ts')
check('workspace-settings.ts under test is head blob ca7bdc524fb9',
      blob_sha(real) == 'ca7bdc524fb964e46dd2e0e7419ed81afa6617cd',
      blob_sha(real)[:12])
for rel, sha in [
    ('run/head/packages/cli/src/serve/routes/workspace-settings-i18n.test.ts',
     'd933ea8fe41b35ed950c20caeaf41c58effe6528'),
    ('run/head/packages/cli/src/config/settingsUtils.ts',
     'be6875b3f2828127e687fb5986991ae8b62aee4d'),
    ('run/head/packages/cli/src/config/settingsSchema.ts',
     'fcb3d95015573795163dbaa6c403746069011c5d'),
    ('run/head/packages/cli/src/i18n/languages.ts',
     'bd597f86c487d98d01167796f63e1b5ed5ef6197'),
]:
    got = blob_sha(os.path.join(art_path, rel))
    check(f"{os.path.basename(rel)} is the head blob", got == sha, got[:12])

print('\n== PR shape ==')
meta = json.load(open(os.path.join(art_path, 'files/pr-meta.json')))
files = meta['files']
check('PR touches exactly 1 file', len(files) == 1, f'{len(files)} file(s)')
if files:
    f = files[0]
    check('the file is packages/web-shell/client/settings/messages.ts',
          f['path'] == 'packages/web-shell/client/settings/messages.ts', f['path'])
    check('diff is +6 / -0', f['additions'] == 6 and f['deletions'] == 0,
          f"+{f['additions']} / -{f['deletions']}")

base_lines = open(base_msg, encoding='utf-8').read().splitlines()
head_lines = open(head_msg, encoding='utf-8').read().splitlines()
diff = list(difflib.unified_diff(base_lines, head_lines, lineterm=''))
added = [l for l in diff if l.startswith('+') and not l.startswith('+++')]
removed = [l for l in diff if l.startswith('-') and not l.startswith('---')]
check('byte-level diff adds exactly 6 lines and removes none',
      len(added) == 6 and len(removed) == 0,
      f'+{len(added)} / -{len(removed)}')

print('\n== A/B: the real gate test (vitest) ==')
head_proc = run_vitest('head', 'vitest.config.mjs', os.path.join(art_path, 'head-gate.json'))
base_proc = run_vitest('base', 'vitest.config.mjs', os.path.join(art_path, 'base-gate.json'))
open(os.path.join(art_path, 'head-gate.stdout.log'), 'w').write(head_proc.stdout + head_proc.stderr)
open(os.path.join(art_path, 'base-gate.stdout.log'), 'w').write(base_proc.stdout + base_proc.stderr)

# The JSON reporter omits the visual diff, so take the human-readable base
# output too: it carries the missing-key list a reader sees.
base_verbose = subprocess.run(
    [VITEST, 'run', '--config', 'vitest.config.mjs'],
    cwd=os.path.join(ART, 'run', 'base'), text=True, capture_output=True, timeout=300)
base_verbose_text = base_verbose.stdout + base_verbose.stderr
open(os.path.join(art_path, 'base-gate.verbose.log'), 'w').write(base_verbose_text)

head_data, head_res = load_results(os.path.join(art_path, 'head-gate.json'))
base_data, base_res = load_results(os.path.join(art_path, 'base-gate.json'))
check('head: vitest exits 0', head_proc.returncode == 0, f'rc={head_proc.returncode}')
check('head: 5/5 gate tests pass',
      len(head_res) == 5 and all(r['status'] == 'passed' for r in head_res),
      f"{sum(r['status'] == 'passed' for r in head_res)}/{len(head_res)}")
check('base: vitest exits nonzero (expected control)', base_proc.returncode != 0,
      f'rc={base_proc.returncode}')
check('base: exactly 1 of 5 gate tests fails',
      len(base_res) == 5 and sum(r['status'] == 'failed' for r in base_res) == 1,
      f"{sum(r['status'] == 'failed' for r in base_res)}/{len(base_res)} failed")

ru_test = "Web Shell settings 'ru' coverage every served setting has label and description entries"
base_fail = [r for r in base_res if r['status'] == 'failed']
check('base: the failing test is the ru label/description coverage case',
      len(base_fail) == 1 and base_fail[0]['name'] == ru_test,
      base_fail[0]['name'] if base_fail else 'none')

missing = sorted(set(re.findall(
    r'"(settings\.(?:label|description)\.[^"]+)"', base_verbose_text)))
expected_missing = sorted([
    'settings.label.experimental.mods',
    'settings.description.experimental.mods',
    'settings.label.visionBridgeTimeoutMs',
    'settings.description.visionBridgeTimeoutMs',
])
check('base: failure names exactly the 4 entries the PR adds',
      missing == expected_missing, ', '.join(missing))
check('base: assertion message reports 4 missing entries',
      bool(base_fail) and '(4)' in ''.join(base_fail[0]['messages']),
      ''.join(base_fail[0]['messages'])[:60] if base_fail else 'none')

zh_name = "Web Shell settings 'zh-CN' coverage every served setting has label and description entries"
zh_base = [r for r in base_res if r['name'] == zh_name]
check('base: zh-CN coverage already passes (gate is not globally red)',
      len(zh_base) == 1 and zh_base[0]['status'] == 'passed',
      zh_base[0]['status'] if zh_base else 'missing')

print('\n== served-key census ==')
census_proc = subprocess.run(
    [VITEST, 'run', '--config', 'census.config.mjs', '--reporter=json',
     f"--outputFile={os.path.join(art_path, 'census.json')}"],
    cwd=os.path.join(ART, 'run', 'head'), text=True, capture_output=True, timeout=300)
open(os.path.join(art_path, 'census.stdout.log'), 'w').write(census_proc.stdout + census_proc.stderr)
_, census_res = load_results(os.path.join(art_path, 'census.json'))
check('census: getAllowedKeys(true) includes both settings, test passes',
      len(census_res) == 1 and census_res[0]['status'] == 'passed',
      census_res[0]['status'] if census_res else 'missing')
census = json.load(open(os.path.join(ART, 'run', 'head', 'census-out.json')))
check('census: served key count recorded', isinstance(census.get('count'), int),
      f"{census.get('count')} keys, mods={census.get('hasMods')}, "
      f"vision={census.get('hasVision')}")

print('\n== translation table integrity ==')
head_src = open(head_msg, encoding='utf-8').read()
base_src = open(base_msg, encoding='utf-8').read()


def locale_keys(src, name, stop=None):
    block = src.split(f'export const {name}', 1)[1]
    if stop:
        block = block.split(f'export const {stop}', 1)[0]
    return re.findall(r"'(settings\.(?:label|description|category)\.[^']+)':", block)


zh_head = set(locale_keys(head_src, 'SETTINGS_MESSAGES_ZH', 'SETTINGS_MESSAGES_RU'))
ru_head = set(locale_keys(head_src, 'SETTINGS_MESSAGES_RU'))
zh_base = set(locale_keys(base_src, 'SETTINGS_MESSAGES_ZH', 'SETTINGS_MESSAGES_RU'))
ru_base = set(locale_keys(base_src, 'SETTINGS_MESSAGES_RU'))
check('head: zh-CN and ru settings tables cover the same 171 keys',
      len(zh_head) == 171 and len(ru_head) == 171 and zh_head == ru_head,
      f'zh={len(zh_head)} ru={len(ru_head)}')
check('base: ru table is exactly the 4 PR entries behind zh-CN',
      len(zh_base) == 171 and len(ru_base) == 167 and (zh_base - ru_base) == set(expected_missing),
      f'zh={len(zh_base)} ru={len(ru_base)}')

ru_block = head_src.split('export const SETTINGS_MESSAGES_RU', 1)[1]
keys = re.findall(r"'(settings\.(?:label|description|category)\.[^']+)':", ru_block)
import collections
dups = [k for k, c in collections.Counter(keys).items() if c > 1]
check('RU table has no duplicate keys', dups == [], ', '.join(dups[:5]))
for k in expected_missing:
    check(f'RU table defines {k} exactly once', keys.count(k) == 1, str(keys.count(k)))

print('\n== source sanity ==')
esbuild = '/root/git/qwen-code-c1/node_modules/.bin/esbuild'
parse = subprocess.run([esbuild, '--loader:.ts=ts', '--log-level=warning', head_msg],
                       capture_output=True, text=True)
check('head messages.ts parses as TypeScript', parse.returncode == 0)
prettier = '/root/git/qwen-code-c1/node_modules/.bin/prettier'
fmt = subprocess.run([prettier, '--check', head_msg], capture_output=True, text=True)
check('head messages.ts passes Prettier', fmt.returncode == 0,
      (fmt.stdout + fmt.stderr).strip().splitlines()[-1] if fmt.returncode else '')

print('\n== merge-target stability ==')
gi = json.load(open(os.path.join(art_path, 'files/gate-inputs.json')))
msg_path = 'packages/web-shell/client/settings/messages.ts'
for p, v in gi.items():
    if p == msg_path:
        check('merge target: messages.ts differs (this is the change under test)', not v['same'])
    else:
        check(f"merge target: {os.path.basename(p)} identical on main and head", v['same'],
              v['main'][:12])

total = PASS + FAIL
print(f'\nASSERTIONS pass={PASS} fail={FAIL} total={total}')
json.dump({'pass': PASS, 'fail': FAIL, 'total': total},
          open(os.path.join(art_path, 'assertions.json'), 'w'), indent=2)
sys.exit(1 if FAIL else 0)
