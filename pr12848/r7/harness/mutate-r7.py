import subprocess, re
SP='/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad'
WT=f'{SP}/wt-r11'
CLI=['src/serve/hosted-shell-publisher.test.ts','src/serve/hosted-workspace-broker.test.ts','src/serve/hosted-harness-session.test.ts','src/serve/hosted-workspace-tool-turn.test.ts','src/serve/managed-context-worker.test.ts','src/serve/managed-runtime-attestation-worker.test.ts','src/serve/managed-runtime-tool-v3-routes.test.ts','src/serve/managed-runtime-tool-worker.test.ts','src/serve/hosted-harness-model.test.ts']
CORE=['src/managed-runtime/http-managed-session-store.test.ts','src/managed-runtime/resource-tool-result-store.test.ts','src/managed-runtime/managed-harness-factory.test.ts','src/managed-runtime/local-shell-result-session.test.ts','src/managed-runtime/local-shell-result-capture.test.ts']
P='packages/cli/src/serve/'
MUT=[
 ('K1','fix reverted: an incomplete finish fails the capture again',P+'hosted-shell-publisher.ts',"      entry.ended[stream] = true;\n      await sink.finish(stream, body['complete']);","      if (!body['complete']) sink.failCapture();\n      entry.ended[stream] = true;\n      await sink.finish(stream, body['complete']);"),
 ('K2','owner finalize ignores the worker failed flag',P+'hosted-shell-publisher.ts',"    if (body['failed']) sink.failCapture();\n",""),
 ('K3','worker reports complete even after a failed write',P+'managed-shell-publisher.ts',"        complete: complete && !this.failed,","        complete,"),
 ('K4','owner finalize: a never-finished stream no longer fails capture',P+'hosted-shell-publisher.ts',"        if (!entry.ended[stream]) {\n          sink.failCapture();\n","        if (!entry.ended[stream]) {\n"),
]
COMBO=[('K2+K3',['K2','K3'])]
def run(pkg,files):
    r=subprocess.run(['npx','vitest','run',*files],cwd=f'{WT}/packages/{pkg}',capture_output=True,text=True)
    out=r.stdout+r.stderr
    m=[l.strip() for l in out.splitlines() if re.match(r'^\s+Tests\s+\d',l)]
    fails=sorted(set(re.findall(r'×\s+(.+?)\s+\d+ms',out)))
    return r.returncode,(m[-1] if m else out.strip().splitlines()[-1][:120] if out.strip() else '?'),fails
for pkg,files in (('cli',CLI),('core',CORE)):
    rc,s,_=run(pkg,files); print('baseline',pkg,'rc',rc,s,flush=True)
for mid,desc,path,old,new in MUT:
    full=f'{WT}/{path}'; src=open(full).read(); n=src.count(old)
    if n!=1: print(mid,'SKIP',n,flush=True); continue
    open(full,'w').write(src.replace(old,new))
    try:
        pkg='core' if path.startswith('packages/core') else 'cli'
        rc,s,fails=run(pkg,CORE if pkg=='core' else CLI)
        print(mid,'KILLED' if rc else 'SURVIVED',desc,'|',s,'|','; '.join(f[:80] for f in fails[:2]),flush=True)
    finally:
        subprocess.run(['git','checkout','--',path],cwd=WT,check=True)
byid={m[0]:m for m in MUT}
for cid,ids in COMBO:
    paths=set()
    ok=True
    for i in ids:
        _,_,path,old,new=byid[i]; full=f'{WT}/{path}'; src=open(full).read()
        if src.count(old)!=1: ok=False; break
        open(full,'w').write(src.replace(old,new)); paths.add(path)
    try:
        if ok:
            rc,s,fails=run('cli',CLI)
            print(cid,'KILLED' if rc else 'SURVIVED','combo','|',s,'|','; '.join(f[:80] for f in fails[:2]),flush=True)
        else: print(cid,'SKIP',flush=True)
    finally:
        for p in paths: subprocess.run(['git','checkout','--',p],cwd=WT,check=True)
