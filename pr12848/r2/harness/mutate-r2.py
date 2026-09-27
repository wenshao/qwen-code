#!/usr/bin/env python3
"""Mutation run for #12848 in wt-mut (clean detached checkout of the PR head).

Each mutant is one exact, single-occurrence replacement. The file is restored
with `git checkout -- <file>` afterwards (wt-mut has no local edits).
"""
import json, re, subprocess, sys, time, os

SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad'
WT = f'{SP}/wt-mut2'
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
  ('R1', 'refusal path disabled: invalid Shell args dispatch as foreground', P + 'hosted-workspace-tool-turn.ts',
   "    if (requests.some((request) => request.validationError)) {", "    if (false) {"),
  ('R2', 'refusal does not persist tool_result', P + 'hosted-workspace-tool-turn.ts',
   "        await this.commit('tool_result', responses, model);\n        this.uncertain = false;\n        return responses;",
   "        this.uncertain = false;\n        return responses;"),
  ('R3', 'refusal answers only the invalid calls', P + 'hosted-workspace-tool-turn.ts',
   "      const responses = requests.flatMap((request) =>", "      const responses = requests.filter((request) => request.validationError).flatMap((request) =>"),
  ('R4', 'refusal size check removed', P + 'hosted-workspace-tool-turn.ts',
   "      if (!this.messageFitsInline('tool_result', responses, model))\n        throw new Error(\n          'Hosted tool refusal exceeds the inline Session Store limit.',\n        );\n", ""),
  ('R5', 'refusal persists nothing (no assistant, no tool_result)', P + 'hosted-workspace-tool-turn.ts',
   "        await this.commit('assistant', parts, model);\n        await this.commit('tool_result', responses, model);\n", ""),
  ('R6', 'N3: admitted Shell result swapped for omission', P + 'hosted-workspace-tool-turn.ts',
   "          if (receipt)\n            throw new Error(\n              'Admitted Shell result exceeds the inline Session Store limit.',\n            );\n", ""),
  ('R7', 'F1: tail cut not aligned to UTF-8', P + 'managed-shell-publisher.ts',
   "  while (start < bytes.byteLength && (bytes[start]! & 0xc0) === 0x80) start++;\n", ""),
  ('R8', 'F1: no head (tail only)', P + 'managed-shell-publisher.ts',
   "const PREVIEW_HEAD_BYTES = 2 * 1024;", "const PREVIEW_HEAD_BYTES = 0;"),
  ('R9', 'F1: gap marker dropped', P + 'managed-shell-publisher.ts',
   "  '\\n[... preview truncated; end of buffered output follows ...]\\n';", "  '';"),
  ('M13', 'publisher bearer check deleted', P + 'hosted-shell-publisher.ts',
   "          token.length !== expected.length ||\n          !timingSafeEqual(token, expected)\n", "          false\n"),
  ('M11', 'turn never closes its publisher', P + 'hosted-harness-session.ts',
   "          await toolTurn?.close();", "          void 0;"),
  ('M11b', 'publisher close() leaves the server listening', P + 'hosted-shell-publisher.ts',
   "    if (this.server) {\n      await new Promise<void>((resolve, reject) =>\n        this.server!.close((error) => (error ? reject(error) : resolve())),\n      );\n    }\n", ""),
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
json.dump(results, open(f'{SP}/logs/mutation-r2-{"-".join(only) or "all"}.json', 'w'), indent=1)
for r in results:
    print(' | '.join(r))
