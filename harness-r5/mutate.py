import subprocess, shutil, sys, os, json
R='/root/verify/pr12267-r5'
S='packages/cli/src/commands/sandbox.ts'; E='packages/cli/src/config/execution-sandbox-settings.ts'
X='packages/core/src/services/shellExecutionService.ts'; P='packages/core/src/core/prompts.ts'; C='packages/core/src/core/client.ts'
cli=('packages/cli',['src/commands/sandbox.test.ts','src/config/execution-sandbox-settings.test.ts'])
core=('packages/core',['src/core/prompts.test.ts','src/services/shellExecutionService.test.ts'])
M=[
 ('M1 drop stdin from payload',S,'            env,\n            stdin,\n','            env,\n',cli),
 ('M2 drop await on pending drains',S,'        await Promise.all([...pendingDrains.values()]);\n','',cli),
 ('M3 streamRawOutput:true -> false',S,'{ streamStdout: true, streamRawOutput: true }','{ streamStdout: true, streamRawOutput: false }',cli),
 ('M4 route stderr chunks to stdout',S,"streamKey === 'stderr' ? process.stderr : process.stdout","process.stdout",cli),
 ('M5 FIFO stdin no longer read',S,'input.isFIFO() || input.isFile()','input.isFile()',cli),
 ('M6 drop isTTY guard',S,'  if (process.stdin.isTTY) return undefined;\n','',cli),
 ('M7 disable raw early-return',X,'          if (streamRawOutput) {\n            onOutputEvent({','          if (false) {\n            onOutputEvent({',core),
 ('M8 raw chunk stream label fixed to stdout',X,"              chunk: Buffer.from(data),\n              stream,\n","              chunk: Buffer.from(data),\n              stream: 'stdout' as const,\n",core),
 ('M9 prompt branch disabled',P,'  if (executionSandboxFilesystem) {','  if (false) {',core),
 ('M10 writable/read-only swapped',P,"executionSandboxFilesystem === 'workspace-write' ? 'writable' : 'read-only'","executionSandboxFilesystem === 'workspace-write' ? 'read-only' : 'writable'",core),
 ('M11 client stops passing policy',C,'          executionSandboxFilesystem:\n            config.getShellExecutionSandbox?.()?.filesystem,\n','',core),
 ('M12 PROXY_COMMAND re-added',E,"      process.env['QWEN_SANDBOX_PROXY_COMMAND']?.trim())","      process.env['QWEN_SANDBOX_PROXY_COMMAND']?.trim() ||\n      process.env['PROXY_COMMAND'] !== undefined)",cli),
 ('M13 SANDBOX trim removed',E,"      process.env['SANDBOX']?.trim() ||","      process.env['SANDBOX'] ||",cli),
 ('M14 QWEN_SANDBOX_NET back to !== undefined',E,"      process.env['QWEN_SANDBOX_NET']?.trim() ||","      process.env['QWEN_SANDBOX_NET'] !== undefined ||",cli),
 ('M15 drain de-dup guard removed',S,' && !pendingDrains.has(streamKey)','',cli),
]
only=sys.argv[1:] 
res=[]
for name,f,old,new,(cwd,tests) in M:
  if only and name.split()[0] not in only: continue
  p=os.path.join(R,f); src=open(p).read(); n=src.count(old)
  if n!=1: res.append((name,'SKIP count=%d'%n)); print(name,'SKIP',n,flush=True); continue
  bak=p+'.mutbak'; shutil.copy2(p,bak)
  try:
    open(p,'w').write(src.replace(old,new))
    r=subprocess.run(['npx','vitest','run',*tests,'--reporter=json','--outputFile=/tmp/claude-mut.json'],cwd=os.path.join(R,cwd),capture_output=True,text=True,timeout=600)
    try: j=json.load(open('/tmp/claude-mut.json')); failed=j['numFailedTests']; total=j['numTotalTests']
    except Exception as e: failed=-1; total=-1
    v='KILLED' if (failed>0 or r.returncode!=0) else 'SURVIVED'
    res.append((name,f'{v} ({failed}/{total} failed)')); print(name,v,failed,total,flush=True)
  finally:
    shutil.copy2(bak,p); os.remove(bak)
print(subprocess.run(['git','status','--porcelain','--untracked-files=no'],cwd=R,capture_output=True,text=True).stdout or 'git clean')
