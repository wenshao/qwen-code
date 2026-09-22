#!/usr/bin/env python3
"""Round-2 figures for PR #12447 @ 7980d55 -> ANSI transcripts rendered by render_r2.cjs."""
import json, re, pathlib, subprocess
S = pathlib.Path('data')
V = pathlib.Path('data')
OUT = pathlib.Path(__file__).parent
G, R, Y, C, B, D, X = '\x1b[32m', '\x1b[31m', '\x1b[33m', '\x1b[36m', '\x1b[1m', '\x1b[2m', '\x1b[0m'
def cmd(s): return f'{B}{C}$ {s}{X}\n'
def note(s): return f'{D}# {s}{X}\n'
def ok(s): return f'{G}{s}{X}'
def bad(s): return f'{R}{B}{s}{X}'

# ---------------- fig1: gates at 7980d55
node = subprocess.run(['node', '-v'], capture_output=True, text=True).stdout.strip()
o = note(f'PR #12447 @ 7980d55508 (current head), worktree with pnpm install --frozen-lockfile, Linux x86_64, Node {node}')
o += cmd('git diff <b1ff554 + R1 suggested-fix-b1ff554.patch> 7980d55 -- packages/cli/src/serve')
o += '  contracts/managed-runtime-attestation-v2.fixtures.json   ' + ok('identical') + '\n'
o += '  contracts/managed-runtime-attestation-v2.schema.json     ' + ok('identical') + '\n'
o += '  managed-runtime-attestation-contract.test.ts             ' + ok('identical') + '\n'
o += '  managed-runtime-attestation-contract.ts                  ' + ok('same `inflate: false` line') + f'{D}, comment reworded (3 lines vs 5){X}\n\n'
vit = re.sub(r'\x1b\[[0-9;]*[GKJ]', '', (S / 'vitest-head.ansi').read_text())
vit = '\n'.join(l for l in vit.splitlines() if l.strip() and 'JUNIT' not in l)
o += cmd('cd packages/cli && npx vitest run src/serve/managed-runtime-attestation-contract.test.ts') + vit + '\n\n'
o += cmd('docker run eclipse-temurin:21-jdk mvn -o clean checkstyle:check verify   # packages/sdk-java/runtime-broker')
for l in (S / 'mvn-head.log').read_text().splitlines():
    if re.search(r'openjdk version|Checkstyle violations|Tests run: 29|Tests run: 3,|BUILD', l):
        o += l.replace('BUILD SUCCESS', ok(B + 'BUILD SUCCESS')).replace('0 Checkstyle violations', ok('0 Checkstyle violations')) + '\n'
def ex(f, key):
    line = [l for l in (S / f).read_text().splitlines() if l.startswith(key)][-1]
    return ok(line) if line.endswith(' 0') else bad(line)
tsc_errors = sum(1 for l in (S / 'typecheck-head.log').read_text().splitlines() if 'error TS' in l)
o += '\n' + cmd('npm run build') + ex('build-head.log', 'BUILD EXIT') + '\n'
o += cmd('npm run typecheck') + ex('typecheck-head.log', 'TYPECHECK EXIT') + f'  {D}({tsc_errors} TS errors){X}\n'
o += cmd('npx eslint --max-warnings 0 packages/cli/src/serve/managed-runtime-attestation-contract{,.test}.ts') + ok('exit 0') + '\n'
o += cmd('npx prettier --check <the 2 TS files, 2 contract JSON files, 2 design docs>') + ok('All matched files use Prettier code style!') + '\n'
o += cmd("npm run bundle && grep -rlE 'managed-runtime/v2/attest|ownedManagedRuntimeRouteGate|managed_runtime_attestation' dist/ | grep -v '^dist/src/'") + ok('(no match)') + f'  {D}# still unmounted: nothing ships in the CLI bundle{X}\n\n'
o += cmd('java FixtureReplay <fixtures> <head server> HTTP_1_1 ; ... HTTP_2        # real JDK 21 HttpClient; HTTP_2 = preference, cleartext falls back to HTTP/1.1')
for v in ('HTTP_1_1', 'HTTP_2'):
    last = [l for l in (S / f'replay-head-{v}.log').read_text().splitlines() if 'conform' in l][-1]
    o += f'  {v + (" pref" if v == "HTTP_2" else ""):<12} ' + ok(last) + '\n'
o += '\n' + cmd('INFLATE_OFF=1 PORT=<head server> node probe.mjs     # R1 raw-TCP probe, 44 requests')
for l in (V / 'probe-head.txt').read_text().splitlines():
    if re.match(r'PASS (D5 |D6 |D10|D11|D12)', l):
        o += ok('PASS') + l[4:] + '\n'
    elif 'conform' in l:
        o += f'{B}{G}{l}{X}\n'
(OUT / 'fig1-r2-gates.ansi').write_text(o)

# ---------------- fig2: mutation matrix, three arms
def load(p):
    return {r[0]: (r[3], r[4]) for r in json.load(open(p))}
