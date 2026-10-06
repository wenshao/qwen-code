#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13505): targeted mutants over the new cross-record commit checks.
# Each mutant = one anchored replacement in the pr13505-mut worktree; the named suite is rerun;
# fail-closed: the anchor must match exactly once, the baseline must pass with tests > 0, and a
# mutant counts as KILLED only if tests ran (count > 0) and at least one failed.
import json, subprocess, sys, re, os, time
W = os.environ.get('MUT_W', '/Users/wenshao/git/pr13505-mut')
R = '/Users/wenshao/git/pr13505-rig'
JS = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecordStore.java'
TS = 'packages/core/src/managed-runtime/managed-session-authority.ts'
JAVA_TESTS = 'ManagedExtensionRecordStoreTest,ManagedChildRunRecordContractTest,ManagedChildAcceptanceRecordContractTest,ManagedExtensionProjectionContractTest'
TS_TESTS = ['src/managed-runtime/managed-session-authority.child-agent.test.ts',
            'src/managed-runtime/managed-session-authority.child-run.test.ts']
ENV = {k: v for k, v in os.environ.items() if 'proxy' not in k.lower()}
ENV.update(JAVA_HOME='/Users/wenshao/Install/jdk21', TZ='UTC')
ENV['PATH'] = '/Users/wenshao/Install/jdk21/bin:' + ENV['PATH']

MUTANTS = [
  # ---- Java store: acceptance cross-record block ----
  ('J1-kind', JS, 'require("child_agent".equals(child.get("kind").textValue()),', 'require(true || "child_agent".equals(child.get("kind").textValue()),'),
  ('J2-settled', JS, 'require("settled".equals(child.get("run").get("state").textValue())\n                    && "completed".equals(child.get("stopReason").textValue()),',
                     'require(true,'),
  ('J3-scope', JS, 'require(child.get("ownerScopeId").textValue().equals(\n                    record.get("parentScopeId").textValue())\n                    && child',
                   'require(true\n                    && child'),
  ('J4-call', JS, 'require(Objects.equals(expectedCall, actualCall),', 'require(true || Objects.equals(expectedCall, actualCall),'),
  ('J5-content', JS, '&& record.get("contentDigest").textValue().equals(\n                            child.get("resultRef").get("digest").textValue())',
                     '&& true'),
  ('J6-receipt', JS, '&& record.get("terminalReceiptRef").get("digest")\n                            .textValue().equals(child.get("terminalReceiptRef")\n                                    .get("digest").textValue()),',
                     '&& true,'),
  ('J7-closure-agent', JS, 'for (String field : List.of("commandRef", "startReceiptRef", "outputRef",\n                    "inputRef", "resultRef", "terminalReceiptRef")) {',
                           'for (String field : List.of("commandRef", "startReceiptRef", "outputRef")) {'),
  ('J8-closure-acceptance', JS, 'for (String field : List.of("contentRef", "terminalReceiptRef")) {', 'for (String field : List.<String>of()) {'),
  ('J9-taskkind-null', JS, 'body.taskKindOf().apply(record) == null ? null : projection.state(), projection.runtimeState(),',
                           'projection.state(), projection.runtimeState(),'),
  # ---- TS authority: acceptance cross-record block ----
  ('T1-kind', TS, "if (child === undefined || child.kind !== 'child_agent') {", "if (child === undefined) {"),
  ('T2-settled', TS, "if (child.run.state !== 'settled' || child.stopReason !== 'completed') {", "if (false) {"),
  ('T3-scope', TS, "child.ownerScopeId !== acceptance.parentScopeId ||", "false ||"),
  ('T4-call', TS, "if (acceptance.parentExecutionCallId !== expectedCall) {", "if (false) {"),
  ('T5-content', TS, "acceptance.contentDigest !== child.resultRef.digest ||", "false ||"),
  ('T6-receipt', TS, "acceptance.terminalReceiptRef.digest !== child.terminalReceiptRef.digest", "false"),
  ('T7-closure-agent', TS, ": [child.inputRef, child.resultRef, child.terminalReceiptRef];", ": [];"),
  ('T8-closure-acceptance', TS, "refs = [acceptance.contentRef, acceptance.terminalReceiptRef];", "refs = [];"),
]

def run_java(label):
    log = f'{R}/logs/mut-{label}.log'
    with open(log, 'w') as f:
        p = subprocess.run(['mvn', '-B', '-ntp', '-o', f'-Dmaven.repo.local={R}/m2', '-Dcheckstyle.skip', '-Dspotbugs.skip',
                            f'-Dtest={JAVA_TESTS}', '-Dsurefire.failIfNoSpecifiedTests=false', 'test'],
                           cwd=f'{W}/packages/sdk-java/managed-agent-server', stdout=f, stderr=subprocess.STDOUT, env=ENV)
    text = open(log).read()
    m = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$', text, re.M)
    total = sum(int(x[0]) for x in m[-1:]) if m else 0
    bad = sum(int(x[1]) + int(x[2]) for x in m[-1:]) if m else 0
    compile_err = 'COMPILATION ERROR' in text
    return p.returncode, total, bad, compile_err

def run_ts(label):
    log = f'{R}/logs/mut-{label}.log'
    with open(log, 'w') as f:
        p = subprocess.run(['npx', 'vitest', 'run', *TS_TESTS], cwd=f'{W}/packages/core', stdout=f, stderr=subprocess.STDOUT, env=ENV)
    text = open(log).read()
    m = re.search(r'Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)', text)
    m2 = re.search(r'Tests\s+(\d+) failed \((\d+)\)', text)
    if m:
        total = int(m.group(3)); bad = int(m.group(1) or 0)
    elif m2:
        total = int(m2.group(2)); bad = int(m2.group(1))
    else:
        total = 0; bad = 0
    return p.returncode, total, bad, False

def main(which):
    out = open(f'{R}/results/mutants{os.environ.get("MUT_TAG", "")}.tsv', 'a')
    lang = which
    runner = run_java if lang == 'java' else run_ts
    code, total, bad, ce = runner(f'{lang}-baseline')
    line = f'BASELINE\t{lang}\texit={code}\ttotal={total}\tfailed={bad}'
    print(line); out.write(line + '\n'); out.flush()
    if code != 0 or total == 0 or bad != 0:
        print('baseline not green; abort'); return
    for mid, path, old, new in MUTANTS:
        if (lang == 'java') != (path == JS):
            continue
        if os.environ.get('ONLY') and mid not in os.environ['ONLY'].split(','):
            continue
        fp = f'{W}/{path}'
        src = open(fp).read()
        n = src.count(old)
        if n != 1:
            line = f'{mid}\tANCHOR-COUNT={n}\tINVALID'
            print(line); out.write(line + '\n'); out.flush(); continue
        open(fp, 'w').write(src.replace(old, new))
        try:
            code, total, bad, ce = runner(mid)
        finally:
            subprocess.run(['git', 'checkout', '--', path], cwd=W)
        assert open(fp).read() == src
        verdict = 'INVALID(compile)' if ce else ('KILLED' if total > 0 and bad > 0 else ('SURVIVED' if total > 0 and code == 0 else f'UNCLEAR(exit={code})'))
        line = f'{mid}\t{verdict}\ttotal={total}\tfailed={bad}'
        print(line); out.write(line + '\n'); out.flush()

main(sys.argv[1])
