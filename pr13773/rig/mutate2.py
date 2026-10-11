#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13773): source mutants on a git-less clone of the PR head; runs the two suites the PR touches.
# usage: mutate.py [ids...]   -> out/mutants-h2.jsonl (one line per mutant: killed/survived + failing test names)
import json, os, re, subprocess, sys, time, shutil

ROOT = '/Users/wenshao/git/qwen-code-pr13773-mut2'
CLI = f'{ROOT}/packages/cli'
A = f'{CLI}/src/serve/hosted-hook-session.ts'
B = f'{CLI}/src/serve/hosted-workspace-tool-turn.ts'
OUT = '/Users/wenshao/pr13773-rig/out/mutants-h2.jsonl'
NODE_BIN = '/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin'
TESTS = ['src/serve/hosted-workspace-tool-turn.child-agent.test.ts', 'src/serve/hosted-hook-session.test.ts']
if os.environ.get('TESTS'): TESTS = os.environ['TESTS'].split(',')
if os.environ.get('OUTF'): OUT = os.environ['OUTF']


def swap_arms(src):
    s1 = src.index('          } else if (this.sessionOwnerMayHoldMount()) {')
    s2 = src.index('          } else if (!agentBackground && this.acquired) {')
    s3 = src.index('          } else if (\n            !agentBackground &&\n            calls.some((other) => other.name !== \'agent\')')
    owner, turn = src[s1:s2], src[s2:s3]
    return src[:s1] + turn + owner + src[s3:]


SETTLED = """        .filter(
          (entry) =>
            entry.run.state !== 'recovery_blocked' &&
            (entry.resultRef !== null ||
              entry.run.execution === 'not_started_proven'),
        )
"""
M = {
    'M01-no-future-term': (B, "      (this.hooks?.mountHeld ?? false) ||\n      (this.hooks?.hasMountableToolResultHooks ?? false)", "      (this.hooks?.mountHeld ?? false)"),
    'M02-drop-PostToolBatch': (A, " ||\n            hook.eventName === HookEventName.PostToolBatch", ""),
    'M03-drop-PostToolUseFailure': (A, " ||\n            hook.eventName === HookEventName.PostToolUseFailure", ""),
    'M04-drop-PostToolUse': (A, "(hook.eventName === HookEventName.PostToolUse ||\n            ", "("),
    'M05-type-nonPrompt': (A, "hook.config.type === HookType.Command &&\n          this.isHookEligible(hook, usedOnce, null)", "hook.config.type !== HookType.Prompt &&\n          this.isHookEligible(hook, usedOnce, null)"),
    'M06-type-any': (A, "hook.config.type === HookType.Command &&\n          this.isHookEligible(hook, usedOnce, null)", "this.isHookEligible(hook, usedOnce, null)"),
    'M07-getter-skips-matcher-hooks(R1-4)': (A, "this.isHookEligible(hook, usedOnce, null) &&", "this.isHookEligible(hook, usedOnce, null) &&\n          !hook.matcher &&"),
    'M08-revert-settled-filter(R1-1)': (A, SETTLED, ""),
    'M09-settled-ignores-recovery_blocked': (A, "            entry.run.state !== 'recovery_blocked' &&\n            (entry.resultRef", "            (entry.resultRef"),
    'M10-getter-ignores-once': (A, "this.isHookEligible(hook, usedOnce, null)", "this.isHookEligible(hook, new Set(), null)"),
    'M11-eligible-drop-enabled': (A, "      hook.enabled !== false &&\n      hook.sourceTrusted !== false &&", "      hook.sourceTrusted !== false &&"),
    'M12-eligible-drop-trusted': (A, "      hook.enabled !== false &&\n      hook.sourceTrusted !== false &&", "      hook.enabled !== false &&"),
    'M13-eligible-drop-owner-session': (A, "      (!hook.owner || hook.owner.sessionId === this.key.sessionId) &&\n      (!hook.agentScope", "      (!hook.agentScope"),
    'M14-eligible-drop-agentScope': (A, "      (!hook.agentScope ||\n        (hook.owner !== undefined && hook.owner.agentId === agentId)) &&\n", ""),
    'M15-dispatch-agentId-null': (A, "(fields['agent_id'] as string | undefined) ?? null", "null"),
    'M16-turn-arm-drop-fg-guard(R1-6)': (B, "} else if (!agentBackground && this.acquired) {", "} else if (this.acquired) {"),
    'M17-swap-arms': (B, None, swap_arms),
    'M18-owner-drop-mcp-term': (B, "      (this.mcp?.mountHeld ?? false) ||\n      (this.hooks?.mountHeld ?? false) ||", "      (this.hooks?.mountHeld ?? false) ||"),
    'M19-owner-drop-hooks-term': (B, "      (this.mcp?.mountHeld ?? false) ||\n      (this.hooks?.mountHeld ?? false) ||", "      (this.mcp?.mountHeld ?? false) ||"),
    'M20-owner-arm-background-only': (B, "} else if (this.sessionOwnerMayHoldMount()) {", "} else if (agentBackground && this.sessionOwnerMayHoldMount()) {"),
    'M21-owner-arm-foreground-only': (B, "} else if (this.sessionOwnerMayHoldMount()) {", "} else if (!agentBackground && this.sessionOwnerMayHoldMount()) {"),
    'M22-turn-arm-removed': (B, "} else if (!agentBackground && this.acquired) {", "} else if (false as boolean) {"),
}