arms = [('b1ff554', load(S / 'mut-b1ff-summary.json')), ('7980d55', load(S / 'mut-head-summary.json')), ('+follow-up', load(S / 'mut-followup-summary.json'))]
desc = {r[0]: (r[1], r[2]) for r in json.load(open(S / 'mut-head-summary.json'))}
def cell(v):
    if v is None: return f'{D}{"n/a":<10}{X}'
    verdict, frac = v
    if verdict == 'killed': return ok(f'{"killed":<10}')
    if verdict == 'SURVIVED': return bad(f'{"SURVIVED":<10}')
    return f'{verdict:<10}'
o = note('one vitest run per arm: every mutant is a copy of managed-runtime-attestation-contract.ts with ONE guard changed, run against that arm\'s own test file + fixtures')
o += note('b1ff554 = R1 head · 7980d55 = current head (author applied the R1 patch) · +follow-up = 7980d55 + the suggested follow-up (5 fixture cases, 8 registration rows, 1 new assertion, exact-limit response)')
o += note('M01-M43 = the R1 mutants · M44 = `inflate: false` reverted (negative control for the fix) · X01-X18 = the /review round-1 (R1-1, R1-2) mutations')
o += f'{B}{"id":<5}{"b1ff554":<11}{"7980d55":<11}{"+follow-up":<11} group / mutation{X}\n'
for mid in desc:
    if mid == 'M00': continue
    group, d = desc[mid]
    o += f'{mid:<5}' + ''.join(cell(a[1].get(mid)) + ' ' for a in arms) + f'{D}[{group}]{X} {d}\n'
def score(a, ids):
    k = sum(1 for i in ids if a.get(i, ('',))[0] == 'killed'); return k, len([i for i in ids if i in a])
r1 = [f'M{i:02d}' for i in range(1, 44)]
xs = [f'X{i:02d}' for i in range(1, 19)]
o += '\n'
for name, a in arms:
    k1, n1 = score(a, r1); kx, nx = score(a, xs)
    m44 = a.get('M44', ('n/a',))[0]
    o += f'{B}{name:<11}{X} R1 mutants {B}{k1}/{n1}{X} killed   /review mutations {B}{kx}/{nx}{X} killed   M44 {m44}\n'
o += note('left on +follow-up: M25 (request limit off by one; a case needs a ~16 KiB literal in the shared file); M27 (strict:false: the closed-shape check rejects non-objects anyway) and M31 (route-level no-store: the gate sets the same header) are equivalent')
(OUT / 'fig2-r2-mutants.ansi').write_text(o)

# ---------------- fig3: /review round-1 findings, executed
live = {arm: json.load(open(V / f'review-live-{arm}.json')) for arm in ('b1ff', 'head')}
skip = ('Content-Length 999999999', 'then FIN')
o = note('live requests over raw TCP to createServer(ownedManagedRuntimeRouteGate(app)), same harness against the b1ff554 and the 7980d55 contract build')
o += f'{B}{"item":<6}{"request":<54}{"b1ff554":<32}{"7980d55":<32}{X}\n'
def fmt(r):
    ct = (r.get('ct') or '').split(';')[0]
    s = f'{r["status"]} {ct} {r["code"]}'.replace('application/json', 'json').replace('(json, no code)', '').replace('managed_runtime_', '')
    s = s.strip()[:30]
    html = 'HTML' in s or 'text/html' in s
    return (bad if html else (lambda t: t))(f'{s:<30}') + '  '
for rb, rh in zip(live['b1ff'], live['head']):
    if any(k in rb['label'] for k in skip): continue
    o += f'{rb["group"]:<6}{rb["label"][:52]:<54}' + fmt(rb) + fmt(rh) + '\n'
o += '\n' + cmd('R1-3: append one schema-valid case to the fixtures, run the PR suite unchanged (7980d55)')
res = json.load(open(S / 'mut-head.json'))
for f in res['testResults']:
    m = re.search(r'__mut__/(r13[ab])/', f['name'])
    if not m: continue
    fails = [a for a in f['assertionResults'] if a['status'] == 'failed']
    schema_ok = all(a['status'] == 'passed' for a in f['assertionResults'] if 'validates the shared fixtures' in a['title'])
    for a in fails:
        o += f'  {m.group(1)}  schema validation ' + (ok('passes') if schema_ok else bad('fails')) + f'  ->  {a["title"].split(" conforms")[0]}: ' + bad(a['failureMessages'][0].splitlines()[0][:70]) + '\n'
o += note('r13a: request.headers (a whole header set, wrong token) is ignored by materializeRequest; r13b: a HEAD case validates, then kills the runner')
o += '\n' + cmd('R1-8 / R1-9 (static, unchanged at 7980d55)')
o += '  runtime-broker/pom.xml   <jackson.version>2.20.0</jackson.version>   vs  qwencode/pom.xml <jackson-core.version>2.22.0</jackson-core.version>\n'
o += '  schema $id  https://qwenlm.github.io/qwen-code/contracts/managed-runtime-attestation-v2.schema.json -> ' + bad('HTTP 404') + f'   {D}(other repo schemas use https://qwen-code.invalid/...){X}\n'
(OUT / 'fig3-r2-review-status.ansi').write_text(o)
print('ok')
