"""Runs the TS or Java mutant set: PR's own tests + differential fuzz vs the other language's pristine side.
usage: python3 run-mutants.py ts|java [ids...]
"""
import json, os, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from mutants import M, apply

V = '/root/verify/pr13548'
HEAD, MUT = f'{V}/head', f'{V}/mut'
JDK = '/root/Install/jdk21/bin'
CP = open(f'{V}/cp-head.txt').read().strip()
LAUNCHER = open(f'{V}/harness/launcher.txt').read().strip()
SERVER = f'{HEAD}/packages/sdk-java/managed-agent-server'
SEEDS = ['5001', '5002']
lang = sys.argv[1]
only = set(sys.argv[2:])
out = open(f'{V}/logs/mutants-{lang}.jsonl', 'a')


def fuzz(verdict_cmd, other):
    diffs, witness = 0, None
    for s in SEEDS:
        with open(f'{V}/mutfuzz/cases-{s}.jsonl') as f:
            got = subprocess.run(verdict_cmd, stdin=f, capture_output=True, text=True, timeout=600).stdout
        mine = dict(l.split('\t', 1) for l in got.splitlines() if l)
        for l in open(f'{V}/mutfuzz/{other}-pristine-{s}.txt'):
            k, v = l.rstrip('\n').split('\t', 1)
            if mine.get(k) != v:
                diffs += 1
                if witness is None: witness = f'{s}:{k} pristine={v} mutant={mine.get(k)}'
    return diffs, witness


def ts_mutant(m):
    path = f"{MUT}/{m['file']}"
    pristine = open(f"{HEAD}/{m['file']}").read()
    src = pristine if m['id'] == 'T000' else apply(pristine, m)
    os.remove(path); open(path, 'w').write(src)
    rep = f'{V}/logs/vitest-{m["id"]}.json'
    t0 = time.time()
    subprocess.run(['npx', 'vitest', 'run', 'src/managed-runtime/managed-channel-record.test.ts',
                    'src/managed-runtime/managed-session-authority.channel.test.ts',
                    'src/managed-runtime/managed-extension-projection.test.ts',
                    '--reporter=json', f'--outputFile={rep}'], cwd=f'{MUT}/packages/core', capture_output=True, timeout=600)
    try:
        r = json.load(open(rep))
        failed = [t['fullName'] for f in r['testResults'] for t in f['assertionResults'] if t['status'] != 'passed']
        total = r['numTotalTests']
        suite_err = [f['name'].split('/')[-1] for f in r['testResults'] if f['status'] == 'failed' and not any(t['status'] == 'failed' for t in f['assertionResults'])]
    except Exception as e:
        failed, total, suite_err = ['<no report>'], 0, [str(e)]
    res = dict(id=m['id'], desc=m['desc'], file=os.path.basename(m['file']), tests=total, failed=len(failed), suite_errors=suite_err, first_failed=failed[:3])
    if m['file'].endswith('managed-channel-record.ts'):
        js = subprocess.run(['node', '-e', "const e=require('esbuild');const fs=require('fs');process.stdout.write(e.transformSync(fs.readFileSync(0,'utf8'),{loader:'ts',format:'esm'}).code)"],
                            input=src, capture_output=True, text=True, cwd=MUT, check=True).stdout
        dist = f'{MUT}/packages/core/dist/src/managed-runtime/managed-channel-record.js'
        os.remove(dist); open(dist, 'w').write(js)
        res['fuzz_diffs'], res['fuzz_witness'] = fuzz(['node', f'{V}/harness/ts-eval.mjs', f'{MUT}/packages/core/dist/src/managed-runtime'], 'java')
        os.remove(dist); shutil.copyfile(f'{HEAD}/packages/core/dist/src/managed-runtime/managed-channel-record.js', dist)
    os.remove(path); open(path, 'w').write(pristine)
    res['secs'] = round(time.time() - t0, 1)
    return res


def java_mutant(m):
    pristine = open(f"{HEAD}/{m['file']}").read()
    src = pristine if m['id'] == 'J000' else apply(pristine, m)
    d = f"{V}/jmut/{m['id']}"
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(f'{d}/src'); os.makedirs(f'{d}/classes')
    open(f'{d}/src/ManagedChannelRecords.java', 'w').write(src)
    t0 = time.time()
    c = subprocess.run([f'{JDK}/javac', '--release', '21', '-nowarn', '-cp', f'{SERVER}/target/classes:{CP}', '-d', f'{d}/classes', f'{d}/src/ManagedChannelRecords.java'], capture_output=True, text=True)
    if c.returncode != 0:
        return dict(id=m['id'], desc=m['desc'], compile_error=c.stderr[-300:])
    cp = f'{d}/classes:{SERVER}/target/test-classes:{SERVER}/target/classes:{CP}:{LAUNCHER}:{V}/harness/jrun-out'
    r = subprocess.run([f'{JDK}/java', '-cp', cp, 'JRun', 'com.alibaba.qwen.code.managedagent.ManagedChannelRecordContractTest',
                        'com.alibaba.qwen.code.managedagent.ManagedExtensionProjectionContractTest',
                        'com.alibaba.qwen.code.managedagent.ManagedExtensionRecordStoreTest'], capture_output=True, text=True, cwd=SERVER, timeout=600)
    lines = [l for l in r.stdout.splitlines() if l.startswith(('RUN=', 'F '))]
    summary = lines[0] if lines else 'RUN=? ' + r.stderr[-200:]
    res = dict(id=m['id'], desc=m['desc'], junit=summary, first_failed=lines[1:4])
    res['failed'] = int(summary.split('FAIL=')[1]) if 'FAIL=' in summary else -1
    res['fuzz_diffs'], res['fuzz_witness'] = fuzz([f'{JDK}/java', '-cp', f'{d}/classes:{V}/harness/javaeval-out-head:{SERVER}/target/classes:{CP}', 'com.alibaba.qwen.code.managedagent.store.ChannelDiffEval'], 'ts')
    res['secs'] = round(time.time() - t0, 1)
    return res


todo = [dict(id='T000' if lang == 'ts' else 'J000', lang=lang, file=M[0]['file'] if lang == 'ts' else M[1]['file'], desc='control (unmutated)')] + [m for m in M if m['lang'] == lang]
for m in todo:
    if only and m['id'] not in only: continue
    res = ts_mutant(m) if lang == 'ts' else java_mutant(m)
    print(json.dumps(res), flush=True)
    out.write(json.dumps(res) + '\n'); out.flush()
