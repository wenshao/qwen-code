// Round-2 evidence cards for PR #12975 at 0b529019 (Playwright, element crop, 2x).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad';
const R = `${SP}/r2`;
const OUT = `${R}/fig/out`;
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(`${R}/wt-merge/package.json`)('playwright');
const css = fs.readFileSync(`${SP}/fig/01-hosted-surrogate-ab.html`, 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const td = (cls, html) => `<td class="${cls}">${html}</td>`;
const summary = JSON.parse(process.env.SUMMARY);

const cards = {};
cards['04-r2-hosted-surrogate-ab'] = page(
  'Round 2 (0b529019) — Hosted tool call with an unpaired surrogate',
  'Same rig as round 1, rebuilt on the new head. <b>main</b> = origin/main a8ba9b50; <b>PR</b> = 0b529019 merged with that main (a7f856da). Spring server + MySQL 8.4.11 + packaged Hosted Harness + real Worker; ' +
    'Harness and Worker are the same <code>dist/cli.js</code> on both arms; Broker&rarr;Worker requests captured by a proxy.',
  `<table><tr><th>Model's tool call</th><th>main</th><th>PR</th><th>PR + client candidate (rebuilt on this tree)</th></tr>
<tr>${td('case', 'run_shell_command <code>rm victim-\\ud800.txt</code>')}
${td('', 'Worker got <code>rm victim-?.txt</code> &rarr; <span class="good">409 digest conflict</span><br>UNKNOWN · <span class="warn">recovery-blocked 0.76 s</span>')}
${td('', '<span class="good">start 400</span>, Worker got nothing<br><span class="warn">963 polls, 65.8 s</span> &rarr; not_started · recovery-blocked')}
${td('', '<span class="good">turn_complete 0.72 s</span>, no prepare')}</tr>
<tr>${td('case', 'edit <code>old_string "a\\ud800b"</code> (file has <code>a?b</code>)')}
${td('', 'Worker got <code>"a?b"</code> &rarr; <span class="bad">note.txt = "status: EDITED"</span> · 0.90 s')}
${td('', '<span class="good">file untouched</span><br><span class="warn">1757 polls, 120.7 s</span> &rarr; cancelled · recovery-blocked')}
${td('', '<span class="good">turn_complete 0.35 s</span>, file untouched')}</tr>
<tr>${td('case', 'write_file <code>"half emoji: \\ud83d end"</code>')}
${td('', '<span class="bad">file written "half emoji: ? end"</span> · 0.87 s')}
${td('', 'no file · <span class="warn">1729 polls, 120.8 s</span> &rarr; cancelled · recovery-blocked')}
${td('', '<span class="good">turn_complete 0.42 s</span>, no file')}</tr>
<tr>${td('case', 'control <code>printf "rocket 🚀\\n" &gt; pair.txt</code>')}
${td('', '<span class="good">success</span>')}${td('', '<span class="good">success</span>')}${td('', '<span class="good">success</span>')}</tr></table>
<p class="note">Unchanged from round 1: the PR stops the wrong v2 file-tool execution that main performs, and every refused call still ends after the TS client's polling window with the Hosted session recovery-blocked and its Workspace lease held. The +18-line client candidate still applies unchanged (the two client files did not change between the rounds).</p>`,
);

const muts = fs.readFileSync(`${R}/mut/results.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const rows = muts.map((m) => {
  const note = m.name.startsWith('M17') ? 'audit deferred item 2' : m.name.startsWith('M21') ? 'still possible after 3fd42b4d; gone with the candidate' : '';
  return `<tr><td class="mono">${esc(m.name.slice(0, 3))}</td><td>${esc(m.name.slice(4))}</td><td class="${m.verdict === 'KILLED' ? 'good' : 'warn'}">${m.verdict}</td><td class="mono dim">${esc(m.killers[0] ?? note)}${m.killers.length > 1 ? ` +${m.killers.length - 1}` : ''}</td></tr>`;
}).join('');
cards['05-r2-checks-and-r1-4'] = page(
  'Round 2 (0b529019) — re-run checks and the R1-4 follow-up',
  'Delta since round 1: <code>3fd42b4d</code> (hoist <code>Throwable cause = unwrap(error)</code>, +2/&minus;2) and a clean merge of main 5ef79837 (tree equals <code>git merge-tree</code>; brings #12964 takeover reconciliation and #13000).',
  `<h2>A. Re-run on the new head</h2><table><tr><th>Check</th><th>Result</th></tr>
<tr><td class="case">runtime-broker unit + Checkstyle (0b529019)</td><td><span class="good">443 run, 0 failures</span> (17 more from #12964), 2 skipped · 0 violations</td></tr>
<tr><td class="case">PR tests on the new merge base 5ef79837</td><td>the same <span class="good">6 fail</span> as round 1</td></tr>
<tr><td class="case">JdbcRuntimeBrokerMySqlIT twice on one database</td><td>main 2nd run fails <code>expected: &lt;[1]&gt; but was: &lt;[2]&gt;</code> on MySQL 8.4.11 and MariaDB 10.11.18 · <span class="good">PR 4/4 pass</span></td></tr>
<tr><td class="case">installContext state matrix (real Worker)</td><td>main installs RELEASING / RELEASED / FAILED / drain (+1 each) · <span class="good">PR refuses all 4 before sending (+0)</span>, ACQUIRING / READY install</td></tr>
<tr><td class="case">Deadline, block write fails (trigger SIGNAL)</td><td>main <span class="bad">suppressed=[]</span> · <span class="good">PR suppressed=[IllegalStateException(SQLException: rig: recovery block write refused)]</span></td></tr>
<tr><td class="case">Non-retryable failure, block write stalled 2 s, deadline 1 s</td><td><span class="good">PR 3/3 non-retryable runtime_provision_failed</span> (main 3/3 too: the race stays unit-level)</td></tr>
<tr><td class="case">Broker API direct</td><td><span class="good">PR: 400 runtime_reference_invalid, 0 rows</span> for tool name / input key / input value; deferred start 400 runtime_payload_invalid (escaped and raw); controls unchanged</td></tr>
<tr><td class="case">managed-agent-server on PR + main a8ba9b50</td><td>${esc(summary.mas)}</td></tr>
<tr><td class="case">CI on 0b529019 (merge ref on 5ef79837)</td><td><span class="good">all Java jobs green</span>; Hosted process fault gates 39/39, Hosted IT 9/9</td></tr></table>
<h2>B. R1-4: the refactor shares <code>cause</code>, not the classification</h2>
<pre>0b529019  RuntimeBrokerService.java, failure handler
  Throwable cause = unwrap(error);
  if (cause instanceof RuntimeBrokerException failure && !failure.isRetryable())   // publish guard
      nonRetryable.set(failure);
  ...
  boolean retryable = !(cause instanceof RuntimeBrokerException brokerFailure)    // second statement,
          || brokerFailure.isRetryable();                                          // opposite polarity

M21 (the reviewer's witness: only the retryable line changed) on 0b529019 -> SURVIVED (185 run, 0 failures).
Candidate: compute retryable once at the top; publish when !retryable && cause instanceof RuntimeBrokerException.
  runtime-broker 443 run, 0 failures, Checkstyle 0 (cand-r1-4-single-classification.diff).</pre>
<h2>C. Mutation sweep on 0b529019 — ${muts.filter((m) => m.verdict === 'KILLED').length}/${muts.length} killed</h2>
<table><tr><th>#</th><th>Mutant</th><th>Verdict</th><th>First killing test / note</th></tr>${rows}</table>`,
);

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
const tab = await ctx.newPage();
for (const [name, html] of Object.entries(cards)) {
  const file = path.join(R, 'fig', `${name}.html`);
  fs.writeFileSync(file, html);
  await tab.goto(`file://${file}`);
  const clipped = await tab.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await tab.locator('#card').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name, clipped ? `WARNING ${clipped} clipped pre` : 'ok');
}
await browser.close();
