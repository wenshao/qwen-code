// Real-server probe: the same request sequence against the base jar (18999)
// and the head jar (18998), each on its own MySQL 8.4 schema. Every response
// body is validated with Ajv against the response schema that the base and
// the head contract each declare for that route and status.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/12fa9b24-1d30-4fad-b831-ba32169a2e71/scratchpad';
const require = createRequire(`${SP}/wt-pr/package.json`);
const Ajv2020 = require('ajv/dist/2020').default;
const SPEC = 'packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json';
const specs = {
  base: JSON.parse(await readFile(`${SP}/wt-base/${SPEC}`, 'utf8')),
  head: JSON.parse(await readFile(`${SP}/wt-pr/${SPEC}`, 'utf8')),
};
const ajvs = {};
for (const [k, s] of Object.entries(specs)) {
  ajvs[k] = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  ajvs[k].addSchema({ ...s, $id: 'spec' });
}
const TENANT = 'pr12998';
const RUN = Date.now().toString(36);
const H = (extra = {}) => ({ 'Content-Type': 'application/json', 'X-Qwen-Tenant-Id': TENANT, ...extra });

// Prefer the template with the most literal characters, so /v1/agents/sessions
// is not matched by a planned /v1/agents/{agentId}.
function matchPath(spec, method, url) {
  const path = url.split('?')[0];
  const hits = [];
  for (const [tpl, item] of Object.entries(spec.paths)) {
    const re = new RegExp('^' + tpl.replace(/\{[^}]+\}/g, '[^/]+') + '$');
    const op = item[method.toLowerCase()];
    if (re.test(path) && op) hits.push({ tpl, op, literal: tpl.replace(/\{[^}]+\}/g, '').length });
  }
  hits.sort((a, b) => b.literal - a.literal);
  return hits[0] ?? null;
}
function responseRef(spec, op, status) {
  let r = op.responses?.[status] ?? op.responses?.default;
  if (!r) return null;
  if (r.$ref) r = r.$ref.slice(2).split('/').reduce((n, s) => n[s], spec);
  const sch = r.content?.['application/json']?.schema;
  if (!sch) return null;
  return sch.$ref ? `spec${sch.$ref}` : null;
}
function validate(method, url, status, body) {
  const out = {};
  for (const k of ['base', 'head']) {
    const m = matchPath(specs[k], method, url);
    if (!m) { out[k] = 'no-route'; continue; }
    out[`${k}Route`] = m.tpl;
    out[`${k}Status`] = m.op['x-qwen-implementation-status'] ?? 'served';
    const ref = responseRef(specs[k], m.op, String(status));
    if (!ref) { out[k] = `undeclared-${status}`; continue; }
    const v = ajvs[k].getSchema(ref);
    out[k] = v(body) ? `valid ${ref.split('/').pop()}` : `INVALID ${ref.split('/').pop()}: ${JSON.stringify(v.errors.slice(0, 2))}`;
  }
  return out;
}

