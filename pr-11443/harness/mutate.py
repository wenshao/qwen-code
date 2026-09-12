#!/usr/bin/env python3
# mutate.py — apply one mutant at a time to the PR worktree, run the LSP suites, restore the exact bytes.
import subprocess, sys, json, pathlib, re
WT = pathlib.Path('/root/git/pr11443')
SVC = 'packages/core/src/lsp/native-lsp-service.ts'
TYP = 'packages/core/src/lsp/types.ts'
M = [
 ('M1 unchanged text still sends didChange', SVC,
  "    if (previous?.text === text && !force) {\n", "    if (false) {\n"),
 ('M2 incremental range ends one line too far', SVC,
  "            line: lines.length - 1,\n", "            line: lines.length,\n"),
 ('M3 CRLF/CR not treated as line breaks', SVC,
  "const lines = previous.text.split(/\\r\\n|\\r|\\n/);", "const lines = previous.text.split('\\n');"),
 ('M4 connection change drops replay obligation', SVC,
  "      for (const tracked of prior.keys()) durable.add(tracked);\n", "      for (const tracked of prior.keys()) void tracked;\n"),
 ('M5 diagnostics swallows target sync failure', SVC,
  "      await this.ensureDocumentSynchronized(name, handle, uri);\n\n      try {", "      await this.ensureDocumentSynchronized(name, handle, uri).catch(() => false);\n\n      try {"),
 ('M6 absent capability treated as openClose', TYP,
  "(sync?.openClose ?? false)", "(sync?.openClose ?? true)"),
 ('M7 reopen restarts version at 1', SVC,
  "const version = (previous?.version ?? lifecycle?.version ?? 0) + 1;", "const version = (previous?.version ?? 0) + 1;"),
 ('M8 sweep captures tracked set after warmup', SVC,
  "      const trackedUris = [...this.trackedUrisFor(name)];\n      await this.warmupAndTrack(name, handle);\n",
  "      await this.warmupAndTrack(name, handle);\n      const trackedUris = [...this.trackedUrisFor(name)];\n"),
 ('M9 read failure returns quietly', SVC,
  "      throw error;\n    }\n    if (lifecycle) delete lifecycle.readFailures;", "      return { sent: false, opened: false };\n    }\n    if (lifecycle) delete lifecycle.readFailures;"),
 ('M10 Full sync also sends a range', SVC,
  "      if (change === 2) {\n", "      if (change === 2 || change === 1) {\n"),
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
json.dump(out, open('/root/git/pr11443-e2e/mut/results.json', 'w'), indent=1)
