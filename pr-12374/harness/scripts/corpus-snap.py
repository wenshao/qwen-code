#!/usr/bin/env python3
"""corpus-snap.py <scenario-dir> <out.json> : aggregate view of a large debug dir."""
import os, sys, re, json, time, hashlib
SC=sys.argv[1]; D=f'{SC}/runtime/debug'; now=time.time(); cut=now-30*86400
R=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(-agent-[a-zA-Z0-9_.-]+)?$', re.I)
c={'entries':0,'valid_stale':0,'valid_fresh':0,'valid_stale_bytes':0,'invalid_txt':[],'nonfile':[],'total_file_bytes':0}
for e in os.scandir(D):
    c['entries']+=1
    if not e.is_file(follow_symlinks=False): c['nonfile'].append(e.name); continue
    st=e.stat(follow_symlinks=False); c['total_file_bytes']+=st.st_size
    s=e.name[:-4] if e.name.endswith('.txt') else None
    if s is not None and (R.match(s) or s in ('transcript-replay','workspace-mcp-discovery')):
        if st.st_mtime<cut: c['valid_stale']+=1; c['valid_stale_bytes']+=st.st_size
        else: c['valid_fresh']+=1
    else: c['invalid_txt'].append(e.name)
h=hashlib.sha256()
for root,dirs,files in sorted(os.walk(f'{D}/daemon')):
    dirs.sort()
    for f in sorted(files):
        p=os.path.join(root,f); st=os.lstat(p); h.update(f'{os.path.relpath(p,D)}|{st.st_size}|{int(st.st_mtime)}\n'.encode())
c['daemon_tree_sha']=h.hexdigest()[:16]
L=f'{D}/latest'
c['latest']={'is_symlink':os.path.islink(L),'target':os.readlink(L) if os.path.islink(L) else None,'target_exists':os.path.exists(L)}
c['markers']=sorted(n for n in os.listdir(f'{SC}/home') if n.startswith('.debug'))
c['t']=time.strftime('%H:%M:%S')
json.dump(c,open(sys.argv[2],'w'),indent=1)
print({k:v for k,v in c.items() if k not in ('nonfile',)})
