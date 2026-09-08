import sys
src=sys.argv[1]; s=open(src).read()
old="const TOOL_CANCELLED_BEFORE_COMPLETION_MESSAGE = `User intentionally cancelled this tool call. ${TOOL_CANCELLATION_STOP_DIRECTIVE}`;"
new="const TOOL_CANCELLED_BEFORE_COMPLETION_MESSAGE = `This tool call was cancelled before it finished. ${TOOL_CANCELLATION_STOP_DIRECTIVE}`;"
assert s.count(old)==1
open(src,'w').write(s.replace(old,new))
