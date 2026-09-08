import sys
src=sys.argv[1]; s=open(src).read()
old="`This tool call was cancelled before it ran. ${TOOL_CANCELLATION_STOP_DIRECTIVE}`"
new="`SENTINEL_M6_PRE_EXEC. ${TOOL_CANCELLATION_STOP_DIRECTIVE}`"
assert s.count(old)==1
open(src,'w').write(s.replace(old,new))
