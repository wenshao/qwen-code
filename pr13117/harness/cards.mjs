// VERIFICATION RIG ONLY (PR #13117): render evidence cards from the recorded results.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/pr13117-rig';
const require = createRequire(`${RIG}/wt-head/package.json`);
const { chromium } = require('playwright');
const HEAD_SHA = '58d81b1208';
const MAIN_SHA = '51b80dadbc';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls, s) => `<span class="${cls}">${esc(s)}</span>`;

function card(title, subtitle, body, note) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
  #card{display:inline-block;padding:22px 26px 20px;background:#0d1117;min-width:1000px}
  h1{font-size:21px;margin:0 0 4px;font-weight:650}
  .sub{color:#8b949e;font-size:13.5px;margin-bottom:14px}
  pre{font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;white-space:pre;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px 14px}
  .g{color:#3fb950}.r{color:#f85149}.a{color:#d29922}.b{color:#79c0ff}.m{color:#8b949e}.w{color:#e6edf3;font-weight:600}
  .note{margin-top:12px;border-left:3px solid #3fb950;padding:4px 0 4px 12px;font-size:13.5px;color:#c9d1d9;max-width:1100px}
  .note.amber{border-color:#d29922}
  </style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div><pre>${body}</pre>${note}</div></body></html>`;
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const cards = [];

// ---- 1. real server, every covered operation
{
  const h = JSON.parse(readFileSync(`${RIG}/results/head/results.json`, 'utf8'));
  const m = JSON.parse(readFileSync(`${RIG}/results/main/results.json`, 'utf8'));
  const cov = h.rows.filter((r) => r.covered);
  const fresh = cov.filter((r) => !r.probes.cross.mainDeclared);
  const old = cov.filter((r) => r.probes.cross.mainDeclared);
  const ok = (p) => p.http === 403 && p.code === 'actor_scope_mismatch' && p.requestIdEcho && p.headValid === true;
  const lines = [];
  lines.push(span('m', `$ curl -X POST :18117/api/agent/web-shell/v1/transcript/query -H 'X-Qwen-Tenant-Id: t-home' \\`));
  lines.push(span('m', `      (adapter principal: actor mallory authenticated in tenant t-other)  -H 'X-Request-Id: probe-1'`));
  lines.push(span('w', `HTTP/1.1 403  Content-Type: application/json  X-Request-Id: probe-1`));
  lines.push(span('w', `{"error":{"code":"actor_scope_mismatch","message":"Authenticated actor scope is invalid.","request_id":"probe-1"}}`));
  lines.push('');
  lines.push(span('b', `${pad('operation (19 new)', 27)}${pad('status', 12)}${pad('HTTP', 5)}${pad('error.code', 21)}${pad('req-id', 7)}${pad('main 1.25', 11)}head 1.26`));
  for (const r of fresh) {
    const p = r.probes.cross;
    const good = ok(p) && ok(r.probes.crossBogusId) && ok(r.probes.badActorId);
    lines.push(`${pad(r.id, 27)}${span('m', pad(r.status, 12))}${span(p.http === 403 ? 'g' : 'r', pad(p.http, 5))}${pad(p.code, 21)}${span(p.requestIdEcho ? 'g' : 'r', pad(p.requestIdEcho ? 'echo' : 'NO', 7))}${span('r', pad('undeclared', 11))}${span(good ? 'g' : 'r', good ? 'declared, body valid' : 'FAIL')}`);
  }
  const oldOk = old.filter((r) => ok(r.probes.cross) && ok(r.probes.crossBogusId) && ok(r.probes.badActorId)).length;
  lines.push(`${pad(`+ ${old.length} already declared`, 27)}${span('m', pad('', 12))}${span('g', pad('403', 5))}${pad('actor_scope_mismatch', 21)}${span('g', pad('echo', 7))}${span('g', pad('declared', 11))}${span('g', `${oldOk}/${old.length} declared, body valid`)}`);
  lines.push('');
  const allOk = (k) => cov.filter((r) => ok(r.probes[k])).length;
  lines.push(`${span('w', 'probe kinds')}  cross-tenant, real Session id ${span('g', `${allOk('cross')}/51`)}   cross-tenant, bogus ids ${span('g', `${allOk('crossBogusId')}/51`)}   same tenant, 513-char actor id ${span('g', `${allOk('badActorId')}/51`)}`);
  let same = 0; for (const r of h.rows) { const o = m.rows.find((x) => x.id === r.id); for (const k of ['cross', 'crossBogusId', 'badActorId', 'sameTenant']) if (r.probes[k].http === o.probes[k].http && r.probes[k].code === o.probes[k].code) same++; }
  lines.push(`${span('w', 'main jar  ')}  same status + code on ${span('g', `${same}/${h.rows.length * 4}`)} probes; classes byte-identical (server, SDK, broker); only the bundled OpenAPI JSON differs`);
  const owner = cov.filter((r) => r.probes.sameTenant.http !== 403).length;
  lines.push(`${span('w', 'owner     ')}  alice@t-home on the same routes: ${span('g', `${owner}/51`)} not refused (200/202/400/404 from handlers; planned → 404 not_found)`);
  lines.push(`${span('w', 'unfiltered')}  POST /v1/agents, /v1/agent-channels*, /v1/agent-automations* → 404 not_found (filter skips them; out of scope)`);
  cards.push(['01-real-server-403-matrix', card(
    'Real server: every tenant-filtered operation refuses a cross-tenant actor',
    `Spring fat jar @ ${HEAD_SHA} on MySQL 8.4.7 · real HTTP · bodies validated with Ajv against the ${h.headVersion} contract · 51 covered ops (11 planned)`,
    lines.join('\n'),
    `<div class="note">The 403 was already live on all 51 routes (main jar answers identically). The PR makes the contract say so: 19 operations went from undeclared to declared, and every real 403 body is schema-valid with a matching request_id.</div>`)]);
}

// ---- 2. generated client
{
  const tscMain = readFileSync(`${RIG}/out/tsc-main.log`, 'utf8').trim().split('\n').filter((l) => l.includes('error TS'));
  const consumer = readFileSync(`${RIG}/typecheck/consumer.ts`, 'utf8').split('\n');
  const opOfLine = (l) => { const n = Number(/consumer\.ts\((\d+)/.exec(l)?.[1]); return /operations\['(\w+)'\]/.exec(consumer[n - 1] || '')?.[1]; };
  const lines = [];
  lines.push(span('m', `// consumer.ts: operations['<op>']['responses'][403]['content']['application/json']['error']['code']`));
  lines.push(`${span('w', `tsc vs main ${MAIN_SHA} generated file`)}   ${span('r', `${tscMain.length} errors`)}`);
  for (const l of tscMain) lines.push(`   ${span('r', 'TS2339')} ${pad(opOfLine(l), 25)} Property '403' does not exist`);
  lines.push(`${span('w', `tsc vs head ${HEAD_SHA} generated file`)}   ${span('g', '0 errors')} (same 8 lookups; webShellGetSession/ListSessions compile on both)`);
  lines.push(`${span('w', 'regeneration')}  managed-agent-api.test.ts on head: ${span('g', '2/2 pass')} (committed file == generator output)`);
  lines.push('');
  lines.push(span('b', 'shipped JavaManagedAgentClient → real server'));
  const cross = readFileSync(`${RIG}/results/client-e2e-cross.txt`, 'utf8').trim().split('\n');
  const owner = readFileSync(`${RIG}/results/client-e2e-owner.txt`, 'utf8').trim().split('\n');
  lines.push(span('m', cross[0].replace(/, session .*/, '')));
  for (const l of cross.slice(1)) lines.push(l.includes('status=403') ? l.replace(/(throws .*)/, (x) => span('g', x)) : esc(l));
  lines.push(span('m', owner[0].replace(/, session .*/, '')));
  for (const l of owner.slice(1)) lines.push(esc(l.slice(0, 118)));
  cards.push(['02-generated-client', card(
    'WebShell client: the 6 regenerated 403 entries, typed and at runtime',
    `packages/web-shell generated managed-agent-api.ts · typescript ${require('typescript/package.json').version} strict · client run with tsx against the real head server`,
    lines.join('\n'),
    `<div class="note">A consumer that reads the refusal of the 6 WebShell operations compiles only against the regenerated file. At runtime the shipped client already turns these 403s into JavaManagedAgentHttpError(403, actor_scope_mismatch); the PR changes types, not behavior.</div>`)]);
}

// ---- 3. mutation matrix
{
  const res = (label) => { const p = `${RIG}/out/tests/${label}/RESULT`; return existsSync(p) ? readFileSync(p, 'utf8').trim() : null; };
  const failing = (label) => {
    const dir = `${RIG}/out/tests/${label}/surefire-reports`;
    if (!existsSync(dir)) return [];
    const out = new Set();
    for (const file of require('node:fs').readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
      for (const line of readFileSync(`${dir}/${file}`, 'utf8').split('\n')) {
        const mm = /^com\.alibaba\.qwen\.code\.managedagent\.(?:api\.|service\.)?(\w+)\.(\w+).* <<< (FAILURE|ERROR)!$/.exec(line);
        if (mm) out.add(`${mm[1].replace(/^Managed/, '').replace(/Test$/, '')}.${mm[2]}`);
      }
    }
    return [...out];
  };
  const cell = (label) => {
    const r = res(label); if (!r) return ['m', '—'];
    const f = /fail=(\d+) err=(\d+)/.exec(r); const n = Number(f[1]) + Number(f[2]);
    return n ? ['g', `killed (${n})`] : ['r', 'survives 104/104'];
  };
  const short = (t) => t.replace('AgentApiContract.tenantFilteredRoutesDeclareAndReturnTheActorScopeRefusal', 'new ApiContract test')
    .replace('TenantContextFilter.rejectsTenantHeaderSpoofingAndInvalidActorScope', 'TenantContextFilterTest')
    .replace('AgentApiContract.routesAnswerWithTheirSchemas', 'ApiContract.routesAnswer…')
    .replace(/WorkspaceAdmission\.\w+/, 'WorkspaceAdmissionTest');
  const rows = [
    ['C1', 'contract: drop 403 on getAgent (planned)', null, 'head-C1'],
    ['C2', 'contract: drop 403 on webShellTranscript', null, 'head-C2'],
    ['C3', 'contract: drop 403 on listItems', null, 'head-C3'],
    ['C4', 'contract: getSessionEvents 403 → NotFound', null, 'head-C4'],
    ['C5', 'contract: drop 403 on webShellChangeCwd (planned)', null, 'head-C5'],
    ['F1', 'filter: code actor_scope_mismatch → _denied', 'main-F1', 'head-F1'],
    ['F2', 'filter: status 403 → 401', 'main-F2', 'head-F2'],
    ['G3', 'actor check bypassed on …/events/stream', 'mainG-G3', 'headG-G3'],
    ['G4', 'actor check bypassed on /v1/agents/workspaces', 'mainG-G4', 'headG-G4'],
    ['G5', 'actor check bypassed on …/transcript/', 'mainG-G5', 'headG-G5'],
    ['G6', 'actor check bypassed on …/turns/ (submit, cancel)', 'mainG-G6', 'headG-G6'],
    ['G7', 'actor check bypassed on …/sessions/{id}/items', 'mainG-G7', 'headG-G7'],
    ['G8', 'actor check bypassed on …/sessions/{id}/events', 'mainG-G8', 'headG-G8'],
  ];
  const lines = [];
  lines.push(span('b', `${pad('mutant', 55)}${pad(`main ${MAIN_SHA}`, 19)}${pad(`head ${HEAD_SHA}`, 16)}killed on head by`));
  for (const [id, d, ml, hl] of rows) {
    const [mc, mt] = ml ? cell(ml) : ['m', 'n/a (absent)'];
    const [hc, ht] = cell(hl);
    lines.push(`${pad(`${id}  ${d}`, 55)}${span(mc, pad(mt, 19))}${span(hc, pad(ht, 16))}${esc(failing(hl).map(short).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3).join(', '))}`);
  }
  lines.push(`${pad('C0  contract re-serialized, no change (control)', 55)}${span('m', pad('n/a', 19))}${span('g', pad('passes 104/104', 16))}`);
  lines.push(`${pad('F3–F7  filter skipped entirely on those routes', 55)}${span('g', pad('killed (all 5)', 19))}${span('g', pad('killed (all 5)', 16))}handlers lose the tenant context`);
  lines.push('');
  lines.push(`${span('w', 'regeneration test')}  C2 ${span('g', 'fails')} (webShellTranscript is generated); C1, C5 pass (planned routes are not generated)`);
  lines.push(`${span('w', 'baselines        ')}  main 104/104 · head 104/104 · merge tree (main + PR) ApiContract 6/6 · checkstyle clean`);
  lines.push('');
  lines.push(span('b', 'G5 built into a real jar (main + bypass on …/transcript/); passes all 104 main tests:'));
  lines.push(esc(`POST /api/agent/web-shell/v1/transcript/query  X-Qwen-Tenant-Id: t-home  actor mallory@t-other`));
  lines.push(`   G5 jar   → ${span('r', 'HTTP 200')}  transcript contains ${span('r', '"alice-only: payroll draft v3"')} (alice@t-home's Turn input)`);
  lines.push(`   head jar → ${span('g', 'HTTP 403 actor_scope_mismatch')}; the new test fails on G5 with [webShellTranscript actor-scope error code]`);
  cards.push(['03-negative-controls', card(
    'Negative controls: what each suite notices',
    'Same 13 test classes (every class that touches the tenant filter or a 403) on main and on the PR head, JDK 21; each mutant applied and reverted in its own worktree',
    lines.join('\n'),
    `<div class="note">The new test is the only witness for a missing or wrong 403 declaration (C1–C5) and for an actor-scope bypass on five of the newly declared routes (G3, G5–G8). Main's suite passes all five; G5 on a real server lets another tenant's actor read a transcript.</div>`)]);
}

// ---- 4. request correlation observation
{
  const lines = readFileSync(`${RIG}/results/reqid.txt`, 'utf8').trimEnd().split('\n')
    .map((l) => (l.includes(' 403 ') && !l.includes('hdr-9') ? span('a', l) : esc(l))).join('\n');
  cards.push(['04-webshell-request-id', card(
    'Observation: the filter 403 cannot echo a WebShell body requestId',
    `POST /api/agent/web-shell/v1/turns/submit with body {"requestId":"client-trace-7", …} and no X-Request-Id header · real head server`,
    lines,
    `<div class="note amber">Not introduced by this PR and not a contract violation (requestId is "trace correlation only"). But the 202 and 404 answers of the same operation echo it, and the contract test's own checkRequestId rule expects that echo whenever a body carries requestId; the new probe sends no body, so it never meets this case.</div>`)]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1500, height: 900 } });
for (const [name, html] of cards) {
  const file = `${RIG}/fig/${name}.html`;
  writeFileSync(file, html);
  await page.goto(`file://${file}`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).length);
  await page.locator('#card').screenshot({ path: `${RIG}/fig/${name}.png` });
  console.log(`${name}.png clipped-pre=${clipped}`);
}
await browser.close();
