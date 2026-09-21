#!/usr/bin/env python3
"""Source-level mutation matrix for the round-3 claims of PR #12374.
Each mutant = one exact-text replacement; restored by re-writing the original bytes."""
import subprocess, json, sys, re, os
WT='/root/git/h12374'
U='/root/git/h12374-e2e/u1500'
SCH='packages/cli/src/services/housekeeping/scheduler.ts'
CLN='packages/cli/src/utils/housekeeping/cleanup.ts'
T1='packages/cli/src/services/housekeeping/scheduler.test.ts'
T2='packages/cli/src/utils/housekeeping/cleanup.test.ts'
M=[
 ('R1-1','OpenAI marker dropped from first-pass catch-up list', SCH,
  "    markerPaths.push(getOpenAILogsMarkerPath(qwenDir, openaiTarget.logDir));\n", "    void openaiTarget;\n"),
 ('D1','debug marker dropped from first-pass catch-up list', SCH,
  "    join(qwenDir, FILE_HISTORY_MARKER),\n    getDebugLogsMarkerPath(qwenDir, Storage.getGlobalDebugDir()),\n  ];", "    join(qwenDir, FILE_HISTORY_MARKER),\n  ];"),
 ('R1-5','pseudo-stem allowlist emptied', SCH,
  "new Set([\n  'transcript-replay',\n  'workspace-mcp-discovery',\n]);", "new Set([]);"),
 ('R1-5b','allowlist keeps only transcript-replay', SCH,
  "  'workspace-mcp-discovery',\n]);", "]);"),
 ('R1-10','call site passes () => true (validator unpinned)', SCH,
  "isValidSessionId: (v) =>\n          isValidSessionId(v) || PSEUDO_DEBUG_SESSION_STEMS.has(v),", "isValidSessionId: () => true,"),
 ('G1','current session no longer excluded', SCH,
  "excludeSessionIds: new Set([currentSessionId]),\n        isValidSessionId: (v)", "excludeSessionIds: new Set([]),\n        isValidSessionId: (v)"),
 ('K1','debug marker keyed on QWEN_HOME, not the runtime debug dir', SCH,
  "  const debugLogsMarkerPath = getDebugLogsMarkerPath(\n    qwenDir,\n    Storage.getGlobalDebugDir(),\n  );", "  const debugLogsMarkerPath = getDebugLogsMarkerPath(\n    qwenDir,\n    qwenDir,\n  );"),
 ('R1-8','sweep rmdirs an emptied debug root', CLN,
  "  }\n\n  return result;\n}\n", "  }\n\n  await import('node:fs/promises').then((m) => m.rmdir(root)).catch(() => {});\n  return result;\n}\n"),
 ('X1','exclude check removed inside the sweeper', CLN,
  "if (!opts.isValidSessionId(sessionId) || excludes.has(sessionId)) {", "if (!opts.isValidSessionId(sessionId)) {"),
 ('P1','sweep root = QWEN_HOME/debug (ignores QWEN_RUNTIME_DIR)', CLN,
  "  const root = Storage.getGlobalDebugDir();\n  const excludes", "  const root = join(Storage.getGlobalQwenDir(), 'debug');\n  const excludes"),
 ('A1','allowlist widened to prefix match', SCH,
  "isValidSessionId(v) || PSEUDO_DEBUG_SESSION_STEMS.has(v),", "isValidSessionId(v) || [...PSEUDO_DEBUG_SESSION_STEMS].some((p) => v.startsWith(p)),"),
 ('A2','allowlist matched case-insensitively', SCH,
  "isValidSessionId(v) || PSEUDO_DEBUG_SESSION_STEMS.has(v),", "isValidSessionId(v) || PSEUDO_DEBUG_SESSION_STEMS.has(v.toLowerCase()),"),
]
def vitest():
    cmd=['timeout','600','setpriv','--reuid=1500','--regid=1500','--clear-groups','env',f'HOME={U}',f'TMPDIR={U}',
         'npx','vitest','run','src/utils/housekeeping/cleanup.test.ts','src/services/housekeeping/scheduler.test.ts','--reporter=default','--coverage.enabled=false']
    env=dict(os.environ); env.pop('QWEN_RUNTIME_DIR',None)
    p=subprocess.run(cmd,cwd=f'{WT}/packages/cli',capture_output=True,text=True,env=env)
    out=p.stdout+p.stderr
    m=re.search(r'Tests\s+(?:(\d+) failed \| )?(\d+) passed',out)
    failed=int(m.group(1) or 0) if m else -1
    names=re.findall(r'FAIL\s+\S+ > (.+)',out)
    return failed, sorted(set(n.strip() for n in names))
def with_tests(ref):
    if ref=='r3': return
    for t in (T1,T2):
        open(f'{WT}/{t}','w').write(subprocess.check_output(['git','-C',WT,'show',f'{ref}:{t}'],text=True))
def restore_tests():
    subprocess.check_call(['git','-C',WT,'checkout','--',T1,T2])
res=[]
only=sys.argv[1:]
for mid,desc,f,old,new in M:
    if only and mid not in only: continue
    src=open(f'{WT}/{f}').read()
    assert src.count(old)==1,(mid,src.count(old))
    open(f'{WT}/{f}','w').write(src.replace(old,new))
    try:
        row={'id':mid,'desc':desc,'file':f}
        for ref in (['b83983c19','r3'] if mid in ('R1-1','R1-5','R1-10','R1-8','K1') else ['r3']):
            with_tests(ref)
            try:
                failed,names=vitest()
            finally:
                restore_tests()
            row[ref]={'failed':failed,'killed':failed>0,'tests':names[:6]}
        res.append(row); print(json.dumps(row),flush=True)
    finally:
        open(f'{WT}/{f}','w').write(src)
st=subprocess.check_output(['git','-C',WT,'status','--short'],text=True)
print('git status after:',repr(st))
json.dump(res,open('/root/git/h12374-e2e/out/mutants.json','w'),indent=1)
