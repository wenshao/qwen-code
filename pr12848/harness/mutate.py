#!/usr/bin/env python3
"""Mutation run for #12848 in wt-mut (clean detached checkout of the PR head).

Each mutant is one exact, single-occurrence replacement. The file is restored
with `git checkout -- <file>` afterwards (wt-mut has no local edits).
"""
import json, re, subprocess, sys, time, os

SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad'
WT = f'{SP}/wt-mut'
CLI = ['src/serve/hosted-shell-publisher.test.ts', 'src/serve/hosted-workspace-broker.test.ts',
       'src/serve/hosted-harness-session.test.ts', 'src/serve/hosted-workspace-tool-turn.test.ts',
       'src/serve/managed-context-worker.test.ts', 'src/serve/managed-runtime-attestation-worker.test.ts',
       'src/serve/managed-runtime-tool-v3-routes.test.ts', 'src/serve/managed-runtime-tool-worker.test.ts',
       'src/serve/hosted-harness-model.test.ts']
CORE = ['src/managed-runtime/http-managed-session-store.test.ts', 'src/managed-runtime/resource-tool-result-store.test.ts',
        'src/managed-runtime/managed-harness-factory.test.ts', 'src/managed-runtime/local-shell-result-session.test.ts',
        'src/managed-runtime/local-shell-result-capture.test.ts']

P = 'packages/cli/src/serve/'
C = 'packages/core/src/managed-runtime/'
MUTANTS = [
  ('M1', 'publisher write accepts any offset', P + 'hosted-shell-publisher.ts',
   "        body['offset'] !== entry.offsets[stream] ||\n", ''),
  ('M2', 'worker raw writes not serialized per stream', P + 'managed-shell-publisher.ts',
   "    return (this.queues[stream] = this.queues[stream].then(() =>\n      this.append(stream, chunk),\n    ));",
   "    return this.append(stream, chunk);"),
  ('M3', 'model preview budget 8 KiB -> 64 KiB', P + 'managed-shell-publisher.ts',
   "  let remaining = 8 * 1024;", "  let remaining = 64 * 1024;"),
  ('M4', 'blocked receipt does not stop the turn', P + 'hosted-workspace-tool-turn.ts',
   "        if (receipt?.deliveryStatus === 'blocked') {", "        if (false) {"),
  ('M5', 'no truncation notice to the model', P + 'hosted-workspace-tool-turn.ts',
   "        const modelParts = shellResult?.capture?.previewTruncated", "        const modelParts = false"),
  ('M6', 'accept ignores a changed envelope', P + 'hosted-shell-publisher.ts',
   "        !entry.envelope ||\n        JSON.stringify(envelope) !== JSON.stringify(entry.envelope)\n", "        !entry.envelope\n"),
  ('M7', 'receipt() ignores deliveryStatus mismatch', P + 'hosted-shell-publisher.ts',
   "      !receipt ||\n      receipt.deliveryStatus !== deliveredEnvelope.capture.deliveryStatus\n", "      !receipt\n"),
  ('M8', 'worker accepts any publisher URL', P + 'managed-shell-publisher.ts',
   "  if (!match || Number(match[1]) > 65535)\n    throw new Error('Invalid Shell publisher URL.');\n  return", "  return"),
  ('M9', 'worker publisher registration is replaceable', P + 'managed-shell-publisher.ts',
   "          !available(sessionId) ||\n          (previous && JSON.stringify(previous) !== JSON.stringify(publisher))\n",
   "          !available(sessionId)\n"),
  ('M10', 'worker publisher registration ignores activation', P + 'managed-shell-publisher.ts',
   "          !available(sessionId) ||\n", ""),
  ('M11', 'turn does not close the publisher', P + 'hosted-harness-session.ts',
   "          await toolTurn?.close();", "          void 0;"),
  ('M12', 'finalize ignores worker-reported failure', P + 'hosted-shell-publisher.ts',
   "    if (body['failed']) sink.failCapture();", ""),
  ('M13', 'publisher token check skipped', P + 'hosted-shell-publisher.ts',
   "          token.length !== expected.length ||\n          !timingSafeEqual(token, expected)\n", "          false\n"),
  ('C1', 'segment store accepts out-of-order ordinals', C + 'resource-tool-result-store.ts',
   "      if (stream.sealed || input.ordinal !== stream.receipts.length)", "      if (stream.sealed)"),
  ('C2', 'readRange skips the seal', C + 'resource-tool-result-store.ts',
   "      if (entry.state === 'sealed') {", "      if (false) {"),
  ('C3', 'readRange skips identity check', C + 'resource-tool-result-store.ts',
   "        if (manifest[key] !== request.expectedIdentity?.[key]) return conflict;", ""),
  ('C4', 'admission prepare ignores activation in checkpoint', C + 'managed-shell-result-session.ts',
   "      checkpoint.identity.activationId !== this.activation.activationId ||\n", ""),
  ('C5', 'unfinished turn can be relabeled', 'packages/core/src/managed-runtime/managed-harness-factory.ts',
   "        previous.continuation.phase !== 'before_model' &&\n        previous.continuation.phase !== 'turn_settled'\n", "        false\n"),
  ('C6', 'HTTP resource read ignores declared length', C + 'http-managed-session-store.ts',
   "        if (length > ref.byteLength) {", "        if (false) {"),
  ('C7', 'publishToolResult accepts oversize', C + 'http-managed-session-store.ts',
   "      source.byteLength < 1 ||\n      source.byteLength > limit\n", "      source.byteLength < 1\n"),
]

def run(pkg, files):
    t0 = time.time()
    r = subprocess.run(['npx', 'vitest', 'run', *files], cwd=f'{WT}/packages/{pkg}', capture_output=True, text=True, timeout=1200)
    out = r.stdout + r.stderr
    # Parse "Tests  N failed | M passed" from the summary line starting with 'Tests' (not 'Failed Tests').
    m = [l for l in out.splitlines() if re.match(r'^\s+Tests\s+\d', l)]
    return r.returncode, (m[-1].strip() if m else out.strip().splitlines()[-1][:160]), time.time() - t0

only = sys.argv[1:]
results = []
for mid, desc, path, old, new in MUTANTS:
    if only and mid not in only:
        continue
    full = f'{WT}/{path}'
    src = open(full).read()
    n = src.count(old)
    if n != 1:
        results.append((mid, desc, f'SKIP: pattern count {n}'))
        print(mid, 'SKIP count', n, flush=True)
        continue
    open(full, 'w').write(src.replace(old, new))
    try:
        pkg = 'cli' if path.startswith('packages/cli') else 'core'
        rc, summary, secs = run(pkg, CLI if pkg == 'cli' else CORE)
        verdict = 'KILLED' if rc != 0 else 'SURVIVED'
        results.append((mid, desc, f'{verdict} ({pkg}: {summary}; {secs:.0f}s)'))
        print(mid, verdict, summary, flush=True)
    finally:
        subprocess.run(['git', 'checkout', '--', path], cwd=WT, check=True)
json.dump(results, open(f'{SP}/logs/mutation-{"-".join(only) or "all"}.json', 'w'), indent=1)
for r in results:
    print(' | '.join(r))
