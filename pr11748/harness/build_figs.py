import base64, io, json
from PIL import Image
O='/root/git/pr11748-harness/e2e/out'
F='/root/git/pr11748-harness/figs'

def trim(path, box=None, pad=24):
    im=Image.open(path).convert('RGB')
    if box: im=im.crop(box)
    bg=im.getpixel((im.width-1, im.height-1))
    w,h=im.size; px=im.load()
    def diff(p): return sum(abs(a-b) for a,b in zip(p,bg))>40
    top=next((y for y in range(h) if any(diff(px[x,y]) for x in range(0,w,2))),0)
    bot=next((y for y in range(h-1,-1,-1) if any(diff(px[x,y]) for x in range(0,w,2))),h-1)
    left=next((x for x in range(w) if any(diff(px[x,y]) for y in range(top,bot+1,2))),0)
    right=next((x for x in range(w-1,-1,-1) if any(diff(px[x,y]) for y in range(top,bot+1,2))),w-1)
    im=im.crop((max(0,left-pad),max(0,top-pad),min(w,right+pad),min(h,bot+pad)))
    buf=io.BytesIO(); im.save(buf,'PNG')
    return 'data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()

CSS='''
*{box-sizing:border-box} body{margin:0;background:#eef0f3;font:15px/1.45 "DejaVu Sans",system-ui,sans-serif;color:#1d2330}
#fig{width:1400px;padding:28px 32px;background:#fff}
h1{font-size:22px;margin:0 0 4px} .sub{color:#5b6472;margin:0 0 18px;font-size:14px}
.cols{display:flex;gap:20px;align-items:flex-start} .col{flex:1;min-width:0}
.lab{font-weight:700;margin:0 0 6px;font-size:14px} .lab .sha{font-family:"DejaVu Sans Mono",monospace;font-weight:400;color:#5b6472}
.shot{background:#0a0a0a;border-radius:8px;padding:8px;border:1px solid #d5d9e0} .shot img{width:100%;display:block}
table{border-collapse:collapse;width:100%;margin-top:18px;font-size:14px}
th,td{border:1px solid #d5d9e0;padding:7px 10px;text-align:left;vertical-align:top}
th{background:#f3f5f8} td.m,code{font-family:"DejaVu Sans Mono",monospace;font-size:13px}
.bad{background:#fdecec;color:#9b1c1c;font-weight:700} .ok{background:#e8f6ec;color:#17602f;font-weight:700} .warn{background:#fff4dd;color:#8a5300;font-weight:700}
.note{color:#5b6472;font-size:13px;margin-top:10px}
pre{background:#f6f8fa;border:1px solid #d5d9e0;border-radius:6px;padding:10px 12px;font:12.5px/1.5 "DejaVu Sans Mono",monospace;white-space:pre-wrap;word-break:break-all;margin:6px 0 0}
'''
def page(name, body):
    open(f'{F}/{name}.html','w').write(f'<!doctype html><meta charset="utf-8"><style>{CSS}</style><div id="fig">{body}</div>')

db=json.load(open(f'{O}/decrqm-base/result.json'))['steps']['decrqm']
dh=json.load(open(f'{O}/decrqm-head/result.json'))['steps']['decrqm']
def cell(v, good): return f'<td class="{"ok" if good else "bad"}">{v}</td>'
rows=''
names={'da1':'DA1 control <code>ESC [ c</code>','decrqm-private':'DECRQM <code>ESC [ ? 2026 $ p</code>','decrqm-ansi':'DECRQM <code>ESC [ 4 $ p</code>','decrqm-2004':'DECRQM <code>ESC [ ? 2004 $ p</code>'}
for b,h in zip(db['runs'],dh['runs']):
    rows+=f'<tr><td>{names[b["which"]]}</td>{cell(str(b["replyBytesAtPty"])+" bytes", b["replyBytesAtPty"]>0)}{cell(str(h["replyBytesAtPty"])+" bytes", h["replyBytesAtPty"]>0)}{cell("yes" if b["renderedSameWriteMarker"] else "no — frozen", b["renderedSameWriteMarker"])}{cell("yes" if h["renderedSameWriteMarker"] else "no", h["renderedSameWriteMarker"])}</tr>'
