import re,sys
src,dst=sys.argv[1],sys.argv[2]
out=[];skipped=0;stderr=0
for raw in open(src,encoding='utf-8',errors='replace').read().split('\n'):
    plain=re.sub(r'\x1b\[[0-9;?]*[A-Za-z]','',raw)
    if 'Coverage report from v8' in plain or plain.startswith('JUNIT report'): break
    if re.match(r'\s*↓ ',plain): skipped+=1; continue
    if plain.startswith('qwen serve:'): stderr+=1; continue
    out.append(raw.replace('⎯','─'))
while out and not re.sub(r'\x1b\[[0-9;]*m','',out[-1]).strip(): out.pop()
note=[]
if stderr: note.append(f'{stderr} "qwen serve: … recovery blocked" stderr line(s) from the aborted attempts omitted')
if skipped: note.append(f'{skipped} skipped-test lines (↓) omitted')
if note: out.insert(4,'\x1b[2m  [display trim: '+'; '.join(note)+']\x1b[0m')
open(dst,'w').write('\n'.join(out)+'\n')
