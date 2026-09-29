// Evidence cards for PR #12975: HTML rendered by Playwright (element crop, 2x).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad';
const OUT = path.join(SP, 'fig', 'out');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(`${SP}/wt-merge/package.json`)('playwright');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px;background:#0d1117;max-width:1500px}
h1{font-size:23px;margin:0 0 4px 0;color:#f0f6fc}
.sub{color:#8b949e;font-size:14px;margin:0 0 16px 0;line-height:1.45}
table{border-collapse:collapse;font-size:13.5px;margin:6px 0 14px 0}
th{background:#161b22;color:#8b949e;text-align:left;padding:7px 10px;border:1px solid #30363d;font-weight:600}
td{padding:7px 10px;border:1px solid #30363d;vertical-align:top;line-height:1.4}
td.case{color:#f0f6fc;font-weight:600;white-space:nowrap}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.bad{color:#ff7b72}.good{color:#7ee787}.warn{color:#e3b341}.dim{color:#8b949e}
.note{border-left:3px solid #58a6ff;padding:6px 12px;color:#c9d1d9;font-size:14px;margin:10px 0 0 0;line-height:1.5}
h2{font-size:16px;margin:18px 0 6px 0;color:#79c0ff}
pre{background:#161b22;border:1px solid #30363d;padding:10px 12px;font-size:12.5px;line-height:1.45;white-space:pre;overflow:hidden;margin:6px 0 12px 0}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const cell = (cls, html) => `<td class="${cls}">${html}</td>`;

const cards = {};

// ---------------------------------------------------------------- figure 1
cards['01-hosted-surrogate-ab'] = page(
  'Hosted tool call with an unpaired surrogate — real stack A/B',
  'Spring server (Session Store + embedded Runtime Broker) · MySQL 8.4.11 · packaged Hosted Harness · real local Worker · fake model emits the call. ' +
    'Same <code>dist/cli.js</code> for Harness and Worker on every arm; <b>main</b> = Broker jar from origin/main 1b69629, <b>PR</b> = main + a2658844. ' +
    'What the Worker received comes from a proxy on the Broker&rarr;Worker hop.',
  `<table><tr><th>Model's tool call</th><th>main (before)</th><th>PR</th><th>PR + client candidate (not in this PR)</th></tr>
<tr>${cell('case', 'run_shell_command<br><code>rm victim-\\ud800.txt</code><br><span class="dim">v3, Worker checks inputDigest</span>')}
${cell('', 'Worker got <code>rm victim-?.txt</code> &rarr; <span class="good">409 digest conflict</span>, not run<br>execution UNKNOWN · <span class="warn">recovery-blocked in 0.9 s</span><br>Workspace lease held · victims intact')}
${cell('', 'start <span class="good">400 runtime_payload_invalid</span>, Worker got nothing<br><span class="warn">client polled 946&times;, 65.8 s</span> (timeout 5 s + 60 s; default 180 s)<br>then cancel &rarr; not_started · <span class="warn">recovery-blocked</span> · lease held')}
${cell('', '<span class="good">turn_complete in 0.8 s</span><br>model gets a correctable error<br>no prepare sent · lease free')}</tr>
<tr>${cell('case', 'edit (file has <code>a?b</code>)<br><code>old_string: "a\\ud800b"</code><br><span class="dim">v2, no digest check</span>')}
${cell('', 'Worker got <code>old_string: "a?b"</code><br><span class="bad">file edited: "status: EDITED"</span> — an edit the model never asked for<br>turn_complete 0.9 s')}
${cell('', '<span class="good">file untouched</span>, Worker got nothing<br><span class="warn">client polled 1638&times;, 120.7 s</span> &rarr; cancelled<br><span class="warn">recovery-blocked</span> · Workspace lease held')}
${cell('', '<span class="good">turn_complete in 0.6 s</span>, file untouched<br>model gets a correctable error')}</tr>
<tr>${cell('case', 'write_file<br><code>content: "half emoji: \\ud83d end"</code>')}
${cell('', 'Worker got <code>"half emoji: ? end"</code><br><span class="bad">file written with "?"</span> · turn_complete 0.9 s')}
${cell('', 'no file · <span class="warn">120.7 s</span> (1277 polls) &rarr; cancelled<br><span class="warn">recovery-blocked</span> · Workspace lease held')}
${cell('', '<span class="good">turn_complete in 0.7 s</span>, no file<br>model gets a correctable error')}</tr>
<tr>${cell('case', 'control: run_shell_command<br><code>printf "rocket 🚀\\n" &gt; pair.txt</code>')}
${cell('', '<span class="good">success</span> · pair.txt = "rocket 🚀"')}
${cell('', '<span class="good">success</span> · pair.txt = "rocket 🚀"')}
${cell('', '<span class="good">success</span> · pair.txt = "rocket 🚀"')}</tr></table>
<pre>Broker -> Worker requests captured on main (JVM -Dhttp.proxyHost, empty nonProxyHosts)
POST /internal/managed-runtime/v3/execute  run_shell_command {"command":"rm victim-?.txt",...}   -> 409 managed_runtime_identity_conflict "invocation digest conflicts"
POST /internal/managed-runtime/v2/execute  edit {"file_path":"note.txt","old_string":"a?b","new_string":"EDITED"}   -> 200 success
POST /internal/managed-runtime/v2/execute  write_file {"file_path":"half.txt","content":"half emoji: ? end\\n"}      -> 200 success
PR: 0 execute requests for the three calls above (the control call is the only execute).</pre>
<p class="note">The PR stops the wrong execution that was real on main (Hosted file tools, v2). On the Hosted Shell path (v3) main already refused at the Worker, so there the PR only changes how long the failure takes.
With the PR, every such call ends the same way: the TS client treats the 400 from <code>:start</code> as a lost reply, polls out its window, and the Hosted session is recovery-blocked with its Workspace lease held (the lease table has no expiry; #12904 class). An 18-line Harness-side refusal (candidate, below) turns all three into sub-second, model-correctable errors.</p>`,
);

// ---------------------------------------------------------------- figure 2
const d = (a, b) => `<td>${a}</td><td>${b}</td>`;
cards['02-broker-api-and-install'] = page(
  'Broker HTTP API and context installation — real Worker, MySQL 8.4',
  'Direct requests to the Spring-embedded Broker (no TS client), and <code>HttpRuntimeTransport.installContext</code> driven with the arm\'s own classes against a managed-context Worker it launched. Worker requests counted by the proxy.',
  `<h2>A. Creating and starting executions</h2><table><tr><th>Request</th><th>main</th><th>PR</th></tr>
<tr><td class="case">POST /executions · write_file, emoji + CJK (control)</td>${d('<span class="good">200</span> success', '<span class="good">200</span> success')}</tr>
<tr><td class="case">POST /executions · edit <code>old_string "a\\ud800b"</code></td>${d('200 · 1 row · <span class="bad">ran edit on "a?b" (note.txt = EDITED)</span>', '<span class="good">400 runtime_reference_invalid · 0 rows</span> · note.txt unchanged')}</tr>
<tr><td class="case">POST /executions · input key <code>"k\\udc00"</code></td>${d('200 · 1 row · <span class="bad">Worker got key "k?"</span>, wrote k.txt', '<span class="good">400 runtime_reference_invalid · 0 rows</span>')}</tr>
<tr><td class="case">POST /executions · toolName <code>"read_file\\ud83d"</code></td>${d('200 · 1 row stored as "read_file?" · Worker 409 &rarr; UNKNOWN', '<span class="good">400 runtime_reference_invalid · 0 rows</span>')}</tr>
<tr><td class="case">prepare + :start · payload with escaped <code>\\ud83d</code></td>${d('start 200 · <span class="bad">esc.txt = "esc ? end"</span>', '<span class="good">start 400 runtime_payload_invalid</span> · row stays PREPARED')}</tr>
<tr><td class="case">prepare + :start · payload with a raw lone surrogate</td>${d('start 400 <span class="warn">runtime_broker_invalid_request</span>', 'start 400 <span class="good">runtime_payload_invalid</span> (the documented code change)')}</tr>
<tr><td class="case">prepare + :start · payload "🚀" (control)</td>${d('<span class="good">200</span> SETTLED success', '<span class="good">200</span> SETTLED success')}</tr></table>
<h2>B. installContext on a READY managed-context binding</h2><table><tr><th>Session record / binding</th><th>main</th><th>PR</th></tr>
<tr><td class="case">ACQUIRING</td>${d('installed · Worker /v3/context +1', '<span class="good">installed · +1</span>')}</tr>
<tr><td class="case">READY</td>${d('installed · +1', '<span class="good">installed · +1</span>')}</tr>
<tr><td class="case">RELEASING</td>${d('<span class="bad">installed · +1</span>', '<span class="good">refused before sending · +0</span>')}</tr>
<tr><td class="case">RELEASED</td>${d('<span class="bad">installed · +1</span>', '<span class="good">refused before sending · +0</span>')}</tr>
<tr><td class="case">FAILED</td>${d('<span class="bad">installed · +1</span>', '<span class="good">refused before sending · +0</span>')}</tr>
<tr><td class="case">READY, binding drain requested</td>${d('<span class="bad">installed · +1</span>', '<span class="good">refused before sending · +0</span>')}</tr></table>
<p class="note">The production acquisition path installs while the record is ACQUIRING; on the PR build a real Hosted Shell turn and <code>HostedWorkspaceToolTurnIT</code> (6/6) still acquire and run.</p>`,
);

fs.writeFileSync(path.join(SP, 'fig', 'cards.json'), JSON.stringify(Object.keys(cards)));
const extra = process.env.EXTRA ? JSON.parse(fs.readFileSync(process.env.EXTRA, 'utf8')) : {};
Object.assign(cards, extra);

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
const tab = await ctx.newPage();
for (const [name, html] of Object.entries(cards)) {
  const file = path.join(SP, 'fig', `${name}.html`);
  fs.writeFileSync(file, html);
  await tab.goto(`file://${file}`);
  const clipped = await tab.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await tab.locator('#card').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name, clipped ? `WARNING ${clipped} clipped pre` : 'ok');
}
await browser.close();
