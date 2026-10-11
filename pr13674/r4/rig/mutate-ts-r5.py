#!/usr/bin/env python3
"""Round 4 TS mutants on the PR head's Harness side; restore each file from git afterwards."""
import json, os, re, subprocess, sys, time
W = '/Users/wenshao/pr13674-rig/src-h5'; CLI = f'{W}/packages/cli'; S = f'{CLI}/src/serve'
OUT = '/Users/wenshao/pr13674-rig/out/mut-ts-r5'; os.makedirs(OUT, exist_ok=True)
FILES = ['src/serve/hosted-workspace-profiles.test.ts', 'src/serve/hosted-workspace-tool-turn.child-agent.test.ts',
         'src/serve/hosted-workspace-tool-turn.team.test.ts', 'src/serve/workspace-recovery-session.test.ts',
         'src/serve/hosted-harness-session.test.ts']
PROF = f'{S}/hosted-workspace-profiles.ts'; HHS = f'{S}/hosted-harness-session.ts'
MUTANTS = [
    ('C1 helper ignores suppressChildAgents', PROF, 'return shellLane && !suppressChildAgents;', 'return shellLane;'),
    ('C2 Harness route ignores the suppressChildAgents body member', HHS, "body?.['suppressChildAgents'] === true,", 'false,'),
    ('C3 message funnel attached without the child orchestrator', HHS, '          if (session.childAgents) {', '          if (true) {'),
    ('C4 team-lead dropped from the Shell vocabulary', PROF,
     '    profile === HOSTED_WORKSPACE_SHELL_PROFILE_V2 ||\n    profile === HOSTED_WORKSPACE_TEAM_LEAD_PROFILE\n  );\n}\n\n/** Public',
     '    profile === HOSTED_WORKSPACE_SHELL_PROFILE_V2\n  );\n}\n\n/** Public'),
]
def run(tag):
    log = f'{OUT}/{tag}.log'; t = time.time()
    with open(log, 'w') as f:
        rc = subprocess.call(['npx', 'vitest', 'run', *FILES], cwd=CLI, stdout=f, stderr=subprocess.STDOUT)
    text = open(log).read()
    m = re.findall(r'Tests\s+(.*)\n', text)
    fails = sorted(set(re.findall(r'(?:FAIL|×)\s+(src/serve/\S+\.test\.ts)\s*>\s*([^\n]{0,140})', text)))
    return {'rc': rc, 'secs': round(time.time() - t), 'tests': m[-1].strip() if m else None, 'failing': [f'{a} > {b}' for a, b in fails][:8]}
only = sys.argv[1:]; res = {}
for name, path, old, new in MUTANTS:
    tag = name.split()[0]
    if only and tag not in only: continue
    src = open(path).read()
    if src.count(old) != 1:
        res[tag] = {'error': f'anchor count {src.count(old)}'}; print(tag, 'ANCHOR', src.count(old), flush=True); continue
    open(path, 'w').write(src.replace(old, new))
    try:
        r = run(tag)
    finally:
        open(path, 'w').write(src)
    r['killed'] = r['rc'] != 0; r['name'] = name; res[tag] = r
    print(tag, 'KILLED' if r['killed'] else 'SURVIVED', json.dumps(r), flush=True)
clean = subprocess.run(['git', '-C', W, 'diff', '--stat', '--', 'packages/cli/src'], capture_output=True, text=True).stdout.strip()
print('restored-clean' if not clean else 'DIRTY ' + clean, flush=True)
json.dump(res, open(f'{OUT}/summary.json', 'w'), indent=2)
