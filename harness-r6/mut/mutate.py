import subprocess, shutil, sys, os, re, json
ROOT='/root/verify/pr12267-r7'
CLI=ROOT+'/packages/cli/src/commands/sandbox.ts'
BW=ROOT+'/packages/core/src/sandbox/bwrap-execution.ts'
SES=ROOT+'/packages/core/src/services/shellExecutionService.ts'
T_CLI=('packages/cli',['src/commands/sandbox.test.ts'])
T_CORE=('packages/core',['src/sandbox/bwrap-execution.test.ts','src/services/shellExecutionService.test.ts'])
M=[
 ('C1 stdin never inherited',CLI,"inheritStdin: !process.stdin.isTTY,","inheritStdin: false,",T_CLI),
 ('C2 TTY guard dropped (always inherit)',CLI,"inheritStdin: !process.stdin.isTTY,","inheritStdin: true,",T_CLI),
 ('C3 EPIPE exit code 141 -> 1',CLI,"cancellationExitCode = error.code === 'EPIPE' ? 141 : 1;","cancellationExitCode = 1;",T_CLI),
 ('C4 no abort on output error',CLI,"cancellationExitCode = error.code === 'EPIPE' ? 141 : 1;\n          controller.abort();","cancellationExitCode = error.code === 'EPIPE' ? 141 : 1;",T_CLI),
 ('C5 no stderr error listener',CLI,"        process.stderr.on('error', handleOutputError);\n","",T_CLI),
 ('C6 no stdout error listener',CLI,"        process.stdout.on('error', handleOutputError);\n","",T_CLI),
 ('C7 listeners never removed',CLI,"          process.stdout.removeListener('error', handleOutputError);\n          process.stderr.removeListener('error', handleOutputError);\n","",T_CLI),
 ('C8 drain EPIPE rethrown',CLI,"                        (error as NodeJS.ErrnoException).code === 'EPIPE'","                        (error as NodeJS.ErrnoException).code === 'NEVER'",T_CLI),
 ('C9 non-EPIPE output error swallowed',CLI,"          if (outputError && outputError.code !== 'EPIPE') throw outputError;\n","",T_CLI),
 ('C10 abort-guard clause dropped',CLI,"if (outputError || controller.signal.aborted) return;","if (outputError) return;",T_CLI),
 ('C11 first-error latch dropped',CLI,"if (outputError || controller.signal.aborted) return;","",T_CLI),
 ('B1 inheritStdin not forwarded to relay',BW,"const inheritStdin = payload.inheritStdin;","const inheritStdin = undefined;",T_CORE),
 ('B2 piped+inherited conflict allowed',BW,"  if (payload.stdin !== undefined && payload.inheritStdin)\n    throw new Error('Process stdin cannot be both piped and inherited.');\n","",T_CORE),
 ('B3 PTY + inherit allowed',BW,"if (usePty && (payload.stdin !== undefined || payload.inheritStdin))","if (usePty && payload.stdin !== undefined)",T_CORE),
 ('S1 inherit -> ignore at spawn',SES,"          launch?.inheritStdin\n            ? 'inherit'","          launch?.inheritStdin\n            ? 'ignore'",T_CORE),
 ('S2 snapshot drops inheritStdin',SES,"      inheritStdin: launch.inheritStdin,\n","",T_CORE),
 ('S3 piped+inherited conflict allowed',SES,"    if (snapshot.stdin !== undefined && snapshot.inheritStdin) {\n      throw new Error('Process stdin cannot be both piped and inherited.');\n    }\n","",T_CORE),
 ('S4 PTY + inherit allowed',SES,"      (snapshot.stdin !== undefined || snapshot.inheritStdin)","      snapshot.stdin !== undefined",T_CORE),
]
only=sys.argv[1:]
res=[]
for name,f,old,new,(pkg,tests) in M:
    if only and name.split()[0] not in only: continue
    src=open(f).read()
    if src.count(old)!=1:
        res.append((name,'NOMATCH %d'%src.count(old))); print(name,'NOMATCH',src.count(old),flush=True); continue
    bak=f+'.mutbak'; shutil.copyfile(f,bak)
    try:
        tmp=f+'.muttmp'; open(tmp,'w').write(src.replace(old,new)); os.replace(tmp,f)
        p=subprocess.run(['timeout','300','npx','vitest','run',*tests],cwd=ROOT+'/'+pkg,capture_output=True,text=True)
        out=p.stdout+p.stderr
        m=re.search(r'Tests\s+(.*)',out)
        verdict='KILLED' if p.returncode!=0 else 'SURVIVED'
        res.append((name,verdict+' | '+(m.group(1).strip() if m else 'rc=%d'%p.returncode)))
        print(name,'=>',res[-1][1],flush=True)
    finally:
        os.replace(bak,f)
print(json.dumps(res,indent=1))
