from pathlib import Path
import subprocess,json
root=Path('/tmp/qwen-pr10237-verify-20260909')
p=root/'head/packages/core/src/agents/team/tasks.ts'; original=p.read_text()
cmd=[str(root/'run-isolated.py'),'npx','eslint','src/agents/team/tasks.ts','src/agents/team/tasks.test.ts','src/tools/task-update.ts','src/tools/task-update.test.ts']
try:
 p.write_text(original+'\nconst pr10237UnusedLintProbe = 1;\n')
 bad=subprocess.run(cmd,cwd=root/'head/packages/core',capture_output=True,text=True)
 (root/'artifacts/lint-control.log').write_text(bad.stdout+bad.stderr)
 assert bad.returncode!=0 and 'pr10237UnusedLintProbe' in bad.stdout
finally: p.write_text(original)
good=subprocess.run(cmd,cwd=root/'head/packages/core',capture_output=True,text=True)
(root/'artifacts/lint-head.log').write_text(good.stdout+good.stderr)
assert good.returncode==0
print('PASS lint rejects unused binding; restored four changed files lint clean')
