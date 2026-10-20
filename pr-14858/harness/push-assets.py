#!/usr/bin/env python3
"""Append <localdir> as <destdir>/ on wenshao/qwen-code@asserts via the git-data
API (fast-forward only, never force). usage: push-assets.py <localdir> <destdir> <msg>"""
import base64
import json
import os
import subprocess
import sys
import tempfile

REPO = 'repos/wenshao/qwen-code'
local, dest, msg = sys.argv[1], sys.argv[2], sys.argv[3]


def gh(args, payload=None):
    if payload is None:
        out = subprocess.run(['gh', 'api', *args], check=True, capture_output=True, text=True).stdout
    else:
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump(payload, f)
            p = f.name
        try:
            out = subprocess.run(['gh', 'api', *args, '--input', p], check=True, capture_output=True, text=True).stdout
        finally:
            os.unlink(p)
    return json.loads(out) if out.strip() else None


tip = gh([f'{REPO}/git/refs/heads/asserts'])['object']['sha']
base_tree = gh([f'{REPO}/git/commits/{tip}'])['tree']['sha']
existing = gh([f'{REPO}/git/trees/{base_tree}'])['tree']
if any(e['path'] == dest for e in existing):
    sys.exit(f'{dest} already exists on asserts; refusing to overwrite')

entries = []
for root, _, files in os.walk(local):
    for name in sorted(files):
        path = os.path.join(root, name)
        rel = os.path.relpath(path, local)
        data = open(path, 'rb').read()
        blob = gh(['-X', 'POST', f'{REPO}/git/blobs'], {'content': base64.b64encode(data).decode(), 'encoding': 'base64'})
        want = subprocess.run(['git', 'hash-object', path], check=True, capture_output=True, text=True).stdout.strip()
        if blob['sha'] != want:
            sys.exit(f'blob mismatch for {rel}: {blob["sha"]} != {want}')
        entries.append({'path': f'{dest}/{rel}', 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
        print('blob', rel, blob['sha'][:10])

tree = gh(['-X', 'POST', f'{REPO}/git/trees'], {'base_tree': base_tree, 'tree': entries})
commit = gh(['-X', 'POST', f'{REPO}/git/commits'], {'message': msg, 'tree': tree['sha'], 'parents': [tip]})
now = gh([f'{REPO}/git/refs/heads/asserts'])['object']['sha']
if now != tip:
    sys.exit(f'asserts moved {tip} -> {now}; rerun')
gh(['-X', 'PATCH', f'{REPO}/git/refs/heads/asserts'], {'sha': commit['sha'], 'force': False})
print('COMMIT', commit['sha'])
