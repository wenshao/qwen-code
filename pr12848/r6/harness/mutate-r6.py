import subprocess, re
SP='/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad'
WT=f'{SP}/wt-mut4'
CLI=['src/serve/hosted-shell-publisher.test.ts','src/serve/hosted-workspace-broker.test.ts','src/serve/hosted-harness-session.test.ts','src/serve/hosted-workspace-tool-turn.test.ts','src/serve/managed-context-worker.test.ts','src/serve/managed-runtime-attestation-worker.test.ts','src/serve/managed-runtime-tool-v3-routes.test.ts','src/serve/managed-runtime-tool-worker.test.ts','src/serve/hosted-harness-model.test.ts']
CORE=['src/managed-runtime/http-managed-session-store.test.ts','src/managed-runtime/resource-tool-result-store.test.ts','src/managed-runtime/managed-harness-factory.test.ts','src/managed-runtime/local-shell-result-session.test.ts','src/managed-runtime/local-shell-result-capture.test.ts']
P='packages/cli/src/serve/'
MUT=[
 ('N1','R1-1: append no longer drops writes after finish',P+'managed-shell-publisher.ts','if (this.failed || this.ended[stream]) return;','if (this.failed) return;'),
 ('N2','R1-1: end() sends a second finish',P+'managed-shell-publisher.ts','    if (this.ended[stream]) return;\n    this.ended[stream] = true;','    this.ended[stream] = true;'),
 ('N3','R1-1: finalize does not wait for queued writes',P+'managed-shell-publisher.ts','    await Promise.all(Object.values(this.queues));\n',''),
 ('N4','R1-2: process sent although not started',P+'managed-shell-publisher.ts','          this.started && physical\n','          physical\n'),
 ('N5','R1-2: not_started status not forced',P+'managed-shell-publisher.ts',"        executionStatus: this.started ? executionStatus : 'not_started',","        executionStatus,"),
 ('N6','R1-5: truncation flag always false',P+'managed-shell-publisher.ts','        previewTruncated: preview.truncated,','        previewTruncated: false,'),
 ('N7','R1-7: string "false" rejected again',P+'hosted-workspace-tool-turn.ts',"          args['is_background'] !== false &&\n          !(\n            typeof args['is_background'] === 'string' &&\n            args['is_background'].toLowerCase() === 'false'\n          )\n","          args['is_background'] !== false\n"),
 ('N8','R1-10: sealed replay reports digest mismatch','packages/core/src/managed-runtime/resource-tool-result-store.ts','return stream.sealed ? conflict : corrupt;','return corrupt;'),
]
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
