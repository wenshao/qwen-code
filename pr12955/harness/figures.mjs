// Renders evidence cards for the PR comment (HTML -> PNG via Playwright).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad/wt-pr/packages/web-shell/package.json');
const { chromium } = require('@playwright/test');
const OUT = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad/shots';

const css = `
body{margin:0;background:#f3f4f6;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#111827}
.card{width:1080px;margin:16px;background:#fff;border:1px solid #d1d5db;border-radius:10px;padding:18px 22px}
h1{font-size:19px;margin:0 0 4px} .sub{color:#4b5563;font-size:12.5px;margin-bottom:12px}
h2{font-size:14.5px;margin:14px 0 6px;color:#1f2937}
table{border-collapse:collapse;width:100%;font-size:12.8px} th,td{border:1px solid #e5e7eb;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#f9fafb;font-weight:600} code,.m{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.ok{background:#dcfce7;color:#166534}.bad{background:#fee2e2;color:#991b1b}.warn{background:#fef3c7;color:#92400e}.info{background:#e0e7ff;color:#3730a3}
.p{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11.5px;font-weight:600;white-space:nowrap}
.note{color:#4b5563;font-size:12px;margin-top:8px} .cols{display:flex;gap:14px}.cols>div{flex:1}
`;
const P = (cls, t) => `<span class="p ${cls}">${t}</span>`;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card">${body}</div></body></html>`;
const SUB = 'PR #12955 head <code>3c53e186</code> · MySQL 8.4.7 · Spring jar with embedded production Broker · separate <code>managed-runtime-worker</code> · packaged Hosted Harness (<code>qwen serve --profile hosted-harness</code>) · Node 22.23.2 · JDK 21 · macOS arm64';

