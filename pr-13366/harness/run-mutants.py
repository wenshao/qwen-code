import json, subprocess, shutil, os
W='/root/verify/pr13366/head'
F=W+'/packages/cli/src/serve/hosted-workspace-tool-turn.ts'
HEAD=open('/root/verify/pr13366/tool-turn.head.ts').read()
M = {
 'M1-cancelled-wait-blocks': ('(isRetryableWorkspaceAcquisition(cause) || waitAborted)) ||', '(isRetryableWorkspaceAcquisition(cause) || false)) ||'),
 'M2-queue-unavailable-too': ('if (signal === undefined || !isBusyWorkspaceAcquisition(cause))', 'if (signal === undefined || !isRetryableWorkspaceAcquisition(cause))'),
 'M3-recovery-also-queues': ('if (signal === undefined || !isBusyWorkspaceAcquisition(cause))', 'if (!isBusyWorkspaceAcquisition(cause))'),
 'M4-notice-every-poll': ('          if (!queued) {\n            queued = true;', '          if (true) {\n            queued = true;'),
 'M5-execute-passes-no-signal': ('await this.acquire(false, signal);', 'await this.acquire(false);'),
 'M6-wait-ignores-cancel': ('''              signal,
            );
          } catch (waitCause) {''', '''              undefined,
            );
          } catch (waitCause) {'''),
}
out={}
try:
  for name,(a,b) in M.items():
    assert HEAD.count(a)==1, name
    open(F+'.tmp','w').write(HEAD.replace(a,b)); os.replace(F+'.tmp',F)
    rep='/root/verify/pr13366/mut/'+name+'.json'
    subprocess.run('CI=true timeout 300 npx vitest run src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-harness-session.issue-13328.test.ts --testTimeout=20000 --reporter=json --outputFile='+rep+' > /root/verify/pr13366/mut/'+name+'.log 2>&1', shell=True, cwd=W+'/packages/cli')
    try:
      r=json.load(open(rep))
      fails=[t['title'] for f in r['testResults'] for t in f['assertionResults'] if t['status']!='passed']
      out[name]={'failed':r['numFailedTests'],'total':r['numTotalTests'],'titles':fails}
    except Exception as e:
      out[name]={'error':str(e)}
    print(name, out[name].get('failed'), out[name].get('titles', out[name].get('error')), flush=True)
finally:
  open(F+'.tmp','w').write(HEAD); os.replace(F+'.tmp',F)
json.dump(out,open('/root/verify/pr13366/mut/summary.json','w'),indent=1)
