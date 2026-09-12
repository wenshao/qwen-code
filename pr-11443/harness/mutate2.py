#!/usr/bin/env python3
# mutate.py — apply one mutant at a time to the PR worktree, run the LSP suites, restore the exact bytes.
import subprocess, sys, json, pathlib, re
WT = pathlib.Path('/root/git/pr11443')
SVC = 'packages/core/src/lsp/native-lsp-service.ts'
TYP = 'packages/core/src/lsp/types.ts'
M = [
 ('M11 reload snapshot ignores durable-only replay URIs', SVC,
  "      const uris = this.trackedUrisFor(name);\n", "      const uris = new Set(this.openedDocuments.get(name)?.keys() ?? []);\n"),
 ('M12 ordinary sync keeps replay obligation after success (sweep)', SVC,
  "          this.replayUris.get(name)?.delete(uri);\n", "          void uri;\n"),
]
out = []
for name, rel, old, new in M:
    p = WT / rel
    orig = p.read_text()
    n = orig.count(old)
    if n != 1:
        out.append({'mutant': name, 'status': f'ANCHOR x{n}'}); print(out[-1], flush=True); continue
    p.write_text(orig.replace(old, new))
    try:
        r = subprocess.run(['npx', 'vitest', 'run', 'src/lsp', 'src/tools/lsp.test.ts'], cwd=WT / 'packages/core',
                           capture_output=True, text=True, timeout=900)
        txt = r.stdout + r.stderr
        m = re.search(r'Tests\s+(.*?)\n', txt)
        failed = re.findall(r'(?:FAIL|×)\s+(.*?)\n', txt)[:3]
        out.append({'mutant': name, 'status': 'KILLED' if r.returncode else 'SURVIVED', 'tests': m.group(1).strip() if m else '?', 'sample': failed})
    finally:
        p.write_text(orig)
    print(json.dumps(out[-1]), flush=True)
st = subprocess.run(['git', 'status', '--porcelain', '--', 'packages/core/src'], cwd=WT, capture_output=True, text=True).stdout
print('worktree src clean after restore:', st.strip() == '', st)
json.dump(out, open('/root/git/pr11443-e2e/mut/results2.json', 'w'), indent=1)
