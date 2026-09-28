import subprocess, re
SP='/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad'
WT=f'{SP}/wt-mut3'
F='packages/core/src/managed-runtime/managed-harness-factory.ts'
MUT=[
 ('F4a','relabel keeps the old activation (fix reverted)','                  ...turn,\n                  activationId: this.activation.activationId,\n','                  ...turn,\n'),
 ('F4b','prior-activation guard removed',"      if (\n        turn &&\n        previous.identity.activationId !== this.activation.activationId &&\n        previous.continuation.phase !== 'before_model' &&\n        previous.continuation.phase !== 'turn_settled'\n      ) {\n        throw new ManagedSessionConflictError(\n          'Runtime work cannot continue a prior activation.',\n        );\n      }\n",""),
 ('F4c','guard ignores turn_settled (too strict)',"        previous.identity.activationId !== this.activation.activationId &&\n        previous.continuation.phase !== 'before_model' &&\n        previous.continuation.phase !== 'turn_settled'\n","        previous.identity.activationId !== this.activation.activationId &&\n        previous.continuation.phase !== 'before_model'\n"),
 ('F4d','guard ignores before_model (too strict)',"        previous.identity.activationId !== this.activation.activationId &&\n        previous.continuation.phase !== 'before_model' &&\n        previous.continuation.phase !== 'turn_settled'\n","        previous.identity.activationId !== this.activation.activationId &&\n        previous.continuation.phase !== 'turn_settled'\n"),
]
FILES=['src/managed-runtime/managed-harness-factory.test.ts','src/managed-runtime/local-shell-result-session.test.ts','src/managed-runtime/http-managed-session-store.test.ts','src/managed-runtime/resource-tool-result-store.test.ts','src/managed-runtime/local-shell-result-capture.test.ts']
def run():
    r=subprocess.run(['npx','vitest','run',*FILES],cwd=f'{WT}/packages/core',capture_output=True,text=True)
    out=r.stdout+r.stderr
    m=[l.strip() for l in out.splitlines() if re.match(r'^\s+Tests\s+\d',l)]
    fails=sorted(set(re.findall(r'×\s+(.+?)\s+\d+ms',out)))
    return r.returncode, (m[-1] if m else '?'), fails
rc,s,_=run(); print('baseline', 'rc', rc, s)
for mid,desc,old,new in MUT:
    p=f'{WT}/{F}'; src=open(p).read(); n=src.count(old)
    if n!=1: print(mid,'SKIP',n); continue
    open(p,'w').write(src.replace(old,new))
    try:
        rc,s,fails=run(); print(mid,'KILLED' if rc else 'SURVIVED',desc,'|',s,'|','; '.join(f[:90] for f in fails[:3]))
    finally:
        subprocess.run(['git','checkout','--',F],cwd=WT,check=True)
