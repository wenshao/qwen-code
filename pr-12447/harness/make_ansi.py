#!/usr/bin/env python3
import json, re, pathlib
H = pathlib.Path('/root/verify/pr12447-harness'); V = pathlib.Path('/root/verify/pr12447/.verify')
G, R, Y, C, B, D, X = '\x1b[32m', '\x1b[31m', '\x1b[33m', '\x1b[36m', '\x1b[1m', '\x1b[2m', '\x1b[0m'
def cmd(s): return f'{B}{C}$ {s}{X}\n'
def note(s): return f'{D}# {s}{X}\n'
strip = lambda s: re.sub(r'\x1b\[[0-9;]*m', '', s)

# ---- fig1: PR's own gates
PACK = open('/root/verify/pr12447-harness/pack-b1ff.txt').read().rstrip() if pathlib.Path('/root/verify/pr12447-harness/pack-b1ff.txt').exists() else ''
vit = (H / 'vitest-b1ff.ansi').read_text()
vit = re.sub(r'\x1b\[[0-9;]*[GKJ]', '', vit)
vit = '\n'.join(l for l in vit.splitlines() if l.strip() and 'JUNIT' not in l)
mvn = [l for l in open('/root/verify/pr12447-mvn-b1ff.log') if re.search(r'openjdk version|Checkstyle violations|Tests run:|BUILD', l)]
out = note('PR #12447 @ b1ff5541b5 (current head), clean worktree, pnpm install --frozen-lockfile, Linux x86_64, Node ' + __import__('subprocess').run(['node','-v'],capture_output=True,text=True).stdout.strip())
out += cmd('cd packages/cli && npx vitest run src/serve/managed-runtime-attestation-contract.test.ts') + vit + '\n\n'
out += cmd('docker run eclipse-temurin:21-jdk mvn -o clean checkstyle:check verify   # packages/sdk-java/runtime-broker')
for l in mvn:
    l = l.rstrip().replace('BUILD SUCCESS', f'{G}{B}BUILD SUCCESS{X}').replace('0 Checkstyle violations', f'{G}0 Checkstyle violations{X}')
    out += l + '\n'
def ex(f):
    e = [l for l in open(f) if l.startswith('EXIT=')][-1].strip()
    return (G if e == 'EXIT=0' else R) + e + X
tsc_errors = sum(1 for l in open('/root/verify/pr12447-typecheck2.log') if 'error TS' in l)
out += '\n' + cmd('npm run build') + ex('/root/verify/pr12447-build2.log') + '\n'
out += cmd('npm run typecheck') + ex('/root/verify/pr12447-typecheck2.log') + f'  {D}({tsc_errors} TS errors){X}\n'
out += cmd('npx eslint --max-warnings 0 packages/cli/src/serve/managed-runtime-attestation-contract{,.test}.ts') + f'{G}EXIT=0{X}\n'
out += cmd('cd packages/cli && npm pack --dry-run --json | jq ".[0].files[].path" | grep managed-runtime-attestation') + PACK + '\n'
out += note('but packages/cli is "private": true; the published CLI is root dist/ with a files allowlist (prepare-package.js), and root dist/ has none of these')
out += cmd("npm run bundle && grep -rl 'managed-runtime/v2/attest\\|ownedManagedRuntimeRouteGate' dist/") + f'{G}(no match){X}  {D}# shipped CLI bundle does not contain the contract: unmounted, inert{X}\n'
pathlib.Path('fig1-pr-gates.ansi').write_text(out)

# ---- fig2: black-box raw-TCP probe, head vs fix
def colour_probe(lines):
    o = ''
    for l in lines:
        if l.startswith('PASS'): o += f'{G}PASS{X}' + l[4:] + '\n'
        elif l.startswith('FAIL'): o += f'{R}{B}FAIL{X}{R}' + l[4:] + f'{X}\n'
        elif 'conform' in l: o += f'{B}{l}{X}\n'
    return o
head = (V / 'probe-b1ff.txt').read_text().splitlines()
fix = (V / 'probe-fixb1ff.txt').read_text().splitlines()
out = note('real node:http listener built exactly like the PR test: createServer(ownedManagedRuntimeRouteGate(expressApp)); requests written byte-for-byte over node:net')
out += note('server run with NODE_ENV unset (as under vitest / any unbundled host); the esbuild CLI bundle defines NODE_ENV=production, which drops the stack but keeps the 415 + HTML page')
out += cmd('PORT=<PR head server> node probe.mjs') + colour_probe(head)
out += '\n' + cmd('INFLATE_OFF=1 PORT=<b1ff554 + inflate: false> node probe.mjs | grep -E "D5 |D6|D10|D11|D12|conform"') + colour_probe([l for l in fix if re.match(r'PASS (D5 |D6|D10|D11|D12)', l) or 'conform' in l])
pathlib.Path('fig2-probe.ansi').write_text(out)