async function call(port, method, url, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: H(headers), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

// Normalize identities and timestamps. A replayed operation returns its latest
// durable state, which depends on the background worker's timing, so its
// status fields are normalized too.
const VOLATILE = ['created_at', 'updated_at', 'createdAt', 'updatedAt', 'request_id', 'requestId', 'last_event_id', 'lastEventId'];
function norm(v) {
  const walk = (x, replayed) => {
    if (Array.isArray(x)) return x.map((e) => walk(e, false));
    if (x && typeof x === 'object') {
      const out = {};
      for (const k of Object.keys(x).sort()) {
        let val = x[k];
        if (VOLATILE.includes(k)) val = '<v>';
        else if (['id', 'operationId', 'receipt_id', 'receiptId', 'sessionId', 'session_id'].includes(k) && typeof val === 'string') val = '<id>';
        else if (x.replayed === true && ['status', 'delivery_state', 'deliveryState'].includes(k)) val = '<latest-state>';
        else val = walk(val, false);
        out[k] = val;
      }
      return out;
    }
    if (typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(x)) return '<uuid>';
    return x;
  };
  return walk(v, false);
}

async function waitOp(port, reader) {
  let op;
  for (let i = 0; i < 40; i++) {
    op = await reader();
    if (op.body.status === 'completed' || op.body.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return op;
}

async function scenario(arm, port) {
  const rows = [];
  const rec = async (label, method, url, body, headers) => {
    const r = await call(port, method, url, body, headers);
    rows.push({ label, method, url: url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{sid}'), status: r.status, code: r.body?.error?.code ?? null, check: validate(method, url, r.status, r.body), body: r.body });
    return r;
  };
  const task = `task_${'0'.repeat(64)}`;
  const s = await rec('create session', 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code' }, { 'Idempotency-Key': `create-${arm}-${RUN}` });
  const sid = s.body.id;
  const base = `/v1/agents/sessions/${sid}`;
  await rec('get session', 'GET', base);
  await rec('list tasks', 'GET', `${base}/tasks`);
  await rec('get unknown task', 'GET', `${base}/tasks/${task}`);
  await rec('task events', 'GET', `${base}/tasks/${task}/events`);
  await rec('task events ?after', 'GET', `${base}/tasks/${task}/events?after=cursor-1`);
  await rec('task cancel', 'POST', `${base}/tasks/${task}/cancel`, {}, { 'Idempotency-Key': 'tc-1' });
  await rec('WebShell tasks/query', 'POST', '/api/agent/web-shell/v1/tasks/query', { sessionId: sid });
  await rec('WebShell tasks/events/query', 'POST', '/api/agent/web-shell/v1/tasks/events/query', { sessionId: sid, taskId: task });
  await rec('WebShell tasks/cancel', 'POST', '/api/agent/web-shell/v1/tasks/cancel', { sessionId: sid, taskId: task, idempotencyKey: 'tc-2' });
  const close = await rec('close', 'POST', `${base}/close`, null, { 'Idempotency-Key': 'close-1' });
  const opId = close.body.id;
  await rec('close replay, same key', 'POST', `${base}/close`, null, { 'Idempotency-Key': 'close-1' });
  await waitOp(port, () => call(port, 'GET', `${base}/operations/${opId}`));
  await rec('read close operation', 'GET', `${base}/operations/${opId}`);
  await rec('WebShell operations/query (close)', 'POST', '/api/agent/web-shell/v1/operations/query', { sessionId: sid, operationId: opId });
  const arch = await rec('archive', 'POST', `${base}/archive`, null, { 'Idempotency-Key': 'archive-1' });
  await waitOp(port, () => call(port, 'GET', `${base}/operations/${arch.body.id}`));
  await rec('read archive operation', 'GET', `${base}/operations/${arch.body.id}`);
  const s2 = await rec('WebShell sessions/create', 'POST', '/api/agent/web-shell/v1/sessions/create', { idempotencyKey: `wcreate-${arm}-${RUN}`, agentId: 'qwen-code' });
  const sid2 = s2.body.sessionId ?? s2.body.id;
  const del = await rec('WebShell sessions/delete', 'POST', '/api/agent/web-shell/v1/sessions/delete', { sessionId: sid2, idempotencyKey: 'wdel-1' });
  await waitOp(port, () => call(port, 'POST', '/api/agent/web-shell/v1/operations/query', { sessionId: sid2, operationId: del.body.operationId }));
  await rec('WebShell operations/query (delete)', 'POST', '/api/agent/web-shell/v1/operations/query', { sessionId: sid2, operationId: del.body.operationId });
  return rows;
}

const result = { head: await scenario('head', 18998), base: await scenario('base', 18999) };
let same = 0, differ = 0, invalid = 0, total = 0;
const table = [];
for (let i = 0; i < result.head.length; i++) {
  const h = result.head[i], b = result.base[i];
  const eq = JSON.stringify(norm(h.body)) === JSON.stringify(norm(b.body)) && h.status === b.status;
  eq ? same++ : differ++;
  for (const r of [h, b]) for (const k of ['base', 'head']) { total++; if (String(r.check[k]).startsWith('INVALID')) invalid++; }
  table.push({ label: h.label, route: h.check.headRoute, marker: h.check.headStatus, head: `${h.status} ${h.code ?? ''}`.trim(), base: `${b.status} ${b.code ?? ''}`.trim(), same: eq, headJarVsBaseSpec: h.check.base, headJarVsHeadSpec: h.check.head, baseJarVsHeadSpec: b.check.head });
  console.log(`${h.label.padEnd(34)} ${String(h.check.headStatus).padEnd(11)} head ${`${h.status} ${h.code ?? ''}`.padEnd(20)} base ${`${b.status} ${b.code ?? ''}`.padEnd(20)} ${eq ? 'same' : 'DIFF'}  specs(base/head): ${h.check.base} / ${h.check.head}`);
}
console.log(`\nrequests per arm: ${result.head.length}; identical status + normalized body: ${same}; differing: ${differ}; schema checks: ${total}, invalid: ${invalid}`);
await writeFile(`${SP}/pr12998/rig/live-probe.json`, JSON.stringify({ table, result }, null, 2));
