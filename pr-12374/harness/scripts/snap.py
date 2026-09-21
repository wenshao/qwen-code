#!/usr/bin/env python3
"""snap.py <scenario-dir> <out.json> : state of runtime/debug + outside + markers."""
import os, sys, json, time
SC=sys.argv[1]; D=f'{SC}/runtime/debug'; now=time.time()
ents=[]
if os.path.isdir(D):
  for e in sorted(os.scandir(D), key=lambda e:e.name):
    st=os.lstat(e.path); kind='symlink' if e.is_symlink() else 'dir' if e.is_dir() else 'file'
    row={'name':e.name,'kind':kind,'age_days':round((now-st.st_mtime)/86400,2),'size':st.st_size,'mode':oct(st.st_mode&0o777)}
    if kind=='symlink': row['target']=os.readlink(e.path); row['target_exists']=os.path.exists(e.path)
    if kind=='dir': row['children']=sum(len(fs) for _,_,fs in os.walk(e.path))
    ents.append(row)
out={'t':time.strftime('%H:%M:%S'),'debug':ents,
     'outside':sorted(os.listdir(f'{SC}/outside')) if os.path.isdir(f'{SC}/outside') else [],
     'markers':sorted(n for n in os.listdir(f'{SC}/home') if n.startswith('.'))}
json.dump(out,open(sys.argv[2],'w'),indent=1); print(len(ents),'entries; markers',out['markers'])