page('01-decrqm-real-stack', f'''
<h1>1 · DECRQM in the real Web Shell terminal — merge-base build vs PR build</h1>
<p class="sub">Real <code>qwen serve</code> (built from 538ae5cc) + real PTY/bash + the production <code>vite build</code> of each Web Shell arm, driven in Chromium.
Inside the terminal, <code>query-emit.cjs</code> writes one query between two markers and records the reply bytes that actually reach the PTY's stdin.</p>
<div class="cols">
 <div class="col"><p class="lab">merge-base Web Shell <span class="sha">b5567bb7 · default target → es2020 lowering</span></p><div class="shot"><img src="{trim(O+'/decrqm-base/decrqm-live.png')}"></div></div>
 <div class="col"><p class="lab">PR Web Shell <span class="sha">538ae5cc · build.target es2021</span></p><div class="shot"><img src="{trim(O+'/decrqm-head/decrqm-live.png')}"></div></div>
</div>
<table><tr><th>Query sent by a program in the terminal</th><th>reply at PTY · base</th><th>reply at PTY · PR</th><th>rest of that write rendered · base</th><th>· PR</th></tr>{rows}
<tr><td>Later <code>echo LATER-OUTPUT-$((7*7))</code></td>{cell("not rendered", False)}{cell("rendered", True)}<td colspan="2"></td></tr>
<tr><td>Page reload, then <code>echo POST-RELOAD-$((8*8))</code></td>{cell("blank pane; new output never renders", False)}{cell("history restored; new output renders", True)}<td colspan="2"></td></tr>
<tr><td>Page errors</td>{cell("2 × ReferenceError: n is not defined", False)}{cell("0", True)}<td colspan="2"></td></tr>
</table>
<p class="note">Built bundles: merge-base <code>requestMode(e,t){{(v=&gt;(…))(void 0||(n={{}}));…</code> (the <code>let n</code> is dropped) · PR <code>requestMode(e,t){{let n;(v=&gt;(…))(n||={{}});…</code>. The published <code>@qwen-code/qwen-code@0.23.3</code> web-shell bundle contains the same broken <code>(void 0||(n={{}}))</code> site.</p>
''')

lb=json.load(open(f'{O}/legacy-base/result.json'))['steps']
lh=json.load(open(f'{O}/legacy-head/result.json'))['steps']
zh=json.load(open(f'{O}/zh2-old-daemon/zh.json'))
def frames(st): return ', '.join(x['text'].replace('\\0','\\0') for s in st['legacy']['socketsAfterMismatch'] for x in s['sent'])
page('02-old-daemon', f'''
<h1>2 · New Web Shell → daemon that predates the replay protocol</h1>
<p class="sub">Same real stack; the daemon is a pre-#11643 build (a651427f, sends an unmarked binary snapshot). Oracles: frames the browser sent on <code>/terminal</code> (Playwright),
the close event, and <code>bash</code> processes alive under the daemon PID (<code>/proc</code>).</p>
<table><tr><th></th><th>merge-base Web Shell (b5567bb7)</th><th>PR Web Shell (538ae5cc)</th></tr>
<tr><td>Frames sent before the client closes</td><td class="m">{frames(lb)}</td><td class="m">{frames(lh)}</td></tr>
<tr><td>Close event seen by the browser</td><td class="m">4002 Terminal protocol mismatch</td><td class="m">4004 Terminal released <span style="color:#5b6472">(daemon closes first after the release)</span></td></tr>
<tr><td><code>bash</code> under the old daemon after the mismatch</td>{cell("1 — stranded until the tab is closed / idle reclaim", False)}{cell("0 — released", True)}</tr>
<tr><td>Then closing the terminal tab</td><td>opens a <code>release=1</code> socket, sends release → 0 shells</td>{cell("no new socket, 0 frames sent, 0 shells", True)}</tr>
<tr><td>Notice text</td><td>hard-coded English (no <code>terminal.notice.protocolMismatch</code> key in the bundle)</td><td>via <code>t('terminal.notice.protocolMismatch')</code></td></tr>
</table>
<div class="cols" style="margin-top:18px">
 <div class="col"><p class="lab">PR Web Shell, UI language en</p><div class="shot"><img src="{trim(O+'/legacy-head/legacy-mismatch.png')}"></div></div>
 <div class="col"><p class="lab">PR Web Shell, UI switched with <code>/language ui zh-CN</code></p><div class="shot"><img src="{trim(O+'/zh2-old-daemon/page.png', box=(1640,0,3000,300))}"></div></div>
</div>
<p class="note">zh-CN arm frames sent: <code>{', '.join(zh['framesSent'])}</code> · notice rendered: <code>{zh['terminalRows'][0]}</code></p>
''')

