#!/usr/bin/env python3
"""WebShell mutation matrix for PR 12808 (runs in the head worktree, restores after each)."""
import json, os, re, subprocess

WT = os.path.expanduser('~/git/pr12808-head')
WS = f'{WT}/packages/web-shell'
S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4e2fef2a-1851-4d5c-9a46-2dd6291c0a8f/scratchpad'
SPEC = 'packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json'
M = 'packages/web-shell/client/components/managed'
GEN = 'packages/web-shell/scripts/generate-managed-agent-api.mjs'

def edit_json(path, fn):
    p = f'{WT}/{path}'
    spec = json.load(open(p))
    fn(spec)
    open(p, 'w').write(json.dumps(spec, indent=2) + '\n')

def add_prop(spec):
    spec['components']['schemas']['WebShellSession']['properties']['debugNote'] = {'type': 'string'}

def plan_title(spec):
    spec['components']['schemas']['WebShellSession']['properties']['title']['x-qwen-implementation-status'] = 'planned'

def replace(path, old, new):
    p = f'{WT}/{path}'
    s = open(p).read()
    assert s.count(old) == 1, (path, s.count(old))
    open(p, 'w').write(s.replace(old, new))

VITEST = ['npx', 'vitest', 'run', '--config', 'vitest.config.ts', 'client/components/managed']
TSC = ['pnpm', 'run', 'typecheck']
REGEN = ['pnpm', 'run', 'generate:managed-agent-api']

MUTANTS = [
  ('T1', 'spec: add WebShellSession.debugNote, no regeneration', lambda: edit_json(SPEC, add_prop), [], VITEST),
  ('T1r', 'same spec change, then generate:managed-agent-api', lambda: edit_json(SPEC, add_prop), [REGEN], VITEST),
  ('T2', 'spec: mark WebShellSession.title planned, regenerate', lambda: edit_json(SPEC, plan_title), [REGEN], TSC),
  ('T3', 'generator keeps planned properties', lambda: replace(GEN, "              .filter(([, schema]) => !isPlanned(schema))\n", ''), [], VITEST),
  ('T4', 'provider passes nextCursor null through', lambda: replace(f'{M}/java-managed-agent-provider.ts', 'nextCursor: page.nextCursor ?? undefined,', 'nextCursor: page.nextCursor,'), [], TSC),
  ('T5', 'provider passes olderCursor null through', lambda: replace(f'{M}/java-managed-agent-provider.ts', 'olderCursor: transcript.olderCursor ?? undefined,', 'olderCursor: transcript.olderCursor,'), [], TSC),
  ('T6', 'projector passes absent turnId through', lambda: replace(f'{M}/java-managed-agent-event-projector.ts', "turnId: event.turnId ?? '',", 'turnId: event.turnId,'), [], TSC),
  ('T7', 'stream request sends limit: 100 again', lambda: replace(f'{M}/java-managed-agent-provider.ts', '{ sessionId, afterSequence: request.lastEventId },', '{ sessionId, afterSequence: request.lastEventId, limit: 100 },'), [], TSC),
  ('T8', 'drop the local "text" input override', lambda: replace(f'{M}/java-managed-agent-client.ts', 'type JavaAgentInput<T> = Omit<T, \'input\'> & {\n  input: Array<{ type: \'text\'; text: string }>;\n};', 'type JavaAgentInput<T> = T;'), [], TSC),
]

def restore():
    subprocess.run(['git', 'restore', '--source=HEAD', '--worktree', '--', 'packages/web-shell', SPEC], cwd=WT, check=True)
    st = subprocess.run(['git', 'status', '--porcelain', '--', 'packages/web-shell', SPEC], cwd=WT, capture_output=True, text=True).stdout
    st = '\n'.join(l for l in st.splitlines() if not l.endswith('junit.xml'))
    assert st.strip() == '', st

results = []
for mid, label, apply, pre, check in MUTANTS:
    restore()
    apply()
    for cmd in pre:
        subprocess.run(cmd, cwd=WS, capture_output=True)
    log = f'{S}/logs/tsmut-{mid}.log'
    with open(log, 'w') as f:
        rc = subprocess.run(check, cwd=WS, stdout=f, stderr=subprocess.STDOUT).returncode
    text = open(log, errors='replace').read()
    evidence = [l.strip() for l in text.splitlines() if re.search(r'error TS\d+|FAIL |AssertionError|✗|×|Tests .*failed|Tests .*passed', l)][:4]
    r = {'id': mid, 'label': label, 'check': ' '.join(check[-2:]) if check is VITEST else 'typecheck', 'rc': rc, 'evidence': evidence}
    results.append(r)
    print(json.dumps(r, ensure_ascii=False), flush=True)
restore()
json.dump(results, open(f'{S}/mutation-ts.json', 'w'), indent=1, ensure_ascii=False)
