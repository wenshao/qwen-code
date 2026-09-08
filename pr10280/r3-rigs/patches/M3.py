import sys
src=sys.argv[1]; s=open(src).read()
old="const TOOL_CANCELLED_AFTER_COMPLETION_MESSAGE = `The tool had already completed; its output was discarded. User intentionally cancelled. ${TOOL_CANCELLATION_STOP_DIRECTIVE}`;"
new="const TOOL_CANCELLED_AFTER_COMPLETION_MESSAGE = `The tool had already completed; its output was discarded. ${TOOL_CANCELLATION_STOP_DIRECTIVE}`;"
assert s.count(old)==1
open(src,'w').write(s.replace(old,new))
