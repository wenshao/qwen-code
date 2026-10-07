#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13505): targeted mutants over the new cross-record commit checks.
# Each mutant = one anchored replacement in the pr13505-mut worktree; the named suite is rerun;
# fail-closed: the anchor must match exactly once, the baseline must pass with tests > 0, and a
# mutant counts as KILLED only if tests ran (count > 0) and at least one failed.
import json, subprocess, sys, re, os, time
W = os.environ.get('MUT_W', '/Users/wenshao/git/pr13505-mut')
R = '/Users/wenshao/git/pr13505-rig'
JS = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecordStore.java'
JR = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecords.java'
TS = 'packages/core/src/managed-runtime/managed-session-authority.ts'
LS = 'packages/core/src/managed-runtime/local-shell-stream-result-session.ts'
JAVA_TESTS = os.environ.get('JAVA_TESTS', 'ManagedExtensionRecordStoreTest,ManagedChildRunRecordContractTest,ManagedChildAcceptanceRecordContractTest,ManagedExtensionProjectionContractTest')
TS_TESTS = ['src/managed-runtime/managed-session-authority.child-agent.test.ts',
            'src/managed-runtime/managed-session-authority.child-run.test.ts']
if os.environ.get('TS_EXTRA'):
    TS_TESTS += os.environ['TS_EXTRA'].split(',')
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
  ('J7b-closure-result-receipt', JS, 'for (String field : List.of("commandRef", "startReceiptRef", "outputRef",\n                    "inputRef", "resultRef", "terminalReceiptRef")) {',
                                     'for (String field : List.of("commandRef", "startReceiptRef", "outputRef",\n                    "inputRef")) {'),
  ('JF1-id-childRunId', JR, '        id(child.get("childRunId"), "childRunId");\n', ''),
  ('JF2-id-ownerScopeId', JR, '        id(child.get("ownerScopeId"), "ownerScopeId");\n', ''),
  ('JF3-id-rootSessionId', JR, '        id(child.get("rootSessionId"), "rootSessionId");\n', ''),
  # ---- TS authority: acceptance cross-record block ----
  ('T1-kind', TS, "if (child === undefined || child.kind !== 'child_agent') {", "if (child === undefined) {"),
  ('T2-settled', TS, "if (child.run.state !== 'settled' || child.stopReason !== 'completed') {", "if (false) {"),
  ('T3-scope', TS, "child.ownerScopeId !== acceptance.parentScopeId ||", "false ||"),
  ('T4-call', TS, "if (acceptance.parentExecutionCallId !== expectedCall) {", "if (false) {"),
  ('T5-content', TS, "acceptance.contentDigest !== child.resultRef.digest ||", "false ||"),
  ('T6-receipt', TS, "acceptance.terminalReceiptRef.digest !== child.terminalReceiptRef.digest", "false"),
  ('T7-closure-agent', TS, ": [child.inputRef, child.resultRef, child.terminalReceiptRef];", ": [];"),
  ('T8-closure-acceptance', TS, "refs = [acceptance.contentRef, acceptance.terminalReceiptRef];", "refs = [];"),
  ('T7b-closure-result-receipt', TS, ": [child.inputRef, child.resultRef, child.terminalReceiptRef];", ": [child.inputRef];"),
  ('TF3-shell-parser', LS, "import { parseChildShellRun } from './managed-child-run-record.js';", "import { parseChildRun as parseChildShellRun } from './managed-child-run-record.js';"),
  # ---- round 4 (27ba5c26): new enforcement ----
  ('J4-def', JR, 'require(executionState == null || "intent".equals(executionState)\n                || !run.get("definition").isNull(),', 'require(true,'),
  ('J4-runtime', JR, 'require(session.isNull() || !run.get("runtime").isNull(),', 'require(true || session.isNull() || !run.get("runtime").isNull(),'),
  ('J4-drive', JR, '                        && !value.matches("^[A-Za-z]:.*")\n', ''),
  ('J4-root', JS, 'require(!"child_agent".equals(record.get("kind").textValue())', 'require(true || !"child_agent".equals(record.get("kind").textValue())'),
  ('J4-finite-run', JR, '                && Double.isFinite(resultVersion.doubleValue())\n                && resultVersion.decimalValue()\n                        .compareTo(java.math.BigDecimal.ONE) == 0,\n                "Child run resultVersion', '                && resultVersion.decimalValue()\n                        .compareTo(java.math.BigDecimal.ONE) == 0,\n                "Child run resultVersion'),
  ('J4-finite-acc', JR, '                && Double.isFinite(resultVersion.doubleValue())\n                && resultVersion.decimalValue()\n                        .compareTo(java.math.BigDecimal.ONE) == 0,\n                "Child acceptance resultVersion', '                && resultVersion.decimalValue()\n                        .compareTo(java.math.BigDecimal.ONE) == 0,\n                "Child acceptance resultVersion'),
  ('T4-def', 'packages/core/src/managed-runtime/managed-child-run-record.ts', "  if (\n    run.execution !== null &&\n    run.execution !== 'intent' &&\n    run.definition === null\n  ) {", '  if (false) {'),
  ('T4-runtime', 'packages/core/src/managed-runtime/managed-child-run-record.ts', 'if (childSessionId !== null && run.runtime === null) {', 'if (false) {'),
  ('T4-drive', 'packages/core/src/managed-runtime/managed-child-run-record.ts', "    value.includes('\\\\') ||\n    /^[A-Za-z]:/.test(value)\n  ) {", "    value.includes('\\\\')\n  ) {"),
  ('T4-root', TS, 'child.rootSessionId !== this.sessionKey.sessionId', 'false'),
  # ---- round 5 (1682d3b3 + b585e44c): runtime at dispatch, drive spec, R2-1 witnesses ----
  ('T5-dispatch-rt', 'packages/core/src/managed-runtime/managed-child-run-record.ts', "if (run.execution === 'dispatch_started' && run.runtime === null) {", 'if (false) {'),
  ('J5-dispatch-rt', JR, 'require(!"dispatch_started".equals(execution)\n                || !run.get("runtime").isNull(),', 'require(true,'),
  ('J5-drive-matches', JR, '!DRIVE_SPEC.matcher(value).lookingAt()', '!value.matches("^[A-Za-z]:.*")'),
  ('J5-drive-find', JR, '!DRIVE_SPEC.matcher(value).lookingAt()', '!DRIVE_SPEC.matcher(value).find()'),
  ('J5-drive-delete', JR, '                        && !DRIVE_SPEC.matcher(value).lookingAt()\n', ''),
  ('T5-drive-delete', 'packages/core/src/managed-runtime/managed-child-run-record.ts', "    value.includes('\\\\') ||\n    /^[A-Za-z]:/.test(value)\n  ) {", "    value.includes('\\\\')\n  ) {"),
  ('T5-stop-cleared', 'packages/core/src/managed-runtime/managed-child-run-record.ts', '      (!before.stopRequested || after.stopRequested) &&\n', ''),
  ('J5-stop-cleared', JR, '                && (!previous.get("stopRequested").booleanValue()\n                        || next.get("stopRequested").booleanValue())\n', '\n'),
  ('T5-terminal-branch', 'packages/core/src/managed-runtime/managed-child-run-record.ts', '      return (\n        same(beforeRest, afterRest) &&\n        isExtensionRunSuccessor(before.run, after.run)\n      );', '      return true;'),
  ('T5-terminal-rest', 'packages/core/src/managed-runtime/managed-child-run-record.ts', '        same(beforeRest, afterRest) &&\n        isExtensionRunSuccessor(before.run, after.run)', '        isExtensionRunSuccessor(before.run, after.run)'),
  ('T5-terminal-run', 'packages/core/src/managed-runtime/managed-child-run-record.ts', '        same(beforeRest, afterRest) &&\n        isExtensionRunSuccessor(before.run, after.run)', '        same(beforeRest, afterRest)'),
  ('J5-terminal-branch', JR, 'return same(without(previous, "run"), without(next, "run"))\n                    && isRunSuccessor(previous.get("run"), next.get("run"));', 'return true;'),
  ('J5-terminal-rest', JR, 'return same(without(previous, "run"), without(next, "run"))\n                    && isRunSuccessor(previous.get("run"), next.get("run"));', 'return isRunSuccessor(previous.get("run"), next.get("run"));'),
  ('J5-terminal-run', JR, 'return same(without(previous, "run"), without(next, "run"))\n                    && isRunSuccessor(previous.get("run"), next.get("run"));', 'return same(without(previous, "run"), without(next, "run"));'),
  ('T5-failed-freeze', 'packages/core/src/managed-runtime/managed-child-run-record.ts', '    if (TERMINAL_RUN_STATES.includes(before.run.state)) {\n      const beforeRest', "    if (before.run.state === 'settled' || before.run.state === 'cancelled') {\n      const beforeRest"),
  ('J5-failed-freeze', JR, 'if (TERMINAL.contains(text(previous.get("run"), "state"))) {\n            return same(without(previous', 'if (List.of("settled", "cancelled").contains(text(previous.get("run"), "state"))) {\n            return same(without(previous'),
  ('T5-cancel-settled', 'packages/core/src/managed-runtime/managed-child-run-record.ts', "    run.state === 'cancelled' &&\n    run.execution !== 'settled' &&\n", "    run.state === 'cancelled' &&\n"),
  ('J5-cancel-settled', JR, 'require(!"cancelled".equals(state) || "settled".equals(execution)\n                || "not_started_proven".equals(execution),', 'require(!"cancelled".equals(state)\n                || "not_started_proven".equals(execution),'),
  ('T5-session-id', 'packages/core/src/managed-runtime/managed-child-run-record.ts', "  const childSessionId = nullable(body.childSessionId, (each) =>\n    id(each, 'childSessionId'),\n  );", '  const childSessionId = nullable(body.childSessionId, (each) => each as string);'),
  ('J5-session-id', JR, '        if (!session.isNull()) {\n            id(session, "childSessionId");\n        }\n', ''),
  ('T5-empty-segment', 'packages/core/src/managed-runtime/managed-child-run-record.ts', "      .some((segment) => segment === '' || segment === '.' || segment === '..')", "      .some((segment) => segment === '.' || segment === '..')"),
  ('J5-empty-segment', JR, '.noneMatch(segment -> segment.isEmpty()\n                                        || segment.equals(".")', '.noneMatch(segment -> segment.equals(".")'),
  ('T5-depth1', TS, 'child.depth === 1 &&', ''),
  ('J5-depth1', JS, '                    || record.get("depth").longValue() != 1\n', ''),
  ('T5-fixed-ownerScopeId', 'packages/core/src/managed-runtime/managed-child-run-record.ts', 'CHILD_AGENT_FIXED_KEYS.every((key) => same(before[key], after[key])) &&', "CHILD_AGENT_FIXED_KEYS.every((key) => key === 'ownerScopeId' || same(before[key], after[key])) &&"),
  ('J5-fixed-ownerScopeId', JR, 'for (String key : CHILD_AGENT_FIXED) {\n            if (!same(previous.get(key), next.get(key))) {', 'for (String key : CHILD_AGENT_FIXED) {\n            if (!key.equals("ownerScopeId") && !same(previous.get(key), next.get(key))) {'),
  ('T5-fixed-rootSessionId', 'packages/core/src/managed-runtime/managed-child-run-record.ts', 'CHILD_AGENT_FIXED_KEYS.every((key) => same(before[key], after[key])) &&', "CHILD_AGENT_FIXED_KEYS.every((key) => key === 'rootSessionId' || same(before[key], after[key])) &&"),
  ('J5-fixed-rootSessionId', JR, 'for (String key : CHILD_AGENT_FIXED) {\n            if (!same(previous.get(key), next.get(key))) {', 'for (String key : CHILD_AGENT_FIXED) {\n            if (!key.equals("rootSessionId") && !same(previous.get(key), next.get(key))) {'),
  ('T5-fixed-workingDirectory', 'packages/core/src/managed-runtime/managed-child-run-record.ts', 'CHILD_AGENT_FIXED_KEYS.every((key) => same(before[key], after[key])) &&', "CHILD_AGENT_FIXED_KEYS.every((key) => key === 'workingDirectory' || same(before[key], after[key])) &&"),
  ('J5-fixed-workingDirectory', JR, 'for (String key : CHILD_AGENT_FIXED) {\n            if (!same(previous.get(key), next.get(key))) {', 'for (String key : CHILD_AGENT_FIXED) {\n            if (!key.equals("workingDirectory") && !same(previous.get(key), next.get(key))) {'),
  ('T5-fixed-inputRef', 'packages/core/src/managed-runtime/managed-child-run-record.ts', 'CHILD_AGENT_FIXED_KEYS.every((key) => same(before[key], after[key])) &&', "CHILD_AGENT_FIXED_KEYS.every((key) => key === 'inputRef' || same(before[key], after[key])) &&"),
  ('J5-fixed-inputRef', JR, 'for (String key : CHILD_AGENT_FIXED) {\n            if (!same(previous.get(key), next.get(key))) {', 'for (String key : CHILD_AGENT_FIXED) {\n            if (!key.equals("inputRef") && !same(previous.get(key), next.get(key))) {'),
  ('T5-fixed-predecessorChildRunId', 'packages/core/src/managed-runtime/managed-child-run-record.ts', 'CHILD_AGENT_FIXED_KEYS.every((key) => same(before[key], after[key])) &&', "CHILD_AGENT_FIXED_KEYS.every((key) => key === 'predecessorChildRunId' || same(before[key], after[key])) &&"),
  ('J5-fixed-predecessorChildRunId', JR, 'for (String key : CHILD_AGENT_FIXED) {\n            if (!same(previous.get(key), next.get(key))) {', 'for (String key : CHILD_AGENT_FIXED) {\n            if (!key.equals("predecessorChildRunId") && !same(previous.get(key), next.get(key))) {'),
  # ---- round 5b (777e947b + 10a83866): binding also required for outcome_unknown ----
  ('T6-unknown-rt', 'packages/core/src/managed-runtime/managed-child-run-record.ts', "    (run.execution === 'dispatch_started' ||\n      run.execution === 'outcome_unknown') &&\n    run.runtime === null", "    run.execution === 'dispatch_started' &&\n    run.runtime === null"),
  ('T6-dispatch-rt', 'packages/core/src/managed-runtime/managed-child-run-record.ts', "    (run.execution === 'dispatch_started' ||\n      run.execution === 'outcome_unknown') &&\n    run.runtime === null", "    run.execution === 'outcome_unknown' &&\n    run.runtime === null"),
  ('J6-unknown-rt', JR, 'require((!"dispatch_started".equals(execution)\n                        && !"outcome_unknown".equals(execution))', 'require((!"dispatch_started".equals(execution))'),
  ('J6-dispatch-rt', JR, 'require((!"dispatch_started".equals(execution)\n                        && !"outcome_unknown".equals(execution))', 'require((!"outcome_unknown".equals(execution))'),
]

def run_java(label):
    log = f'{R}/logs/mut-{label}.log'
    with open(log, 'w') as f:
        p = subprocess.run(['mvn', '-B', '-ntp', '-o', f'-Dmaven.repo.local={R}/m2', '-Dcheckstyle.skip', '-Dspotbugs.skip',
                            *([] if JAVA_TESTS == 'ALL' else [f'-Dtest={JAVA_TESTS}', '-Dsurefire.failIfNoSpecifiedTests=false']), 'test'],
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
        if (lang == 'java') != path.endswith('.java'):
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
