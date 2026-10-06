#!/usr/bin/env python3
"""Mutation matrix for PR #13375 (run in the PR worktree, one mutant at a time).

Each mutant is an exact-anchor replacement (must match once). Tests run with
coverage off; a mutant is KILLED when any selected command exits non-zero with
a parsed test total > 0, SURVIVED when all commands pass with totals > 0, and
INVALID otherwise. The source is restored with `git checkout` + touch.
"""
import os, re, subprocess, sys, time, json

WT = sys.argv[1]
OUT = sys.argv[2]
ONLY = sys.argv[3:]  # optional mutant ids
NODE = '/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin'
ENV = dict(os.environ, PATH=NODE + ':' + os.environ['PATH'])

CORE = 'packages/core/src/managed-runtime/'
CLI = 'packages/cli/src/serve/'
T_CHUNKS = ('packages/core', ['src/managed-runtime/managed-message-chunks.test.ts'], None)
T_HTTP = ('packages/core', ['src/managed-runtime/http-managed-session-store.test.ts'], None)
T_PROJ = ('packages/core', ['src/managed-runtime/managed-session-message-projection.test.ts'], None)
T_WR = ('packages/cli', ['src/serve/workspace-recovery-session.test.ts'], None)
T_HH = ('packages/cli', ['src/serve/hosted-harness-session.test.ts'],
        'long answer|cold Workspace load|recovered Write continuation')

MUTANTS = [
    ('M1', 'inline boundary <= becomes < (65,536-byte record chunked)', CORE + 'managed-message-chunks.ts',
     'if (body.byteLength <= MANAGED_MESSAGE_INLINE_BYTES) {',
     'if (body.byteLength < MANAGED_MESSAGE_INLINE_BYTES) {', False, [T_CHUNKS, T_HTTP]),
    ('M2', 'parts read concurrently (Promise.all) instead of sequentially', CORE + 'managed-message-chunks.ts',
     '  const buffers: Buffer[] = [];\n  for (const part of parts) buffers.push(await read(part));',
     '  const buffers: Buffer[] = await Promise.all(parts.map((part) => read(part)));', True,
     [T_CHUNKS, T_HTTP, T_PROJ, T_WR, T_HH]),
    ('M3', 'transaction/snapshot closure no longer follows manifest -> parts', CORE + 'http-managed-session-store.ts',
     '  if (ref.kind === MANAGED_MESSAGE_CHUNKS_KIND) {\n    return managedMessageChunkParts(ref.kind, bytes);\n  }\n',
     '', False, [T_HTTP]),
    ('M4', 'recovery parses raw part bytes as JSON', CLI + 'workspace-recovery-session.ts',
     '      ref.kind !== MANAGED_TOOL_RESULT_KINDS.content &&\n      ref.kind !== MANAGED_MESSAGE_PART_KIND\n',
     '      ref.kind !== MANAGED_TOOL_RESULT_KINDS.content\n', False, [T_WR]),
    ('M5', 'Harness event envelope reads the manifest as the record', CLI + 'hosted-harness-session.ts',
     '          await readManagedMessageBody(\n            (bodyRef) => session.managed.resources.read(bodyRef),\n            ref as unknown as ManagedSessionDurableRef,\n          )',
     '          await session.managed.resources.read(\n            ref as unknown as ManagedSessionDurableRef,\n          )', False, [T_HH]),
    ('M6', 'projection reads the manifest as the record', CORE + 'managed-session-message-projection.ts',
     '  const body = await readManagedMessageBody(\n    (bodyRef) => resources.read(bodyRef),\n    ref as unknown as Parameters<ManagedSessionResourceStore[\'read\']>[0],\n  );',
     '  const body = await resources.read(\n    ref as unknown as Parameters<ManagedSessionResourceStore[\'read\']>[0],\n  );', False, [T_PROJ, T_CHUNKS]),
    ('M7', 'manifest accepts parts of any kind', CORE + 'managed-message-chunks.ts',
     '      if (ref.kind !== MANAGED_MESSAGE_PART_KIND) {',
     '      if (false) {', False, [T_CHUNKS, T_HTTP]),
    ('M8', 'recovery verifier reads the manifest as the record', CLI + 'workspace-recovery-session.ts',
     'json(await readManagedMessageBody(read, durableRef(recordRef))),',
     'json(await read(durableRef(recordRef))),', False, [T_WR]),
    ('M9', 'decode each part before joining (UTF-8 split damage)', CORE + 'managed-message-chunks.ts',
     '  return Buffer.concat(buffers);',
     "  return Buffer.from(buffers.map((b) => b.toString('utf8')).join(''), 'utf8');", False, [T_CHUNKS, T_PROJ]),
    ('M10', 'part size 60 KiB -> 64 KiB', CORE + 'managed-message-chunks.ts',
     'export const MANAGED_MESSAGE_PART_BYTES = 60 * 1024;',
     'export const MANAGED_MESSAGE_PART_BYTES = 64 * 1024;', False, [T_CHUNKS, T_HTTP]),
]

