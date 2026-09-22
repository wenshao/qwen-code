import sys,re
R=sys.argv[1]
ev={l.split()[1]:float(l.split()[0]) for l in open(R+'/events.txt') if l.strip()}
probes=[]
for l in open(R+'/strace.log'):
    m=re.match(r'(\d+)\s+([\d.]+)\s+execve\("([^"]+)",\s*\[(.*?)\]',l)
    if m and 'command -v' in m.group(4): probes.append((float(m.group(2)),re.search(r'command -v (\S+?)"',m.group(4)).group(1)))
def cnt(a,b): return [p for t,p in probes if a<=t<b]
print('total command -v probes:',len(probes))
print('startup (before ready):',len(cnt(0,ev['ready'])), sorted(set(cnt(0,ev['ready']))))
print('prompt -> dialog on screen:',cnt(ev['ready'],ev['dialog']))
print('during 12 cursor moves:',cnt(ev['dialog'],ev['rerenders-done']))
print('after (esc/exit):',cnt(ev['rerenders-done'],1e12))