page('03-regression-test-guard', '''
<h1>3 · Does <code>scripts/tests/web-terminal-build.test.ts</code> catch a revert of the fix?</h1>
<p class="sub">The test imports <code>resolveConfig</code> from bare <code>vite</code> and <code>transform</code> from bare <code>esbuild</code>, i.e. the <b>repository root</b> copies.
The Web Shell is built by its own nested <code>packages/web-shell/node_modules/vite</code> 5.4.21 (esbuild 0.21.5). Root versions per <code>package-lock.json</code>: vite 7.3.6, esbuild 0.25.6.</p>
<table><tr><th>vite.config.ts</th><th>toolchain the test resolves</th><th><code>config.build.target</code></th><th>PR test as written</th><th>same test, vite+esbuild resolved from packages/web-shell</th></tr>
<tr><td>PR (es2021)</td><td class="m">root vite 7.3.6 + esbuild 0.25.6 (CI lockfile)</td><td class="m">"es2021"</td><td class="ok">pass</td><td class="ok">pass</td></tr>
<tr><td>PR (es2021)</td><td class="m">root vite 5.4.21 + esbuild 0.25.12 (this box, drifted)</td><td class="m">"es2021"</td><td class="ok">pass</td><td class="ok">pass</td></tr>
<tr><td>merge-base (no target)</td><td class="m">root vite 7.3.6 + esbuild 0.25.6 (CI lockfile)</td><td class="m">["chrome107","edge107","firefox104","safari16"]</td><td class="warn">PASS — revert not detected</td><td class="bad">fail · ReferenceError: i is not defined</td></tr>
<tr><td>merge-base (no target)</td><td class="m">root vite 5.4.21 + esbuild 0.25.12 (this box, drifted)</td><td class="m">["es2020","edge88","firefox78","chrome87","safari14"]</td><td class="bad">fail · ReferenceError: i is not defined</td><td class="bad">fail · ReferenceError: i is not defined</td></tr>
</table>
<p class="note">Vite 7's default target is <code>baseline-widely-available</code>, which never lowers <code>||=</code>, so under the lockfile toolchain the merge-base config looks healthy even though the real Web Shell build still ships the broken site.</p>
<table><tr><th>xterm 6.0.0 minified by</th><th>es2020</th><th>vite 5 default (modules)</th><th>es2021</th><th>vite 7 default (baseline)</th></tr>
<tr><td class="m">esbuild 0.21.5 (web-shell's real compiler)</td><td class="bad">1 broken site · freeze</td><td class="bad">1 broken site · freeze</td><td class="ok">ok</td><td class="ok">ok</td></tr>
<tr><td class="m">esbuild 0.25.6 (root, lockfile)</td><td class="bad">1 broken site · freeze</td><td class="bad">1 broken site · freeze</td><td class="ok">ok</td><td class="ok">ok</td></tr>
<tr><td class="m">esbuild 0.25.12</td><td class="bad">1 broken site · freeze</td><td class="bad">1 broken site · freeze</td><td class="ok">ok</td><td class="ok">ok</td></tr>
<tr><td class="m">esbuild 0.28.2</td><td class="ok">ok</td><td>rejected (destructuring for firefox78)</td><td class="ok">ok</td><td class="ok">ok</td></tr>
</table>
''')
print('figs html written')
