#!/usr/bin/env python3
"""Publish round-4 evidence to wenshao/qwen-code@assets-pr12894 under pr12894/r4/.

Payloads are built in memory and piped to `gh api --input -` (never through
argv, which breaks past ~100 KB), and every upload is verified by comparing the
returned blob sha with the local `git hash-object` of the same bytes.
"""
import base64
import hashlib
import json
import os
import subprocess
import sys

ART = '/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039'
REPO = 'wenshao/qwen-code'
BRANCH = 'assets-pr12894'
PREFIX = 'pr12894/r4'
MAX = 400_000

files = []
for rel in sorted(os.listdir(f'{ART}/evidence')):
    files.append((f'{ART}/evidence/{rel}', f'{PREFIX}/{rel}'))
files.append((f'{ART}/report.md', f'{PREFIX}/report.md'))
files.append((f'{ART}/verdict.txt', f'{PREFIX}/verdict.txt'))
files.append((f'{ART}/assertions.json', f'{PREFIX}/assertions.json'))
for rel in sorted(os.listdir(f'{ART}/harness')):
    p = f'{ART}/harness/{rel}'
    if os.path.isfile(p):
        files.append((p, f'{PREFIX}/harness/{rel}'))
for rel in sorted(os.listdir(f'{ART}/harness/mut')):
    files.append((f'{ART}/harness/mut/{rel}', f'{PREFIX}/harness/mut/{rel}'))
keep = [
    's9-head.log', 's9-control.log', 's9b-head.log', 's9b-control.log',
    's9c-head.log', 's9c-control.log', 's9c-head-fix.json', 's9b-head.json',
    's9b-head-fix.json', 'mut4b.log', 'mut4-ts.log', 'mut4-m17.log',
    'mut4-m18.log', 'mut4-java.log', 'mut4-java-m12b.log', 'candidate-fix.log',
    'java-gate.log', 'cap01.txt', 'cap04.txt', 's9b-integrity.txt', 'maven.log',
    'mut-MB_stderrTailBytes=0.log',
]
for rel in keep:
    p = f'{ART}/results/{rel}'
    if os.path.isfile(p):
        files.append((p, f'{PREFIX}/results/{rel}'))
for rel in sorted(os.listdir(f'{ART}/results')):
    if rel.startswith('mut-') and rel.endswith('.log'):
        files.append((f'{ART}/results/{rel}', f'{PREFIX}/results/{rel}'))

seen = set()
ok = fail = skipped = 0
for local, remote in files:
    if remote in seen:
        continue
    seen.add(remote)
    data = open(local, 'rb').read()
    if len(data) > MAX:
        print(f'SKIP {remote} ({len(data)} bytes > {MAX})')
        skipped += 1
        continue
    local_sha = hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()
    payload = json.dumps({
        'message': f'test(pr12894): round-4 verification evidence ({os.path.basename(remote)})',
        'content': base64.b64encode(data).decode(),
        'branch': BRANCH,
    })
    r = subprocess.run(
        ['gh', 'api', '-X', 'PUT', f'repos/{REPO}/contents/{remote}', '--input', '-'],
        input=payload, capture_output=True, text=True)
    if r.returncode != 0:
        print(f'FAIL {remote}: {r.stderr.strip()[:200]}')
        fail += 1
        continue
    out = json.loads(r.stdout)
    remote_sha = out.get('content', {}).get('sha')
    if remote_sha == local_sha:
        print(f'OK   {remote} ({len(data)} B) sha={remote_sha[:10]}')
        ok += 1
    else:
        print(f'SHA-MISMATCH {remote}: local={local_sha[:10]} remote={remote_sha}')
        fail += 1
print(f'UPLOAD ok={ok} fail={fail} skipped={skipped}')
sys.exit(1 if fail else 0)