const cards = {
  '02-g0-happy-path': page(`
<h1>G0 initial file Turn — REST and WebShell adapter on the real stack</h1><div class="sub">${SUB}</div>
<table><tr><th>Check</th><th>Public REST <code>/v1/agents/sessions</code> (ws-a / child)</th><th>WebShell adapter <code>/sessions/create</code> (ws-b / child)</th></tr>
<tr><td>Creation → Turn</td><td>${P('ok', '202')} → COMPLETED in 2.2 s</td><td>${P('ok', '202')} → COMPLETED in 2.1 s</td></tr>
<tr><td>File in selected cwd</td><td><code>roots/a/child/proof.txt = "after"</code></td><td><code>roots/b/child/proof.txt = "after"</code></td></tr>
<tr><td>Harness decoy cwd</td><td colspan="2">untouched (empty)</td></tr>
<tr><td>Journal head workspace_id</td><td><code>ws-a</code></td><td><code>ws-b</code></td></tr>
<tr><td>Tool executions / terminal events / model calls</td><td>3 / 1 / 4</td><td>3 / 1 / 4</td></tr>
<tr><td>Replay (same key + payload)</td><td>${P('ok', 'same Session')} 1 Turn, +0 model calls, +0 executions</td><td>${P('ok', 'same Session')} +0 model calls</td></tr>
<tr><td>Same key, changed input</td><td>${P('ok', '409')} <code>idempotency_conflict</code></td><td>—</td></tr></table>
<h2>Wire tap Spring → Harness (<code>POST /session</code>)</h2>
<table><tr><th>Session</th><th>toolProfile</th><th>managedSessionStore.workspaceId</th><th>Model saw tools</th></tr>
<tr><td>G0 REST</td><td><code>hosted-workspace-files/1</code></td><td><code>ws-a</code></td><td>read_file, write_file, edit</td></tr>
<tr><td>G0 WebShell</td><td><code>hosted-workspace-files/1</code></td><td><code>ws-b</code></td><td>read_file, write_file, edit</td></tr>
<tr><td>Unbound legacy (no Workspace)</td><td>(absent)</td><td><code>global-ws</code></td><td>none — COMPLETED, unchanged</td></tr></table>
<h2>Real model (qwen3.8-max) through the same path</h2>
<table><tr><th>Surface</th><th>Result</th><th>Workspace file after the Turn</th></tr>
<tr><td>WebShell adapter, ws-docs</td><td>${P('ok', 'COMPLETED')} 25.4 s · 4 executions (write, edit, 2× read)</td><td class="m">durable Workspaces hold our work,<br>one file, many hands.</td></tr>
<tr><td>Public REST, ws-app</td><td>${P('ok', 'COMPLETED')} · 2 executions (write, read)</td><td class="m">1. Read the PR description and linked issue<br>2. Review the diff for bugs and edge cases<br>3. Check test coverage and leave comments</td></tr></table>
<h2>Integration tests</h2>
<table><tr><th>Run</th><th>Result</th></tr>
<tr><td><code>HostedPublicWorkspaceIT</code> — PR head, H2 / MySQL</td><td>${P('ok', 'pass')} 5.6 s / 7.8 s</td></tr>
<tr><td><code>HostedPublicWorkspaceIT</code> — PR ⊕ main 9f6138ae (clean merge), H2 / MySQL</td><td>${P('ok', 'pass')} 6.3 s / 7.4 s</td></tr>
<tr><td>All <code>Hosted*IT</code> (CI job set) — PR ⊕ main, MySQL</td><td>${P('ok', '9/9')} ToolTurn 5 · HarnessMySql 2 · ProcessCrash 1 · PublicWorkspace 1</td></tr>
<tr><td>CI "Hosted process fault gates / MySQL 8.4" log</td><td>${P('ok', 'ran')} <code>HostedPublicWorkspaceIT</code> 1/1 in 11.3 s</td></tr></table>`),

  '03-g0-gates': page(`
<h1>Admission gates, later operations, opt-out and startup validation</h1><div class="sub">${SUB}</div>
<div class="cols"><div>
<h2>Rejection matrix (public REST)</h2>
<table><tr><th>Case</th><th>With initial input</th><th>Empty input</th></tr>
<tr><td>No actor</td><td>401 <code>actor_required</code></td><td>401</td></tr>
<tr><td>Actor without grant</td><td>404 <code>workspace_not_found</code></td><td>404</td></tr>
<tr><td>Unknown Workspace</td><td>404 <code>workspace_not_found</code></td><td>404</td></tr>
<tr><td>Workspace DRAINING</td><td>409 <code>workspace_unavailable</code></td><td>409</td></tr>
<tr><td>Storage not mounted</td><td>409 <code>workspace_unavailable</code></td><td>202 (binding only)</td></tr>
<tr><td>Unsupported config_ref</td><td>409 <code>workspace_unavailable</code></td><td>202 (binding only)</td></tr>
<tr><td>Read-only actor</td><td>403 <code>workspace_forbidden</code></td><td>403</td></tr>
<tr><td><code>agent_id: another-agent</code></td><td>409 <code>workspace_unavailable</code></td><td>—</td></tr>
<tr><td><code>metadata.toolProfile</code></td><td>400 <code>unsupported_feature</code></td><td>—</td></tr></table>
<h2>Later operations on a completed G0 Session</h2>
<table><tr><th>Operation</th><th>Result</th></tr>
<tr><td>submit · cancel · rename · close · archive · delete</td><td>409 <code>workspace_unavailable</code> (all six)</td></tr>
<tr><td>WebShell <code>/turns/submit</code></td><td>409 <code>workspace_unavailable</code></td></tr>
<tr><td>GET by an actor without grant</td><td>404 <code>session_not_found</code></td></tr></table>
</div><div>
<h2>Opt-out and base A/B</h2>
<table><tr><th>Arm</th><th>REST input</th><th>WebShell input</th><th>Empty bound</th></tr>
<tr><td>PR, opt-in <b>off</b> (same DB)</td><td>409</td><td>409</td><td>202</td></tr>
<tr><td>base bc8879ee</td><td>409</td><td>409</td><td>202</td></tr>
<tr><td>PR, opt-in on</td><td>202 → COMPLETED</td><td>202 → COMPLETED</td><td>202</td></tr></table>
<div class="note">Opt-in off, same DB: the completed G0 Session stays readable (GET/events 200, final text present); replaying its creation now returns 409, as the design states.</div>
<h2>Startup validation (real jar boot)</h2>
<table><tr><th>Opt-in on, but …</th><th>Result</th></tr>
<tr><td>all prerequisites present</td><td>${P('ok', 'starts')}</td></tr>
<tr><td>Harness disabled</td><td>${P('ok', 'refuses to start')}</td></tr>
<tr><td>Session Store disabled</td><td>${P('ok', 'refuses to start')}</td></tr>
<tr><td>Runtime Broker disabled</td><td>${P('ok', 'refuses to start')}</td></tr>
<tr><td>approval-mode=default</td><td>${P('ok', 'refuses to start')}</td></tr>
<tr><td>isolation-class=workspace</td><td>${P('ok', 'refuses to start')}</td></tr>
<tr><td>no Workspace mounts</td><td>${P('ok', 'refuses to start')}</td></tr>
<tr><td>opt-in off + Harness disabled / no mounts</td><td>${P('ok', 'starts')}</td></tr></table>
<div class="note">Refusals all print "Hosted Workspace files require a preapproved Harness, Session Store and Session-isolated local-process Broker with Workspace mounts".</div>
</div></div>`),

  '04-dispatch-refusal-ab': page(`
<h1>F1 — Binding recheck refusal at dispatch is retried and reported as "Harness unavailable"</h1><div class="sub">${SUB}<br>Procedure: 3 G0 Sessions admitted while Spring→Harness requests are dropped (1st attempt → transient retry); then Workspace A set DRAINING and the creator's <code>can_create</code> on Workspace B revoked; drops stop. Control Workspace C unchanged.</div>
<table><tr><th>Session</th><th>PR 3c53e186</th><th>Candidate (+10 lines in HarnessCoordinator)</th></tr>
<tr><td>A — Workspace DRAINING after admission</td><td>${P('bad', 'FAILED')} after <b>32.9 s</b>, 5 retries<br><code>hosted_harness_unavailable</code> "Hosted Harness remained unavailable before Turn admission."</td><td>${P('ok', 'FAILED')} after <b>1.8 s</b><br><code>workspace_unavailable</code> "Hosted Workspace execution is not available."</td></tr>
<tr><td>B — creator's create grant revoked</td><td>${P('bad', 'FAILED')} after 32.9 s, 5 retries, <code>hosted_harness_unavailable</code></td><td>${P('ok', 'FAILED')} after 1.8 s, <code>workspace_unavailable</code></td></tr>
<tr><td>C — control</td><td>${P('ok', 'COMPLETED')} (1 transient retry)</td><td>${P('ok', 'COMPLETED')} (1 transient retry)</td></tr></table>
<h2>Spring coordinator log (PR)</h2>
<pre class="m" style="background:#f9fafb;border:1px solid #e5e7eb;padding:8px;margin:0">3 × retry=1 delayMs=1000  failure=MutationOutcomeUnknownException   ← injected drop (A, B, C)
2 × retry=2 delayMs=2000  failure=RuntimeBrokerException           ← authorize(): 409 workspace_unavailable, retryable=false
2 × retry=3 delayMs=4000  failure=RuntimeBrokerException
2 × retry=4 delayMs=8000  failure=RuntimeBrokerException
2 × retry=5 delayMs=16000 failure=RuntimeBrokerException
→ transientFailure() exhausts max-pre-admission-retries=5 → fail("hosted_harness_unavailable")</pre>
<div class="note">Candidate: catch <code>RuntimeBrokerException</code> with code <code>workspace_unavailable</code> before admission and fail with that code; other Broker errors and post-submission failures keep the existing retry path. New unit test fails without the change; managed-agent-server suite 182/182 with Checkstyle (includes the F2 test).</div>`),

  '05-workspace-lease': page(`
<h1>F3 — One active G0 Turn per Workspace; a crashed Turn keeps the Workspace lease</h1><div class="sub">${SUB}</div>
<h2>Two creations in the same Workspace at once (deterministic model, 1.5 s per step)</h2>
<table><tr><th>Session</th><th>Result</th><th>What the public API shows</th></tr>
<tr><td>first</td><td>${P('ok', 'COMPLETED')} 7.2 s</td><td><code>turn.completed</code></td></tr>
<tr><td>second</td><td>${P('bad', 'FAILED')} 2.0 s — Harness stderr: <code>Runtime Broker returned HTTP 409 (workspace_busy)</code></td><td><code>turn.failed {code: hosted_turn_failed}</code>; later submit is gated, so the Session cannot retry</td></tr>
<tr><td>3 sequential Sessions, then a 4th after both concurrent ones settled</td><td>${P('ok', 'all COMPLETED')}</td><td>lease released after normal completion</td></tr></table>
<h2>Hosted Harness SIGKILL during a G0 Turn (after <code>write_file</code> ran, model call pending)</h2>
<table><tr><th>Step</th><th>Observed</th></tr>
<tr><td>Harness restarted; stream breaks</td><td>Turn ${P('warn', 'FAILED')} <code>hosted_harness_generation_mismatch</code> (pre-existing connector behaviour, also on base)</td></tr>
<tr><td>Public cancel of that Turn</td><td>409 <code>workspace_unavailable</code> (gated)</td></tr>
<tr><td>Workspace execution lease</td><td>still held; <code>qwen_runtime_binding</code> of the crashed Session stays <code>READY</code></td></tr>
<tr><td>New G0 Session in the same Workspace — after Spring restart #1 (~4 min) and #2 (~10 min)</td><td>${P('bad', 'FAILED')} <code>hosted_turn_failed</code> both times (Broker <code>workspace_busy</code>)</td></tr>
<tr><td>New G0 Session in another Workspace</td><td>${P('ok', 'COMPLETED')}</td></tr></table>
<div class="note">Same class as #12904 (no supported recovery for a held Workspace lease). The PR scopes G1–G3 recovery out; G0 makes this reachable from public creation, and the caller only sees <code>hosted_turn_failed</code>.</div>`),

  '06-mutation': page(`
<h1>Mutation testing of the PR's Java changes (20 single mutants + 1 combined)</h1><div class="sub">Each mutant against the full managed-agent-server unit suite (180 tests) and, if it survived, <code>HostedPublicWorkspaceIT</code> (H2). SDK DTO mutants also ran <code>HostedHarnessClientTest</code>.</div>
<table><tr><th>ID</th><th>Mutation</th><th>Killed by</th></tr>
<tr><td>M1–M5</td><td>connector: drop <code>authorize()</code> · global workspaceId · no profile on load · no profile on create · drop disabled check</td><td>${P('ok', 'unit')} QwenHostedHarnessConnectorTest</td></tr>
<tr><td>M11, M12</td><td>coordinator: always refuse bound Turns · never refuse</td><td>${P('ok', 'unit')} HarnessCoordinatorTest</td></tr>
<tr><td>M13–M15, M19, M20</td><td>startup validation: drop isolation / yolo / mounts / local-process / Session Store clause</td><td>${P('ok', 'unit')} ManagedAgentPropertiesTest</td></tr>
<tr><td>M17, M18</td><td>SDK: drop <code>toolProfile</code> from Create/LoadHarnessSession JSON</td><td>${P('ok', 'unit')} HostedHarnessClientTest + connector test</td></tr>
<tr><td>M6, M7, M8</td><td>store: drop mount check · drop config/policy check · drop agent check</td><td>${P('ok', 'IT only')} expected 409</td></tr>
<tr><td>M9, M10</td><td>store / service opt-in gate removed individually</td><td>${P('info', 'equivalent')} the other gate still refuses</td></tr>
<tr><td><b>M9+M10</b></td><td><b>both opt-in gates removed</b></td><td>${P('bad', 'survives')} 180 unit + IT → candidate test: 409 expected, 202 returned</td></tr>
<tr><td>M16</td><td>store: mount matched by storage only (tenant ignored)</td><td>${P('warn', 'survives')} unit + IT (single-tenant fixture)</td></tr></table>
<div class="note">Why M9+M10 survives: <code>ManagedWorkspaceAdmissionTest</code> registers <code>config-ws-a</code> and configures no mounts, so the new profile/mount check refuses input anyway and masks the opt-in. Candidate <code>ManagedWorkspaceFilesOptInTest</code> uses the fixed profile + a matching mount with the opt-in off; it passes on the PR, passes with M9 or M10 alone, and fails with M9+M10.</div>`),
};

const browser = await chromium.launch();
const pg = await browser.newPage({ viewport: { width: 1140, height: 900 }, deviceScaleFactor: 2 });
for (const [name, html] of Object.entries(cards)) {
  const f = `${OUT}/${name}.html`;
  fs.writeFileSync(f, html);
  await pg.goto('file://' + f);
  await pg.locator('.card').screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', name);
}
// Web Shell screenshot, cropped to content
const ui = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
await ui.goto('http://localhost:5955/e2e/fixtures/g0-rig.html?theme=light&session=29b858ed-d0eb-4b97-8b5e-bc6b041d211a', { waitUntil: 'load' });
await ui.getByText('durable Workspaces', { exact: false }).first().waitFor({ timeout: 20000 });
await ui.waitForTimeout(1200);
await ui.screenshot({ path: `${OUT}/01-webshell-g0-session.png`, clip: { x: 0, y: 0, width: 1360, height: 510 } });
console.log('wrote 01');
await browser.close();
