#!/usr/bin/env python3
"""Single-site mutants against the PR's own tests. Backs up and restores each file; never uses git checkout."""
import subprocess, json, re, shutil, sys, os
ROOT = '/root/verify/pr12640/head'
OUT = '/root/verify/pr12640/run/mut'
PAGE = 'packages/web-shell/client/components/extensions/ExtensionsManagerPage.tsx'
CORE = 'packages/core/src/extension/extensionManager.ts'
CTRL = 'packages/cli/src/serve/routes/workspace-extensions-controller.ts'
ROUTE = 'packages/cli/src/serve/routes/workspace-extensions.ts'
SDK = 'packages/sdk-typescript/src/daemon/DaemonClient.ts'
T = {
  'page': ('packages/web-shell', ['npx', 'vitest', 'run', 'client/components/extensions/ExtensionsManagerPage.test.tsx']),
  'core': ('packages/core', ['npx', 'vitest', 'run', 'src/extension/extensionManager.test.ts']),
  'cli': ('packages/cli', ['npx', 'vitest', 'run', 'src/serve/routes/workspace-qualified-extensions.test.ts', 'src/serve/routes/workspace-extensions-controller.test.ts']),
  'sdk': ('packages/sdk-typescript', ['npx', 'vitest', 'run', 'test/unit/DaemonClient.test.ts']),
}
M = [
  ('W1 page: drop summary-identity check on the detail result', PAGE, 'page',
   'detailResult?.summary === selectedExtension ? detailResult : null', 'detailResult'),
  ('W2 page: drop `cancelled` guard on the success callback', PAGE, 'page',
   'if (!cancelled) setDetailResult({ summary: selectedExtension, entry });', 'setDetailResult({ summary: selectedExtension, entry });'),
  ('W3 page: always load the full status (ignore capability)', PAGE, 'page',
   'splitExtensionDetails\n          ? actions.loadExtensionSummaries()\n          : actions.loadExtensionsStatus()', 'actions.loadExtensionsStatus()'),
  ('W4 page: retry does not re-run the detail effect', PAGE, 'page',
   '}, [actions, selectedExtension, splitExtensionDetails, detailRetry]);', '}, [actions, selectedExtension, splitExtensionDetails]);'),
  ('W5 page: never show the loading state', PAGE, 'page',
   'const detailsLoading = splitExtensionDetails && !currentDetail;', 'const detailsLoading = false;'),
  ('W6 page: never show the error state', PAGE, 'page',
   'const detailsError = splitExtensionDetails\n      ? currentDetail?.error\n      : undefined;', 'const detailsError = undefined;'),
  ('C1 core: load subresources for every extension on the details path', CORE, 'core',
   "options.manifestOnly ||\n        (options.detailName !== undefined &&\n          extension.name.toLowerCase() !== options.detailName.toLowerCase())", 'options.manifestOnly'),
  ('C2 core: details path creates plugin data dirs', CORE, 'core',
   'createDataDir:\n          !options.manifestOnly && options.detailName === undefined,', 'createDataDir: !options.manifestOnly,'),
  ('C3 core: case-sensitive selected-name match', CORE, 'core',
   'extension.name.toLowerCase() !== options.detailName.toLowerCase())', 'extension.name !== options.detailName)'),
  ('C4 core: findLast -> find for the selected entry', CORE, 'core',
   'extensions.findLast(\n        (entry) => entry.name.toLowerCase() === name.toLowerCase(),', 'extensions.find(\n        (entry) => entry.name.toLowerCase() === name.toLowerCase(),'),
  ('R1 route: absent extension answers 200 null instead of 404', ROUTE, 'cli',
   "res.status(404).json({\n            error: 'Extension not found',\n            code: 'extension_not_found',\n          });", 'res.status(200).json(null);'),
  ('R2 controller: summary keeps manifest isActive (no snapshot activation)', CTRL, 'cli',
   "        ].map((extension) => ({\n          ...toExtensionSummary(extension),\n          isActive:\n            manager.getExtensionActivationForIdentityFromSnapshot(\n              extension,\n              snapshot,\n              boundWorkspace,\n            ).effective === 'enabled',\n        })),",
   '        ].map((extension) => toExtensionSummary(extension)),'),
  ('R3 controller: details keep manifest isActive (no snapshot activation)', CTRL, 'cli',
   "    return {\n      ...toExtensionEntry(extension),\n      isActive:\n        manager.getExtensionActivationForIdentityFromSnapshot(\n          extension,\n          snapshot,\n          boundWorkspace,\n        ).effective === 'enabled',\n    };",
   '    return toExtensionEntry(extension);'),
  ('R4 controller: summary without name de-duplication', CTRL, 'cli',
   '[\n          ...new Map(\n            extensions.map((extension) => [extension.name, extension]),\n          ).values(),\n        ].map(', 'extensions.map('),
  ('S1 sdk: details name not URL-encoded', SDK, 'sdk',
   '`/workspace/extensions/${urlEncode(name)}/details`', '`/workspace/extensions/${name}/details`'),
]
only = sys.argv[1:]  # optional ids
res = []
for title, f, t, old, new in M:
    mid = title.split()[0]
    if only and mid not in only: continue
    p = os.path.join(ROOT, f)
    src = open(p).read()
    n = src.count(old)
    if n != 1:
        res.append({'id': mid, 'title': title, 'error': f'pattern count {n}'}); print(mid, 'PATTERN', n); continue
    shutil.copy2(p, p + '.mutbak')
    try:
        open(p, 'w').write(src.replace(old, new))
        cwd, cmd = T[t]
        r = subprocess.run(cmd + ['--reporter=dot'], cwd=os.path.join(ROOT, cwd), capture_output=True, text=True, timeout=900)
        outp = r.stdout + r.stderr
        open(os.path.join(OUT, f'{mid}.log'), 'w').write(outp)
        m = re.search(r'Tests\s+(.*)', outp)
        failed = re.findall(r'(?:FAIL|×)\s+(.+?)(?:\s+\d+ms)?$', outp, re.M)
        res.append({'id': mid, 'title': title, 'exit': r.returncode, 'tests': m.group(1).strip() if m else None, 'killed': r.returncode != 0, 'failedNames': sorted(set(x.strip() for x in failed))[:6]})
        print(mid, 'KILLED' if r.returncode else 'SURVIVED', m.group(1).strip() if m else '')
    finally:
        shutil.move(p + '.mutbak', p)
json.dump(res, open(os.path.join(OUT, 'mutants.json' if not only else f'mutants-{"-".join(only)}.json'), 'w'), indent=2)
print(subprocess.run(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT, capture_output=True, text=True).stdout or 'git status clean')
