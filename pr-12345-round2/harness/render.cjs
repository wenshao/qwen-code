const { chromium } = require('playwright'); const fs = require('fs');
const H = '/root/verify/pr12345-r2-harness';
const img = f => 'data:image/png;base64,' + fs.readFileSync(`${H}/out/${f}`).toString('base64');
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const A = n => JSON.parse(fs.readFileSync(`${H}/out/${n}`, 'utf8')).steps;
const D = A('phaseA-D.json'), C = A('phaseA-C.json'), M = A('phaseA-D-mutant.json');
const css = `body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif}.wrap{padding:22px;display:inline-block}h2{margin:0 0 4px;font-size:18px}.sub{color:#8b949e;margin:0 0 14px}table{border-collapse:collapse}td,th{border:1px solid #30363d;padding:6px 10px;text-align:left;vertical-align:top}th{background:#161b22}.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.mid{color:#d29922;font-weight:600}code{font-family:ui-monospace,Menlo,monospace;background:#161b22;padding:1px 4px;border-radius:4px}.grid{display:flex;gap:18px;align-items:flex-start}.cap{color:#8b949e;margin:6px 0}`;
function cell(s, arm) {
  const posts = (s.promptPosts || []).length, calls = s.fakeModelCalls ?? 0;
  const toast = (s.toasts || []).some(t => /disabled by the host/.test(t));
  if (s.step === 'welcome /auth') return s.dialogs ? `<span class="mid">auth dialog opened</span>` : toast ? `<span class="ok">refused (toast)</span>, 0 POST` : 'no-op';
  if (posts) return `<span class="${arm==='D'?'bad':'mid'}">forwarded</span>: ${posts} POST /prompt, ${calls} model call(s)`;
  if (s.dialogs) return `<span class="mid">auth dialog opened</span>`;
  if (toast) return `<span class="ok">refused</span>: 0 POST, 0 model calls`;
  return '0 POST';
}
const rows = D.filter(s => s.step.startsWith('welcome') || s.step.startsWith('session')).map((s, i) => {
  const c = C.find(x => x.step === s.step), m = M.find(x => x.step === s.step);
  const label = s.step.replace('session ', 'in session: ').replace('welcome ', 'welcome page: ');
  let mc = cell(m, 'D'); if (s.step.includes('"/AUTH"')) mc = mc.replace('class="bad"', 'class="mid"');
  let dc = cell(s, 'D'); if (s.step.includes('"/AUTH"')) dc = dc.replace('class="bad"', 'class="mid"') + ' — daemon treats it as plain text (case-sensitive lookup, same as client)';
  return `<tr><td><code>${esc(label)}</code></td><td>${cell(c,'C')}</td><td>${dc}</td><td>${mc}</td></tr>`;
}).join('');
const after = D.find(s => s.step === 'after refusals');
const pages = {
 '01-real-daemon-ab.png': `<h2>PR #12345 @ abaf6e85 — real <code>qwen serve</code> daemon + fake OpenAI server, Linux Chromium</h2><p class="sub">Every cell is measured on the wire (browser POSTs) and at the model (fake server request log). C = options omitted · D = <code>allowAdd:false, allowDelete:false</code> · Mutant = D with <code>isModelSetupCommand()</code> forced to <code>false</code></p><table><tr><th>Composer input</th><th>C (default host)</th><th>D (both disabled)</th><th>Mutant (negative control)</th></tr>${rows}<tr><td><code>ordinary chat after refusals</code></td><td class="ok">reaches model</td><td class="ok">reaches model (${after.promptPosts} POST)</td><td class="ok">reaches model</td></tr></table><p class="cap">Mutant leaks <code>/login</code>, <code>/connect</code>, <code>/  auth</code> to the daemon (3 of 6 killed by this harness); bare <code>/auth</code> is still caught by App's separate local-route gate — defence in depth as documented.</p>`,
 '02-model-section-ab.png': `<h2>Settings → Models on a real daemon (two providers configured in settings.json)</h2><p class="sub">Left: default host (C). Right: <code>allowAdd:false, allowDelete:false</code> (D). Same result when Settings is opened by URL deep link <code>/agentic-code/settings</code> (main's new URL navigation, merged in abaf6e85).</p><div class="grid"><div><p class="cap">C — + Add Model, 3× Delete</p><img width="760" src="${img('B-C-model-section.png')}"></div><div><p class="cap">D — Set current / Edit context window only</p><img width="760" src="${img('B-D-model-section.png')}"></div></div>`,
 '03-config-bypass.png': `<h2>Scope note: <code>/config</code> from the composer still reconfigures the provider under <code>allowAdd:false</code></h2><p class="sub">D arm. Three composer commands write <code>~/.qwen/settings.json</code>; after a daemon restart the next prompt goes to an unlisted model at an unlisted endpoint.</p><div class="grid"><img width="900" src="${img('D-D-config-injection.png')}"><div style="max-width:560px"><p class="cap">settings.json after the commands</p><pre style="background:#161b22;padding:10px;border-radius:6px">model.name            = "unlisted-model"
model.baseUrl         = "http://127.0.0.1:18345/injected/v1"
security.auth.baseUrl = "http://127.0.0.1:18345/injected/v1"
security.auth.apiKey  = "sk-injected-by-composer"  (earlier probe)</pre><p class="cap">fake server log, first prompt after daemon restart</p><pre style="background:#161b22;padding:10px;border-radius:6px">POST /injected/v1/chat/completions  model=unlisted-model
POST /injected/v1/chat/completions  model=unlisted-model</pre><p class="cap">Neither the model nor the endpoint was in the provider list the host provisioned. The PR's docs say file writes are out of scope, but <code>/config</code> is typed in the WebShell composer, so a line in the README/design doc (or a narrow gate on <code>security.auth.*</code>/<code>model.baseUrl</code>) is worth considering.</p></div></div>`,
 '04-dynamic-tighten.png': `<h2>Dynamic tightening on a real session (default host → <code>allowAdd:false</code> while the /auth dialog is open)</h2><p class="sub">The dialog closes; an ordinary prompt then reaches the model (editor not blocked); <code>/auth</code> is refused; re-enabling does not resurrect the stale dialog; a fresh <code>/auth</code> opens it again.</p><div class="grid"><div><p class="cap">before: dialog open</p><img width="700" src="${img('E1-dialog-open.png')}"></div><div><p class="cap">after policy change: closed, chat usable</p><img width="700" src="${img('E1-after-tighten.png')}"></div></div>`,
};
(async () => {
  const b = await chromium.launch();
  for (const [name, body] of Object.entries(pages)) {
    const p = await b.newPage({ viewport: { width: 1700, height: 900 }, deviceScaleFactor: 1.5 });
    await p.setContent(`<style>${css}</style><div class="wrap">${body}</div>`); await p.waitForTimeout(300);
    const box = await p.locator('.wrap').boundingBox();
    await p.setViewportSize({ width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20 });
    await p.locator('.wrap').screenshot({ path: `${H}/pub/${name}` }); await p.close();
  }
  await b.close();
})();
