import sys,subprocess,os
WT='/root/git/h12404'
S='packages/cli/src/acp-integration/session/Session.ts'
R='packages/acp-bridge/src/transcript-replay.ts'
M={
 'M1 drop `|| inputAnnotations` gate (ordinary prompt)': (S, """                promptDisplayText !== undefined ||
                  inputAnnotations ||
                  attachmentReferences ||""", """                promptDisplayText !== undefined ||
                  attachmentReferences ||""", 1),
 'M2 drop inputAnnotations field (ordinary prompt)': (S, """                      hookContext: '',
                      ...(inputAnnotations ? { inputAnnotations } : {}),
                      ...(attachmentReferences""", """                      hookContext: '',
                      ...(attachmentReferences""", 1),
 'M3 no structuredClone snapshot': (S, "? structuredClone(inputAnnotationsValue)", "? inputAnnotationsValue", 1),
 'M4 drop gate on deferred /advisor path': (S, "promptDisplayText !== undefined || inputAnnotations\n", "promptDisplayText !== undefined\n", 1),
 'M5 replay drops inputAnnotations': (R, """        ...(Array.isArray(payload?.['inputAnnotations'])
          ? { inputAnnotations: payload['inputAnnotations'] }
          : {}),""", "", 1),
 'M6 replay forwards non-arrays': (R, "...(Array.isArray(payload?.['inputAnnotations'])", "...(payload?.['inputAnnotations'] !== undefined", 1),
}
TESTS={S:('packages/cli','src/acp-integration/session/Session.test.ts'), R:('packages/acp-bridge','src/transcript-replay.test.ts')}
for name,(f,old,new,n) in M.items():
    p=os.path.join(WT,f); src=open(p).read()
    assert src.count(old)==n, (name, src.count(old))
    open(p,'w').write(src.replace(old,new))
    pkg,t=TESTS[f]
    r=subprocess.run(f"cd {WT}/{pkg} && npx vitest run {t} --coverage.enabled=false 2>&1 | grep -E '^ +Tests ' | tail -1",shell=True,capture_output=True,text=True)
    open(p,'w').write(src)
    print(f"{name}: {r.stdout.strip()}", flush=True)
print('restored; git diff empty:', subprocess.run(f"cd {WT} && git diff --quiet && echo yes || echo NO",shell=True,capture_output=True,text=True).stdout.strip())
