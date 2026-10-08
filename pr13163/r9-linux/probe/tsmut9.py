#!/usr/bin/env python3
# VERIFICATION ONLY (PR #13163 R9): one-at-a-time mutants of the Harness fixes landed since round 8
# (0227b250, 2740c230, guarded by the tests from 39267a90). Each mutant is applied to the head source,
# the Harness suite runs, and the source is restored byte-for-byte from a saved copy.
import pathlib, subprocess, sys, json, re, shutil
W = pathlib.Path('/root/verify/pr13163-r9/h9')
SRC = W / 'packages/cli/src/serve/hosted-harness-session.ts'
OUT = pathlib.Path('/root/verify/pr13163-r9/out/tsmut')
OUT.mkdir(parents=True, exist_ok=True)
orig = SRC.read_text()
shutil.copy(SRC, OUT / 'hosted-harness-session.ts.orig')

def block(cond, code, owed=True, indent='    '):
    lines = [f'{indent}if ({cond}) {{']
    if owed:
        lines.append(f'{indent}  noteOwedAdoption(resident, sessionId);')
    lines += [f'{indent}  {code}', f'{indent}  return;', f'{indent}}}', '']
    return '\n'.join(lines)

M = {
  'T1-idle-guard (2740c230)': (block('resident.active !== undefined', "error(res, 409, 'hosted_turn_active');"), ''),
  'T2-identity-guard (0227b250, pinned by 39267a90)': (block('sessions.get(sessionId) !== resident', "error(res, 404, 'hosted_session_not_found');"), ''),
  'T3-closing-guard (0227b250, pinned by 39267a90)': (block('resident.mcpClosing', "error(res, 409, 'hosted_session_closing');"), ''),
  'T4-cancel-settle identity (R2-5, 0227b250)': (
      "            if (sessions.get(sessionId) !== resident) {\n              error(res, 404, 'hosted_session_not_found');\n              return;\n            }\n            if (resident.mcpClosing) {\n              error(res, 409, 'hosted_session_closing');\n              return;\n            }\n            writeStderrLineSafe(\n              `qwen serve: Hosted Session ${sessionId} settles the cancelled park",
      "            if (resident.mcpClosing) {\n              error(res, 409, 'hosted_session_closing');\n              return;\n            }\n            writeStderrLineSafe(\n              `qwen serve: Hosted Session ${sessionId} settles the cancelled park"),
  'T5-cancel-settle closing (0227b250)': (
      "            if (resident.mcpClosing) {\n              error(res, 409, 'hosted_session_closing');\n              return;\n            }\n            writeStderrLineSafe(\n              `qwen serve: Hosted Session ${sessionId} settles the cancelled park",
      "            writeStderrLineSafe(\n              `qwen serve: Hosted Session ${sessionId} settles the cancelled park"),
  'T6-resident decline code (R2-1, 0227b250)': (
      "        if (outcome.kind === 'declined') {\n          recoveryDeclined(res, outcome.reason);\n          return;\n        }\n        if (outcome.kind === 'inapplicable') {\n          await answerResidentInapplicable(res, sessionId, resident, parked);",
      "        if (outcome.kind === 'declined') {\n          error(res, 409, 'hosted_session_already_attached');\n          return;\n        }\n        if (outcome.kind === 'inapplicable') {\n          await answerResidentInapplicable(res, sessionId, resident, parked);"),
  'T7-settled file history predicate (0227b250)': ("    (fileHistory.pendingTurn || fileHistory.pendingUndo) &&\n", ''),
  'T8-requested approval reattach (R2-2, 0227b250)': (
      "    const approvalPending =\n      authorization.status === 'runnable' &&\n      authorization.checkpoint.approval?.state === 'requested';",
      "    const approvalPending = false as boolean;\n    void authorization;"),
}

only = sys.argv[1:]
results = []
def run(tag):
    log = OUT / (re.sub(r'[^A-Za-z0-9]+', '_', tag) + '.log')
    p = subprocess.run(['npx', 'vitest', 'run', 'src/serve/hosted-harness-session.test.ts', '--reporter=default'],
                       cwd=W / 'packages/cli', capture_output=True, text=True, env={**__import__('os').environ, 'CI': 'true', 'FORCE_COLOR': '0'})
    text = p.stdout + p.stderr
    log.write_text(text)
    m = re.search(r'Tests\s+(.*)', text)
    failed = sorted(set(re.findall(r'(?m)^\s*(?:×|FAIL)\s+.*?hosted-harness-session\.test\.ts\s*>\s*(.*?)(?:\s+\d+ms)?$', text)))
    return p.returncode, (m.group(1).strip() if m else '?'), failed

try:
    if not only or 'control' in only:
        rc, summary, failed = run('control-unmutated')
        results.append({'mutant': 'control (unmutated head)', 'rc': rc, 'tests': summary, 'failed': failed})
        print(json.dumps(results[-1]), flush=True)
    for tag, (a, b) in M.items():
        if only and not any(o in tag for o in only):
            continue
        n = orig.count(a)
        if n != 1:
            results.append({'mutant': tag, 'error': f'anchor matched {n} times'}); print(json.dumps(results[-1]), flush=True); continue
        SRC.write_text(orig.replace(a, b, 1))
        rc, summary, failed = run(tag)
        SRC.write_text(orig)
        results.append({'mutant': tag, 'rc': rc, 'tests': summary, 'killed': rc != 0, 'failed': failed})
        print(json.dumps(results[-1]), flush=True)
finally:
    SRC.write_text(orig)
    assert SRC.read_text() == orig
(OUT / 'results.json').write_text(json.dumps(results, indent=2))
