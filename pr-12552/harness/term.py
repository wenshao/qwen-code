# render a terminal transcript file into a dark terminal-style HTML panel
import html,sys
title,src,out=sys.argv[1:4]
lines=open(src).read().rstrip('\n').split('\n')
def color(l):
    e=html.escape(l)
    if l.startswith('PASS'): return f'<span class=p>{e[:4]}</span>{e[4:]}'
    if l.startswith('FAIL'): return f'<span class=f>{e[:4]}</span>{e[4:]}'
    if l.startswith('$'): return f'<span class=c>{e}</span>'
    return e
body='\n'.join(color(l) for l in lines)
open(out,'w').write(f'''<html><head><style>
body{{margin:0;background:#fff;font-family:ui-monospace,Menlo,monospace}}
main{{display:inline-block;margin:0;background:#0d1117;color:#c9d1d9;border-radius:8px;overflow:hidden;max-width:1080px}}
.t{{background:#161b22;color:#8b949e;padding:8px 14px;font:13px sans-serif}}
pre{{margin:0;padding:12px 14px;font-size:12.5px;line-height:1.5;white-space:pre-wrap;word-break:break-all}}
.p{{color:#3fb950;font-weight:bold}}.f{{color:#f85149;font-weight:bold}}.c{{color:#79c0ff}}
</style></head><body><main><div class=t>{html.escape(title)}</div><pre>{body}</pre></main></body></html>''')
