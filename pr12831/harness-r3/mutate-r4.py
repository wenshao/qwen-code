# Mutation sample on the F3 fix (c6c767507f), restored with git checkout.
import subprocess, os, re
SP = os.path.dirname(os.path.abspath(__file__))
WT = f'{SP}/wt-r2'
T = 'packages/cli/src/serve/hosted-workspace-tool-turn.ts'
MUT = [
  ('F3-a record-size check dropped (outcome check only)',
   "          outcome.byteLength >\n            HTTP_MANAGED_SESSION_STORE_CONTRACT.maxInlineResourceBytes ||\n          !this.messageFitsInline('tool_result', converted, model)\n",
   "          outcome.byteLength >\n            HTTP_MANAGED_SESSION_STORE_CONTRACT.maxInlineResourceBytes\n"),
  ('F3-b outcome-size check dropped (record check only)',
   "          outcome.byteLength >\n            HTTP_MANAGED_SESSION_STORE_CONTRACT.maxInlineResourceBytes ||\n",
   ""),
  ('F3-c omission receipt disabled',
   "        if (\n          outcome.byteLength >",
   "        if (\n          false &&\n          outcome.byteLength >"),
  ('F3-d receipt reports error instead of the settled status',
   "                  executionStatus: result.executionStatus,\n                  outputOmitted: true,",
   "                  executionStatus: 'error',\n                  outputOmitted: true,"),
  ('F3-e read_file range hint removed',
   "                      ? ' Request a smaller offset/limit range.'",
   "                      ? ''"),
  ('F3-f receipt drops outputOmitted marker',
   "                  outputOmitted: true,\n",
   ""),
]
out = []
for name, old, new in MUT:
    f = f'{WT}/{T}'; s = open(f).read()
    assert s.count(old) == 1, name
    open(f, 'w').write(s.replace(old, new))
    try:
        r = subprocess.run(['npx', 'vitest', 'run', 'src/serve/hosted-workspace-tool-turn.test.ts', 'src/serve/hosted-harness-session.test.ts'], cwd=f'{WT}/packages/cli', capture_output=True, text=True)
        fails = sorted(set(re.findall(r'× (.+?)(?: \d+ms)?$', r.stdout + r.stderr, re.M)))
        out.append(f"{name}: {'KILLED' if r.returncode else 'SURVIVED'} by {fails[:3]}")
    finally:
        subprocess.run(['git', 'checkout', '--', T], cwd=WT)
    print(out[-1], flush=True)
open(f'{SP}/logs/mutants-r4.txt', 'w').write('\n'.join(out) + '\n')
