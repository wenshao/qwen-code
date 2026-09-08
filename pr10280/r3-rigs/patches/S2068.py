import sys
src=sys.argv[1]
lines=open(src).read().split('\n')
i=2068-1
assert 'TOOL_CANCELLED_BEFORE_EXECUTION_MESSAGE' in lines[i], lines[i]
indent=lines[i][:len(lines[i])-len(lines[i].lstrip())]
lines[i]=indent+"'Tool call cancelled by user.',"
open(src,'w').write('\n'.join(lines))
