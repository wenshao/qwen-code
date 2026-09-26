"""Generate a fork probe workflow whose steps are copied verbatim from the PR's
ci.yml (test_macos/test_windows up to the Hosted smoke), ci.yml integration_no_ak
(the required gate step) and sdk-java.yml hosted-harness-mysql (whole job)."""
import yaml, sys, copy, json
root = sys.argv[1]
ci = yaml.safe_load(open(f'{root}/.github/workflows/ci.yml'))
java = yaml.safe_load(open(f'{root}/.github/workflows/sdk-java.yml'))
SKIP = "needs.classify_pr.outputs.skip_ci != 'true'"

def strip_if(step):
    s = copy.deepcopy(step)
    cond = s.get('if')
    if isinstance(cond, str) and SKIP in cond:
        c = cond.replace(SKIP + ' && ', '').replace(SKIP, 'true')
        if c.strip() in ('${{ true }}', 'true'):
            del s['if']
        else:
            s['if'] = c
    return s

def upto_smoke(job):
    out = []
    for st in ci['jobs'][job]['steps']:
        out.append(strip_if(st))
        if st.get('name') == 'Hosted portable process smoke':
            break
    assert out[-1]['name'] == 'Hosted portable process smoke', job
    return out

census_sh = 'node .github/probe/census.cjs'

extra_full = {
    'name': 'Probe: full Hosted suite (all 7 cases)',
    'id': 'full',
    'continue-on-error': True,
    'timeout-minutes': 10,
    'run': 'npm run test:integration:hosted:sandbox:none',
}
census = {'name': 'Probe: leftover temp dirs and serve processes', 'if': 'always()', 'run': census_sh + ' after-smoke'}

jobs = {}
for key, name, runs_on in [('smoke_macos', 'test_macos', 'macos-latest'),
                           ('smoke_windows', 'test_windows', 'windows-2022')]:
    steps = upto_smoke(name)
    steps.insert(steps.index(next(s for s in steps if s.get('name') == 'Hosted portable process smoke')) + 1, copy.deepcopy(census))
    steps.append(extra_full)
    steps.append({**census, 'name': 'Probe: leftover after full suite', 'run': census_sh + ' after-full'})
    j = {'name': f'{name} steps (verbatim) / {runs_on}', 'runs-on': runs_on, 'timeout-minutes': 60, 'steps': steps}
    for k in ('defaults', 'env'):
        if k in ci['jobs'][name]:
            j[k] = ci['jobs'][name][k]
    jobs[key] = j

# Required no-AK gate on hosted Linux, steps verbatim (self-hosted-only steps drop out).
noak = ci['jobs']['integration_no_ak']
steps = []
for st in noak['steps']:
    s = copy.deepcopy(st)
    if s.get('name') in ('Restore workspace ownership', 'Clean stale .qwen before checkout', 'Verify checkout includes expected head commit'):
        continue
    if s.get('name') == 'Use trusted CI profile':
        s = {'name': 'Use trusted CI profile (probe: full)', 'id': 'ci_profile', 'run': 'echo "ci_profile=full" >> "$GITHUB_OUTPUT"'}
    steps.append(s)
steps.append({**census, 'name': 'Probe: leftover after no-AK gate', 'run': census_sh + ' after-noak'})
jobs['no_ak_gate'] = {'name': 'integration_no_ak steps (verbatim) / ubuntu-latest', 'runs-on': 'ubuntu-latest', 'timeout-minutes': 60, 'steps': steps}
for k in ('defaults', 'env'):
    if k in noak: jobs['no_ak_gate'][k] = noak[k]

jobs['hosted_harness_mysql'] = copy.deepcopy(java['jobs']['hosted-harness-mysql'])

wf = {'name': 'probe-pr12733', 'on': {'push': {'branches': ['probe/pr12733-**']}},
      'permissions': {'contents': 'read'}, 'env': java.get('env', {}), 'jobs': jobs}
if ci.get('env'):
    wf['env'] = {**ci['env'], **wf['env']}
class NoAlias(yaml.SafeDumper):
    def ignore_aliases(self, data): return True
yaml.dump(wf, Dumper=NoAlias, stream=open(sys.argv[2], 'w'), sort_keys=False, width=10000, allow_unicode=True)
print(json.dumps({k: [s.get('name') for s in v['steps']] for k, v in jobs.items()}, indent=1))
