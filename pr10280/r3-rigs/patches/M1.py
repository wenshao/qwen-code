import sys
src=sys.argv[1]; s=open(src).read()
old="const TOOL_CANCELLED_BEFORE_EXECUTION_MESSAGE = `This tool call was cancelled before it ran. ${TOOL_CANCELLATION_STOP_DIRECTIVE}`;"
new="const TOOL_CANCELLED_BEFORE_EXECUTION_MESSAGE = `User intentionally cancelled this tool call before it ran. ${TOOL_CANCELLATION_STOP_DIRECTIVE}`;"
assert s.count(old)==1
open(src,'w').write(s.replace(old,new))