def run_suite():
    env = dict(os.environ, PATH=f"{NODE_BIN}:{os.environ['PATH']}")
    t0 = time.time()
    p = subprocess.run(['npx', 'vitest', 'run', *TESTS, '--reporter=json', '--outputFile=/tmp/pr13773-mut2-report.json', '--coverage.enabled=false'],
                       cwd=CLI, env=env, capture_output=True, text=True, timeout=1500)
    secs = round(time.time() - t0)
    try:
        rep = json.load(open('/tmp/pr13773-mut2-report.json'))
    except Exception:
        return {'error': 'no-report', 'rc': p.returncode, 'tail': (p.stdout + p.stderr)[-800:], 'secs': secs}
    failed = [a['fullName'] for f in rep['testResults'] for a in f['assertionResults'] if a['status'] == 'failed']
    return {'rc': p.returncode, 'total': rep['numTotalTests'], 'passed': rep['numPassedTests'], 'failedN': rep['numFailedTests'],
            'failed': failed, 'suiteFail': [f['name'].split('/')[-1] for f in rep['testResults'] if f['status'] == 'failed' and not any(a['status'] == 'failed' for a in f['assertionResults'])], 'secs': secs}


def main():
    ids = sys.argv[1:] or ['BASELINE', *M.keys()]
    for mid in ids:
        if mid == 'BASELINE':
            r = run_suite(); r.update(id='BASELINE'); print(json.dumps(r)[:600], flush=True)
            open(OUT, 'a').write(json.dumps(r) + '\n'); continue
        f, old, new = M[mid]
        orig = open(f).read()
        if callable(new):
            mutated = new(orig)
        else:
            n = orig.count(old)
            if n != 1:
                r = {'id': mid, 'error': f'pattern count {n}'}; print(json.dumps(r), flush=True); open(OUT, 'a').write(json.dumps(r) + '\n'); continue
            mutated = orig.replace(old, new)
        assert mutated != orig
        open(f, 'w').write(mutated)
        try:
            r = run_suite()
        finally:
            open(f, 'w').write(orig)
        assert open(f).read() == orig
        r['id'] = mid
        r['verdict'] = 'error' if 'error' in r else ('killed' if r['failedN'] > 0 or r['suiteFail'] else 'SURVIVED')
        print(json.dumps({k: r[k] for k in r if k != 'failed'})[:400], ('| killed by: ' + '; '.join(r.get('failed', [])[:3]))[:400], flush=True)
        open(OUT, 'a').write(json.dumps(r) + '\n')


main()
