import sys
src=sys.argv[1]; s=open(src).read()
old="  'Stop and await further instructions; do not retry or work around it.';"
new="  'Stop and await further instructions; do not retry.';"
assert s.count(old)==1
open(src,'w').write(s.replace(old,new))
