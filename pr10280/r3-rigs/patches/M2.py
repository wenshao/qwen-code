import sys,subprocess
src=sys.argv[1]; tst=sys.argv[2]
s=open(src).read()
old="const TOOL_CANCELLED_BEFORE_EXECUTION_MESSAGE = `This tool call was cancelled before it ran. ${TOOL_CANCELLATION_STOP_DIRECTIVE}`;"
new="const TOOL_CANCELLED_BEFORE_EXECUTION_MESSAGE = `User intentionally cancelled this tool call before it ran. ${TOOL_CANCELLATION_STOP_DIRECTIVE}`;"
assert s.count(old)==1
open(src,'w').write(s.replace(old,new))
# counterfactual: the test file as it stood at the previous head (50bc10a332)
out=subprocess.run(['git','show','50bc10a332:packages/core/src/core/coreToolScheduler.test.ts'],capture_output=True,text=True)
assert out.returncode==0 and out.stdout
open(tst,'w').write(out.stdout)