STRIP = re.compile(r'\x1b\[[0-9;]*m')

def run_tests(spec):
    pkg, files, pattern = spec
    cmd = ['npx', 'vitest', 'run', *files, '--coverage.enabled=false']
    if pattern:
        cmd += ['-t', pattern]
    p = subprocess.run(cmd, cwd=os.path.join(WT, pkg), env=ENV, capture_output=True, text=True)
    out = STRIP.sub('', p.stdout + p.stderr)
    m = re.search(r'Tests\s+(.*)', out)
    line = m.group(1).strip() if m else ''
    nums = {k: int(v) for v, k in re.findall(r'(\d+) (failed|passed|skipped)', line)}
    total = nums.get('failed', 0) + nums.get('passed', 0)
    failed_names = sorted(set(re.findall(r'(?:FAIL|×)\s+\S+ > (.*?)(?:\s+\d+ms)?$', out, re.M)))[:6]
    return p.returncode, total, line, failed_names, out

def build_core():
    p = subprocess.run(['npm', 'run', 'build'], cwd=os.path.join(WT, 'packages/core'), env=ENV,
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit('core build failed:\n' + p.stdout[-2000:] + p.stderr[-2000:])

results = []
for mid, desc, path, old, new, rebuild, tests in MUTANTS:
    if ONLY and mid not in ONLY:
        continue
    full = os.path.join(WT, path)
    src = open(full).read()
    if src.count(old) != 1:
        raise SystemExit(f'{mid}: anchor matched {src.count(old)} times')
    open(full, 'w').write(src.replace(old, new))
    t0 = time.time()
    try:
        if rebuild:
            build_core()
        per = []
        for spec in tests:
            code, total, line, failed, out = run_tests(spec)
            per.append({'suite': spec[1][0].split('/')[-1] + (f" -t '{spec[2]}'" if spec[2] else ''),
                        'exit': code, 'total': total, 'summary': line, 'failed': failed})
            open(os.path.join(OUT, f'mut-{mid}-{len(per)}.log'), 'w').write(out)
    finally:
        subprocess.run(['git', 'checkout', '--', path], cwd=WT, check=True)
        os.utime(full, None)
        if rebuild:
            build_core()
    if any(s['total'] == 0 for s in per):
        verdict = 'INVALID'
    elif any(s['exit'] != 0 for s in per):
        verdict = 'KILLED'
    else:
        verdict = 'SURVIVED'
    r = {'id': mid, 'desc': desc, 'verdict': verdict, 'seconds': round(time.time() - t0), 'suites': per}
    results.append(r)
    print(json.dumps(r), flush=True)

with open(os.path.join(OUT, 'mutation-results.jsonl'), 'a') as f:
    for r in results:
        f.write(json.dumps(r) + '\n')
st = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=WT, capture_output=True, text=True).stdout
print('WORKTREE_CLEAN' if st.strip() == '' else 'WORKTREE_DIRTY:\n' + st)
