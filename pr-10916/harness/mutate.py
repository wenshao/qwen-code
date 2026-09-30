import subprocess, json, sys, os
WT='/root/verify/pr10916/pr'
muts = [
 ('M1 agent-core: drop recordToolErrorBatch wiring', 'packages/core/src/agents/runtime/agent-core.ts',
  "            if (loopDetector.recordToolErrorBatch(roundResultParts)) {\n              terminateMode = AgentTerminateMode.LOOP_DETECTED;\n            }",
  "            void roundResultParts;",
  'packages/core', ['src/agents']),
 ('M2 client: drop halt-branch addHistory', 'packages/core/src/core/client.ts',
  "          this.getChat().addHistory(createUserContent(requestToSend));\n          for (const goalEvent of await finalizeInterruptedGoalTurn(",
  "          for (const goalEvent of await finalizeInterruptedGoalTurn(",
  'packages/core', ['src/core/client.test.ts']),
 ('M3 client: drop recordToolErrorBatch feed', 'packages/core/src/core/client.ts',
  "          loopHalt = this.loopDetector.recordToolErrorBatch(toolResultParts);",
  "          loopHalt = false;",
  'packages/core', ['src/core/client.test.ts']),
 ('M4 qwen-logger: drop error_signature spread', 'packages/core/src/telemetry/qwen-logger/qwen-logger.ts',
  "        ...(event.error_signature !== undefined && {\n          error_signature: event.error_signature,\n        }),",
  "",
  'packages/core', ['src/telemetry']),
 ('M5 cli: change repeated_tool_error headless label', 'packages/cli/src/nonInteractiveCli.ts',
  "'the model kept receiving the same tool error without making progress'",
  "'MUTATED LABEL'",
  'packages/cli', ['src/nonInteractiveCli.test.ts']),
 ('M6 detector: threshold 3 -> 4', 'packages/core/src/services/loopDetectionService.ts',
  "const REPEATED_TOOL_ERROR_THRESHOLD = 3;", "const REPEATED_TOOL_ERROR_THRESHOLD = 4;",
  'packages/core', ['src/services/loopDetectionService.test.ts']),
 ('M7 detector: remove decay on error-bearing rounds', 'packages/core/src/services/loopDetectionService.ts',
  "        if (!seen.has(signature)) this.toolErrorStreakCounts.delete(signature);",
  "        void signature;",
  'packages/core', ['src/services/loopDetectionService.test.ts']),
 ('M8 detector: drop deferred-cancel synthetic clause', 'packages/core/src/services/loopDetectionService.ts',
  "      error.startsWith(\n        `${DEFERRED_TOOL_CALL_CANCELLATION_PREFIX}${CANCELLED_TOOL_ERROR_PREFIX}`,\n      )",
  "      false",
  'packages/core', ['src/services/loopDetectionService.test.ts']),
 ('M9 shell: drop failure-core digest line', 'packages/core/src/tools/shell.ts',
  "        blockLines.push(\n          FULL_OUTPUT_DIGEST_LABEL +",
  "        ([] as string[]).push(\n          FULL_OUTPUT_DIGEST_LABEL +",
  'packages/core', ['src/tools/shell.test.ts', 'src/services/loopDetectionService.test.ts']),
 ('M10 span processor: drop error_excerpt key', 'packages/core/src/telemetry/log-to-span-processor.ts',
  "  'error_excerpt',\n", "",
  'packages/core', ['src/telemetry/log-to-span-processor.test.ts']),
]
only = sys.argv[1:] 
res=[]
for name,f,old,new,pkg,tests in muts:
    if only and name.split()[0] not in only: continue
    p=os.path.join(WT,f); s=open(p).read()
    n=s.count(old)
    if n!=1: res.append((name,'SKIP count=%d'%n)); print(name,'SKIP',n,flush=True); continue
    open(p,'w').write(s.replace(old,new))
    out=f'/root/verify/pr10916/runs/mut-{name.split()[0]}.json'
    try:
        subprocess.run(['npx','vitest','run',*tests,'--reporter=json',f'--outputFile={out}'],cwd=os.path.join(WT,pkg),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=1200)
    finally:
        subprocess.run(['git','checkout','--',f],cwd=WT)
    try:
        d=json.load(open(out)); r=(d['numPassedTests'],d['numFailedTests'],d['numTotalTestSuites'])
        failed=[a['fullName'][:110] for t in d['testResults'] for a in t['assertionResults'] if a['status']=='failed'][:4]
        suitefail=[os.path.basename(t['name']) for t in d['testResults'] if t['status']=='failed' and not t['assertionResults']]
    except Exception as e:
        r=('ERR',str(e)); failed=[]; suitefail=[]
    res.append((name,r,failed,suitefail)); print(name, r, failed, suitefail, flush=True)
json.dump(res,open('/root/verify/pr10916/runs/mutations'+('-'+'-'.join(only) if only else '')+'.json','w'),indent=1)
