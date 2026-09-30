// VERIFICATION RIG ONLY (PR #13117): drive every tenant-filtered contract operation over real HTTP
// against a running server jar and check each answer against the head and main contracts.
// usage: node probe.mjs <label> <out-dir>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire('/Users/wenshao/git/qwen-code-x3/packages/core/package.json');
const Ajv2020 = require('ajv/dist/2020.js').default;

const [label, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const BASE = 'http://127.0.0.1:18117';
const TENANT = 't-home';
const WS = '/api/agent/web-shell/v1';
const SPEC = 'packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json';
const HEAD = JSON.parse(readFileSync(`/Users/wenshao/pr13117-rig/wt-head/${SPEC}`, 'utf8'));
const MAIN = JSON.parse(readFileSync(`/Users/wenshao/pr13117-rig/wt-main/${SPEC}`, 'utf8'));

function operations(spec) {
  const out = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      out.push({ path, method: method.toUpperCase(), id: op.operationId, status: op['x-qwen-implementation-status'], op });
    }
  }
  return out;
}
const covered = (p) => p.startsWith('/v1/agents/') || p.startsWith(WS + '/');

function validator(spec) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  ajv.addSchema({ $id: 'contract', components: spec.components });
  return (op, status, body) => {
    let resp = op.op.responses?.[String(status)];
    if (!resp) return { declared: false, valid: null, errors: 'status not declared' };
    if (resp.$ref) resp = spec.components.responses[resp.$ref.split('/').pop()];
    const media = resp.content?.['application/json'];
    if (!media) return { declared: true, valid: null, errors: 'no application/json schema', ref: op.op.responses[String(status)].$ref };
    const schema = JSON.parse(JSON.stringify(media.schema).replaceAll('"#/components/', '"contract#/components/'));
    const ok = ajv.validate(schema, body);
    return { declared: true, valid: ok, errors: ok ? '' : ajv.errorsText(ajv.errors), ref: op.op.responses[String(status)].$ref };
  };
}
const vHead = validator(HEAD);
const vMain = validator(MAIN);
const mainOps = new Map(operations(MAIN).map((o) => [o.id, o]));

async function call(method, path, { tenant = TENANT, actor, actorTenant, requestId, body, accept = 'application/json', extra = {} } = {}) {
  const headers = { accept, ...extra };
  if (tenant) headers['X-Qwen-Tenant-Id'] = tenant;
  if (actor) headers['X-Rig-Actor'] = actor;
  if (actorTenant) headers['X-Rig-Actor-Tenant'] = actorTenant;
  if (requestId) headers['X-Request-Id'] = requestId;
  const init = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(15000) });
  const ctype = res.headers.get('content-type') || '';
  let text = '';
  if (ctype.includes('text/event-stream')) {
    // Read only the first chunk of a stream the handler accepted.
    const reader = res.body.getReader();
    const { value } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({}), 1500))]);
    text = value ? Buffer.from(value).toString('utf8') : '';
    reader.cancel().catch(() => {});
  } else {
    text = await res.text();
  }
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ctype, reqIdHeader: res.headers.get('x-request-id'), cache: res.headers.get('cache-control'), text, json };
}

// --- real resources owned by tenant t-home / actor alice
const created = await call('POST', '/v1/agents/sessions', {
  actor: 'alice', requestId: `${label}-setup-create`, extra: { 'Idempotency-Key': `${label}-${Date.now()}` },
  body: { agent_id: 'default' },
});
const sessionId = created.json?.id;
const ws = await call('GET', '/v1/agents/workspaces', { actor: 'alice', requestId: `${label}-setup-ws` });
const workspaceId = ws.json?.data?.[0]?.id || ws.json?.workspaces?.[0]?.id || ws.json?.items?.[0]?.id;
const realIds = { sessionId, workspaceId };
writeFileSync(`${outDir}/setup.json`, JSON.stringify({ created, ws: { status: ws.status, json: ws.json }, realIds }, null, 2));

function concretePath(path, useReal) {
  return path.replace(/\{([^}]+)\}/g, (_, name) => (useReal && realIds[name]) || 'scope-probe');
}
function bodyFor(op, useReal) {
  if (op.method === 'GET' || op.method === 'DELETE') return undefined;
  if (op.path.startsWith(WS + '/')) return useReal && sessionId ? { sessionId } : {};
  return {};
}
const acceptFor = (op) => (op.op.responses?.['200']?.content?.['text/event-stream'] ? 'text/event-stream' : 'application/json');

