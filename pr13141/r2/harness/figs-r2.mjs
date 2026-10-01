// Round-2 evidence card for PR #13141 @ c7eac4daf2, built from results-r2/.
// Usage: node figs-r2.mjs <worktree with playwright>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const SP = path.dirname(new URL(import.meta.url).pathname);
const R = (f) => path.join(SP, 'results-r2', f);
const R1 = (f) => path.join(SP, 'results', f);
const OUT = path.join(SP, 'figs');
mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const t = (f) => readFileSync(f, 'utf8');
const tests = (f) => (t(f).match(/^\s*Tests\s{2,}([^\n]+)$/m)?.[1] ?? '?').trim();

const nd = JSON.parse(t(R('normdist-r2.json')));
const key = (r) => JSON.stringify([r.outcome, r.exitCode, r.message, r.requests.map((q) => [q.toolProfile, q.status, q.code])]);
const rt2 = JSON.parse(t(R('runtime-pr.json'))).results, rt1 = JSON.parse(t(R1('runtime-pr.json'))).results;
const rtSame = rt2.filter((r, i) => key(r) === key(rt1[i])).length;
const it = (f) => {
  const m = [...t(R(f)).matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+).*?Time elapsed: ([\d.]+) s.*in com\.alibaba\.qwen\.code\.managedagent\.HostedPublicWorkspaceIT/g)].at(-1);
  const [run, fail, err] = [m[1], m[2], m[3]].map(Number);
  return { ok: fail + err === 0, text: `${run - fail - err}/${run} passed (${m[4]} s)` };
};
const rej = t(R('harness-4xx.log')).trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.url === '/session' && x.status >= 400);
const failedCodes = [...new Set([...t(R('it-pr-no-broker.log')).matchAll(/status=FAILED, error_code=([a-z_]+)\}\]/g)].map((m) => m[1]))];
const muts = t(R('mutants-pr-test-r2.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
const killed = muts.filter((m) => m.id !== 'M0' && m.verdict === 'killed' && /AssertionError|to contain/.test(m.reason ?? '')).length;
const control = muts.find((m) => m.id === 'M0').verdict === 'survived';
const ws = (arm) => [1, 2, 3].map((i) => tests(R(`wsagents-${arm}-${i}.log`))).every((s) => /^6 passed/.test(s));
const merge = t(R('merge-info.txt')).match(/merge=([0-9a-f]{10})/)[1];

const row = (a, b, c, cls = 'ok') => `<tr><td>${a}</td><td>${b}</td><td class="${cls}">${c}</td></tr>`;
const p = it('it-pr-positive.log'), q = it('it-pr-passthrough.log'), n = it('it-pr-no-broker.log');
const body = `
<h2>A. What changed since round 1 (<code>1e1f1970b3</code> → <code>c7eac4daf2</code>)</h2>
<table>${row('diff', '<code>packages/cli/src/commands/serve.test.ts</code> only (+16/−6); <code>serve.ts</code> untouched', 'test-only', 'mute')}
${row('test file blob', '<code>f417fa09d6</code>, byte-identical to the round-1 candidate patch', 'identical')}
${row('rebuilt bundle vs round-1 bundle', `${nd.files} JS/JSON/HTML/CSS/text files in <code>dist/</code>; hash-named chunks + commit stamp masked`, nd.onlyInFirst.length + nd.onlyInSecond.length === 0 ? 'no differences' : 'DIFFERS', nd.onlyInFirst.length + nd.onlyInSecond.length === 0 ? 'ok' : 'bad')}</table>
<h2>B. Re-run on the new head</h2>
<table><colgroup><col style="width:30%"><col style="width:46%"><col></colgroup><tr><th>check</th><th>detail</th><th>result</th></tr>
${row('runtime matrix S1–S9', 'real CLI via <code>scripts/cli-entry.js</code>, same probe as round 1', `${rtSame}/9 identical to round 1`, rtSame === 9 ? 'ok' : 'bad')}
${row('HostedPublicWorkspaceIT', 'flags as in the IT (Spring + embedded Broker + H2)', esc(p.text), p.ok ? 'ok' : 'bad')}
${row('', 'pass-through shim (control)', esc(q.text), q.ok ? 'ok' : 'bad')}
${row('', `shim drops only the 2 Broker flags → Harness <code>POST /session</code> ${esc([...new Set(rej.map((x) => `${x.status} ${JSON.parse(x.body).code}`))].join(', '))} (${rej.length}×) → Turn FAILED ${esc(failedCodes.join(', '))}`, esc(n.text) + ' (expected)', n.ok ? 'bad' : 'ok')}
${row('serve.test.ts', 'real 40-column TTY · full file', esc(tests(R('unit-tty-40.log'))))}
${row('', 'real 250-column TTY · full file', esc(tests(R('unit-tty-250.log'))))}
${row('serve + fast-path + hosted-harness-profile + run-qwen-serve', 'head <code>c7eac4daf2</code>', esc(tests(R('unit-related-pr.log'))))}
${row('', `head ⊕ main <code>0a5f518b4f</code> (trial merge <code>${merge}</code>, clean)`, esc(tests(R('unit-related-merge.log'))))}
${row('mutants M0–M9 of serve.ts', 'same 9 mutants as round 1, against the new test', `${control ? 'control passes; ' : 'CONTROL FAILS; '}${killed}/9 killed (all by assertion)`, killed === 9 && control ? 'ok' : 'bad')}</table>
<h2>C. CI on round-1 head <code>1e1f1970b3</code>: <code>Test (ubuntu-latest, Node 22.x)</code> red</h2>
<table><colgroup><col style="width:30%"><col style="width:46%"><col></colgroup><tr><th>failing test</th><th>evidence it is not this PR</th><th>local (base / head)</th></tr>
<tr><td><code>serve/routes/workspace-agents.test.ts</code> › closes an event stream before a replacement runtime can publish to it</td><td><code>ENOTEMPTY … rmdir …/agent-host</code> on all 3 retries; the same signature failed today on 3 unrelated PRs (<code>c330999</code>, <code>aba68fb</code>, <code>131a80b</code>)</td><td class="${ws('base') && ws('pr') ? 'ok' : 'bad'}">3×6 passed / 3×6 passed</td></tr>
<tr><td><code>memory/recall-scan-latency.test.ts</code> › cold-scan fast result inside the initial budget</td><td>timing gate: 157 / 111 / 113 ms on the 3 attempts vs a 100 ms cap, on a GitHub-hosted runner; main relaxed this gate for hosted lanes in #13094, after this branch's base</td><td class="ok">${esc(tests(R('latency-base.log')))} / ${esc(tests(R('latency-pr.log')))}; merge ${esc(tests(R('latency-merge.log')))}</td></tr>
<tr><td colspan="3" class="mute">In that same run <code>src/commands/serve.test.ts</code> passed (78 tests); Lint &amp; Static and Integration Tests passed.</td></tr></table>
<div class="note">Round 2: the change is test-only and matches what was verified. All runtime checks re-run identically, and the new test kills 9/9 mutants. The CI red on 1e1f1970b3 comes from two failures that do not involve this PR.</div>`;

const CSS = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mute:#8b949e;--red:#ff7b72;--green:#7ee787;--amber:#e3b341;--blue:#79c0ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--fg)}
#card{display:inline-block;padding:28px 32px;background:var(--bg);width:1400px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;color:var(--blue);font-weight:600}
.sub{color:var(--mute);font-size:13px;margin-bottom:6px}
table{border-collapse:collapse;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;width:100%}
td,th{border:1px solid var(--line);padding:5px 9px;text-align:left;vertical-align:top}th{background:var(--panel);color:var(--mute);font-weight:600}
code{color:var(--blue)}.ok{color:var(--green)}.bad{color:var(--red)}.mute{color:var(--mute)}
.note{border-left:3px solid var(--green);padding:6px 12px;margin-top:16px;font-size:14px;background:#0f1d14}`;
const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div id="card"><h1>PR #13141 · Round 2 re-verification @ c7eac4daf2</h1><div class="sub">macOS 26 arm64 · Node 22.23.2 · JDK 21 · same harness as round 1 (assets-pr13141 @ 37a8410c)</div>${body}</div>`;
writeFileSync(path.join(OUT, '04-r2.html'), html);

const require = createRequire(path.join(process.argv[2], 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
const pg = await (await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1000 } })).newPage();
await pg.goto('file://' + path.join(OUT, '04-r2.html'));
await pg.locator('#card').screenshot({ path: path.join(OUT, '04-r2.png') });
await browser.close();
console.log('ok', { rtSame, killed, control, ws: [ws('base'), ws('pr')], it: [p.text, q.text, n.text], rej: rej.length, failedCodes, nd: nd.onlyInFirst.length + nd.onlyInSecond.length });