# ---- fig3: JDK HttpClient replay
rep = (H / 'java/replay-b1ff.log').read_text().splitlines()
aug = (H / 'java/replay-b1ff-augmented.log').read_text().splitlines()
def colour_rep(lines):
    o = ''
    for l in lines:
        if l.startswith('PASS'): o += f'{G}PASS{X}' + l[4:] + '\n'
        elif l.startswith('FAIL'): o += f'{R}{B}FAIL{X}{R}' + l[4:] + f'{X}\n'
        elif l.startswith('JDK') or l.startswith('###'): o += f'{Y}{l}{X}\n'
        elif 'conform' in l: o += f'{B}{l}{X}\n'
    return o
out = note('java.net.http.HttpClient (JDK 21.0.12, eclipse-temurin:21-jdk) reads the PR\'s shared fixtures file with Jackson and replays every case')
out += cmd('java FixtureReplay managed-runtime-attestation-v2.fixtures.json http://127.0.0.1:$PORT HTTP_1_1')
out += colour_rep(rep[:19])
out += cmd('java FixtureReplay ... HTTP_2   # JDK default preference: sends h2c upgrade, served as HTTP/1.1')
out += colour_rep([rep[20]] + [l for l in rep[21:] if 'conform' in l])
dump = open('/root/verify/pr12447/.verify/dump.out').read().strip().splitlines()
out += '\n' + note('what a default HttpClient.newHttpClient() actually puts on the wire for a cleartext POST (raw capture):')
for l in dump:
    out += (f'{Y}{l}{X}' if 'h2c' in l or 'Upgrade' in l else f'{D}{l}{X}') + '\n'
out += '\n' + note('same client, suggested fixture file (+19 cases, error codes pinned)')
out += colour_rep([l for l in aug if l.startswith(('###', 'FAIL')) or 'conform' in l])
pathlib.Path('fig3-jdk-replay.ansi').write_text(out)

# ---- fig4: mutation sweep side by side
a = json.load(open(H / 'mutants/run-b1ff-summary.json')); b = json.load(open(H / 'mutants/run-b1ff-fix-summary.json'))
bm = {r[0]: r for r in b}
def v(s):
    return f'{G}killed  {X}' if s == 'killed' else f'{R}{B}SURVIVED{X}' if s == 'SURVIVED' else f'{D}{s[:8]:<8}{X}'
def desc(r):
    d = r[2].replace(' (Express default page)', ' (default page)')
    return d[:62]
out = note(f'{len(a) - 1} hand-written semantic mutants of managed-runtime-attestation-contract.ts @ b1ff554; one vitest run per arm over src/serve/__mut__/m*/')
out += f'{B}{"id":<4} {"group":<12} {"mutant":<62} {"PR suite":<9} +suggested{X}\n'
for r in a:
    if r[0] == 'M00':
        out += f'{D}M00  control      unmutated control{" " * 46}{r[4]:<9} {bm["M00"][4]}{X}\n'; continue
    out += f'{r[0]:<4} {r[1]:<12} {desc(r):<62} {v(r[3])}  {v(bm[r[0]][3])}\n'
for r in b:
    if r[0] not in {x[0] for x in a}:
        out += f'{r[0]:<4} {r[1]:<12} {desc(r):<62} {D}n/a     {X}  {v(r[3])}\n'
common = [r[0] for r in a if r[0] != 'M00']
ka = sum(1 for r in a if r[3] == 'killed'); kb = sum(1 for i in common if bm[i][3] == 'killed')
out += f'\n{B}same {len(common)} mutants killed: PR suite {R}{ka}/{len(common)}{X}{B}   with suggested fixtures + tests {G}{kb}/{len(common)}{X}{D}  (+M44, only meaningful with the fix){X}\n'
pathlib.Path('fig4-mutants.ansi').write_text(out)

# ---- fig5: Java drift controls
dl = (H / 'java-drift/b1ff/drift.log').read_text().splitlines()
out = note('ManagedRuntimeAttestationConformanceTest (PR) run against 8 hand-drifted copies of the shared fixtures file')
for l in dl:
    name, res, why = [x.strip() for x in l.split('|')]
    caught = 'Failures: 1' in res
    out += (f'{G}caught {X}' if caught else f'{Y}{B}missed {X}') + f'{name:<34} {D}{why[:86]}{X}\n'
out += f'{D}# J8 turns the wrong-lease negative case into a request that now succeeds; only the TS suite executes cases, as the PR states.{X}\n'
pathlib.Path('fig5-java-drift.ansi').write_text(out)
print('ok')
