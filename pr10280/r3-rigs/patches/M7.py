import sys
src=sys.argv[1]; s=open(src).read()
old="        payload?.cancelMessage || 'User did not allow tool call';"
new="        payload?.cancelMessage || 'SENTINEL_M7_DIALOG_REFUSAL';"
assert s.count(old)==1, s.count(old)
open(src,'w').write(s.replace(old,new))