const rows = [];
const all = operations(HEAD);
const longActor = 'x'.repeat(513);
for (const op of all) {
  const isCovered = covered(op.path);
  const row = { id: op.id, method: op.method, path: op.path, status: op.status, covered: isCovered, probes: {} };
  const kinds = [
    ['cross', { actor: 'mallory', actorTenant: 't-other' }, true],
    ['crossBogusId', { actor: 'mallory', actorTenant: 't-other' }, false],
    ['badActorId', { actor: longActor }, true],
  ];
  for (const [kind, who, useReal] of kinds) {
    const requestId = `${label}-${kind}-${op.id}`;
    const r = await call(op.method, concretePath(op.path, useReal), { ...who, requestId, body: bodyFor(op, useReal), accept: acceptFor(op) });
    const head = vHead(op, r.status, r.json);
    const mOp = mainOps.get(op.id);
    const main = mOp ? vMain(mOp, r.status, r.json) : { declared: false };
    row.probes[kind] = {
      http: r.status, ctype: r.ctype, code: r.json?.error?.code ?? null,
      requestIdEcho: r.reqIdHeader === requestId && r.json?.error?.request_id === requestId,
      bodyRequestId: r.json?.error?.request_id ?? null,
      cache: r.cache, headDeclared: head.declared, headValid: head.valid, headErrors: head.errors, headRef: head.ref,
      mainDeclared: main.declared, mainValid: main.valid ?? null,
      body: r.text.slice(0, 300),
    };
  }
  rows.push(row);
}
// Positive controls last: same tenant, valid actor. Mutating routes get a bogus id so the real Session stays intact.
const MUTATING = /^(DELETE|PATCH)$/;
for (const row of rows) {
  const op = all.find((o) => o.id === row.id);
  const mutating = MUTATING.test(op.method) || /close|archive|delete|cancel|respond|submit|unarchive|cwd|events$/.test(op.path) && op.method !== 'GET';
  const useReal = !mutating;
  const requestId = `${label}-same-${op.id}`;
  const r = await call(op.method, concretePath(op.path, useReal), { actor: 'alice', requestId, body: bodyFor(op, useReal), accept: acceptFor(op) });
  const head = vHead(op, r.status, r.json);
  row.probes.sameTenant = { http: r.status, ctype: r.ctype, code: r.json?.error?.code ?? null, realIds: useReal, headDeclared: head.declared, headValid: head.valid, body: r.text.slice(0, 200) };
}
writeFileSync(`${outDir}/results.json`, JSON.stringify({ label, realIds, headVersion: HEAD.info.version, mainVersion: MAIN.info.version, rows }, null, 2));

// --- summary
const cov = rows.filter((r) => r.covered);
const pass = (p) => p.http === 403 && p.code === 'actor_scope_mismatch' && p.requestIdEcho && p.headDeclared && p.headValid === true && p.ctype.startsWith('application/json');
const lines = [];
lines.push(`== ${label}: server contract head=${HEAD.info.version} main=${MAIN.info.version}; real sessionId=${sessionId} workspaceId=${workspaceId}`);
lines.push(`== covered operations: ${cov.length} (planned ${cov.filter((r) => r.status === 'planned').length}); outside the filter: ${rows.length - cov.length}`);
for (const kind of ['cross', 'crossBogusId', 'badActorId']) {
  const ok = cov.filter((r) => pass(r.probes[kind])).length;
  const undeclaredMain = cov.filter((r) => r.probes[kind].http === 403 && !r.probes[kind].mainDeclared).map((r) => r.id);
  lines.push(`${kind.padEnd(13)} 403+actor_scope_mismatch+request_id echo+declared+schema-valid in head: ${ok}/${cov.length}; returned 403 but undeclared in main: ${undeclaredMain.length}`);
}
lines.push('');
lines.push('op'.padEnd(26) + 'status'.padEnd(12) + 'cross  code                  main-decl head-decl head-valid | same-tenant');
for (const r of rows) {
  const p = r.probes.cross; const s = r.probes.sameTenant;
  lines.push(`${(r.covered ? '' : '(unfiltered) ') + r.id}`.padEnd(26).slice(0, 26) + (r.status || '').padEnd(12) + String(p.http).padEnd(7) + String(p.code).padEnd(22) + String(p.mainDeclared).padEnd(10) + String(p.headDeclared).padEnd(10) + String(p.headValid).padEnd(11) + '| ' + s.http + ' ' + (s.code || ''));
}
writeFileSync(`${outDir}/summary.txt`, lines.join('\n') + '\n');
console.log(lines.join('\n'));
