import json, subprocess
from pathlib import Path
root=Path('/tmp/qwen-pr10237-verify-20260909')
tree=root/'head'; out=root/'artifacts'
store=tree/'packages/core/src/agents/team/tasks.ts'
tool=tree/'packages/core/src/tools/task-update.ts'
original={p:p.read_text() for p in [store,tool]}
mutations=[
 ('owner-guard',store,'          (checksExpectedOwner && expectedOwner !== actualOwner)','          (false && expectedOwner !== actualOwner)',True),
 ('status-guard',store,'checksExpectedStatus && opts.expectedStatus !== task.status','false && opts.expectedStatus !== task.status',True),
 ('status-only-wiring',tool,': explicitOwner !== undefined || this.params.status !== undefined',': explicitOwner !== undefined',True),
 ('content-dispatch-guard',tool,'      (explicitOwner !== undefined || this.params.status !== undefined) &&\n','',True),
 ('model-ui-hint',tool,'          llmContent: message,\n          returnDisplay: message,','          llmContent: err.message,\n          returnDisplay: err.message,',False),
]
rows=[]
try:
 for name,p,needle,replacement,expect_killed in mutations:
  for f,content in original.items():f.write_text(content)
  assert original[p].count(needle)==1,(name,original[p].count(needle))
  p.write_text(original[p].replace(needle,replacement))
  jsonpath=out/f'mutation-{name}.json'
  cmd=[str(root/'run-isolated.py'),'npx','vitest','run','src/agents/team/tasks.test.ts','src/tools/task-update.test.ts','src/agents/team/test-utils/coordination-harness.test.ts','--reporter=default','--reporter=json',f'--outputFile={jsonpath}']
  with (out/f'mutation-{name}.log').open('w') as log:
   result=subprocess.run(cmd,cwd=tree/'packages/core',stdout=log,stderr=subprocess.STDOUT,timeout=120)
  report=json.loads(jsonpath.read_text())
  failures=[{'name':a['fullName'],'messages':a['failureMessages']} for f in report['testResults'] for a in f['assertionResults'] if a['status']=='failed']
  row={'mutation':name,'exit':result.returncode,'passed':report['numPassedTests'],'failed':report['numFailedTests'],'total':report['numTotalTests'],'expectedKilled':expect_killed,'failures':failures}
  rows.append(row)
  print(f"{name:24} {row['passed']:3}/{row['total']} passed  {row['failed']:2} failed  {'KILLED' if row['failed'] else 'SURVIVED'}",flush=True)
  assert (row['failed']>0)==expect_killed,(name,'unexpected matrix outcome')
finally:
 for p,content in original.items(): p.write_text(content)
 (out/'mutation-matrix.json').write_text(json.dumps(rows,indent=2)+'\n')
