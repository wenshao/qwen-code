#!/usr/bin/env python3
"""Colour terminal summaries of the PR #13013 evidence (rendered to PNG later)."""
import json, os, statistics as st, sys
from collections import defaultdict

O = '/root/verify/pr13013/out'
B, D, R, G, Y, C, M, X = ('\033[1m', '\033[2m', '\033[31m', '\033[32m', '\033[33m',
                           '\033[36m', '\033[35m', '\033[0m')
ARMNAME = {'base2': 'base 6b66321a5a', 'pr': 'PR   77ae21c937'}


def ab(latency):
    rows = [json.loads(l) for l in open(f'{O}/abi-L{latency}.jsonl')]
    g = defaultdict(list)
    for r in rows:
        g[(r['scenario'], r['arm'])].append(r)
    print(f'{B}{C}Fake OpenAI endpoint, injected latency {latency} ms per request, 4 runs per cell, arms interleaved{X}')
    print(f'{D}same dist/cli.js in both arms; only the harness (TestRig / SDKTestHelper) differs{X}')
    print()
    print(f'{B}{"scenario":10} {"arm":17} {"requests per run":26} {"wall ms (4 runs)":26} {"median":>7} {"last req->exit":>15}{X}')
    for scen in ('cli-tool', 'cli-text', 'sdk-tool'):
        meds = {}
        for arm in ('base2', 'pr'):
            rs = g[(scen, arm)]
            req = rs[0]['requests']
            assert all(r['requests'] == req for r in rs)
            walls = [r['wallMs'] for r in rs]
            meds[arm] = st.median(walls)
            ex = req['extractor']
            reqs = f"main {req['main']} + extractor {ex}"
            col = R if ex else G
            tails = [r.get('lastReqToExitMs') for r in rs]
            tail = f"{min(tails)}-{max(tails)} ms" if tails[0] is not None else '-'
            print(f"{scen:10} {ARMNAME[arm]:17} {col}{reqs:26}{X} {str(walls):26} {meds[arm]:>7.0f} {D}{tail:>15}{X}")
        d = meds['base2'] - meds['pr']
        print(f"{'':10} {D}{'PR saves':17}{X} {'':26} {'':26} {Y}{d:>7.0f}{X}")
    print()
    pr_mem = g[('cli-tool', 'pr')][0]['settingsMemory']
    b_mem = g[('cli-tool', 'base2')][0]['settingsMemory']
    print(f"{D}.qwen/settings.json memory block  base: {b_mem}   PR: {json.dumps(pr_mem)}{X}")
    bs = g[('cli-tool', 'base2')][0].get('bySource')
    ps = g[('cli-tool', 'pr')][0].get('bySource')
    print(f"{D}CLI --output-format json stats.bySource  base: {json.dumps(bs)}   PR: {json.dumps(ps)}{X}")


def real():
    rows = [json.loads(l) for l in open(f'{O}/real-ab.jsonl')]
    print(f'{B}{C}Real model qwen3.8-max via the CI endpoint host, local recording proxy, arms interleaved{X}')
    print(f'{D}prompt: "Use the read_file tool to read probe.txt, then reply with exactly the single word it contains."{X}')
    print()
    print(f'{B}{"run":4} {"arm":17} {"requests (class:ms)":58} {"extractor ms":>12} {"wall ms":>8}{X}')
    for r in rows:
        parts = []
        for q in r['requests']:
            col = R if q['klass'] == 'extractor' else (G if q['klass'] == 'main' else Y)
            parts.append(f"{col}{q['klass']}:{q['ms']}{X}")
        vis = ' '.join(f"{q['klass']}:{q['ms']}" for q in r['requests'])
        pad = ' ' * max(0, 58 - len(vis))
        print(f"#{r['rep']:<3} {ARMNAME[r['arm']]:17} {' '.join(parts)}{pad} {r['extractorMs']:>12} {r['wallMs']:>8}  {D}{r['subtype']} '{r['resultText'][:16]}'{X}")
    print()
    for arm in ('base2', 'pr'):
        rs = [r for r in rows if r['arm'] == arm]
        n = [len(r['requests']) for r in rs]
        ex = [sum(1 for q in r['requests'] if q['klass'] == 'extractor') for r in rs]
        print(f"{B}{ARMNAME[arm]}{X}  requests/run {n}  extractor requests/run {ex}  "
              f"median wall {st.median([r['wallMs'] for r in rs]):.0f} ms")


def regress():
    def load(arm):
        d = json.load(open(f'{O}/regress-{arm}.json'))
        res = {}
        for f in d['testResults']:
            rel = os.path.relpath(f['name'], f'/root/verify/pr13013/{arm}/integration-tests')
            if rel.startswith('__verify13013__'):
                continue  # this verification's own harness files
            for a in f['assertionResults']:
                res[(rel, a['fullName'])] = a['status']
        return d, res
    db, b = load('base2')
    dp, p = load('pr')
    print(f'{B}{C}Regression differential: the entire integration-tests tree, every model credential blanked{X}')
    print(f'{D}vitest run --root ./integration-tests (no file filter), JSON reporter, CI=true, retry=2 as configured{X}')
    print()
    for name, res in (('base 6b66321a5a', b), ('PR   77ae21c937', p)):
        files = len({k[0] for k in res})
        cnt = lambda st: sum(1 for v in res.values() if v == st)
        print(f"{name}  files {files:>3}  tests {len(res):>3}  {G}passed {cnt('passed'):>3}{X}  "
              f"{R}failed {cnt('failed'):>3}{X}  skipped {cnt('pending') + cnt('skipped'):>2}")
    keys = sorted(set(b) | set(p))
    diff = [(k, b.get(k), p.get(k)) for k in keys if b.get(k) != p.get(k)]
    print()
    print(f'{B}tests whose status differs between arms: {len(diff)}{X}')
    for k, x, y in diff:
        print(f"  {x or 'absent'} -> {G if y == 'passed' else R}{y}{X}  {k[0]} :: {k[1][:70]}")
    same_fail = sorted({k[0] for k, v in p.items() if v == 'failed' and b.get(k) == 'failed'})
    print()
    print(f'{D}identical failures on both arms (cases that need model credentials or unavailable infra): {", ".join(same_fail)}{X}')


if __name__ == '__main__':
    {'ab': lambda: ab(sys.argv[2]), 'real': real, 'regress': regress}[sys.argv[1]]()
