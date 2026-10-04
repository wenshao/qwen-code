// Long-lived head/base stack for the Web Shell: Spring + Harness + an
// actor-injecting proxy for the Web Shell's Java routes + a control endpoint
// the Playwright script uses to toggle the resolve fault and read state.
import fs from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
export default async function (ctx) {
  ctx.springEnvExtra.QWEN_MANAGED_AGENT_APPROVAL_MODE = 'default';
  ctx.springEnvExtra.QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT = '1800s';
  await ctx.startSpring(ctx.FAST_RETRY);
  ctx.seedWorkspace();
  await ctx.startHarness();
  const proxy = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const headers = { ...req.headers, host: `127.0.0.1:${ctx.springPortValue}`, 'x-qwen-e2e-trusted-actor': 'e2e-actor', 'content-length': String(body.length) };
      delete headers['connection'];
      const up = httpRequest({ host: '127.0.0.1', port: ctx.springPortValue, method: req.method, path: req.url, headers }, (u) => { res.writeHead(u.statusCode ?? 502, u.headers); u.pipe(res); u.on('aborted', () => res.destroy()); });
      up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.on('close', () => { if (!res.writableFinished) up.destroy(); });
      up.end(body);
    });
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const S = (sid) => `tenant_id='retry-e2e' AND session_id=${ctx.q(sid)}`;
  const control = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let out = {};
    try {
      if (u.pathname === '/fault/add') ctx.harnessTap.addFault({ id: 'resolve503', method: 'POST', re: '/actions/.*/resolve$', status: 503 });
      else if (u.pathname === '/fault/clear') ctx.harnessTap.clearFault('resolve503');
      else if (u.pathname === '/session') out.id = await ctx.createSession(u.searchParams.get('prompt') ?? '[WRITE] write the probe file', { workspace: true });
      else if (u.pathname === '/state') {
        const sid = u.searchParams.get('sid');
        out = {
          op: ctx.sql(`SELECT state, delivery_state, attempt_count, IFNULL(error_code,'-'), admission_stage FROM ${ctx.db}.managed_agent_operation WHERE ${S(sid)} AND action_id IS NOT NULL`).replaceAll('\t', '|'),
          actions: (await ctx.api('GET', `/v1/agents/sessions/${sid}/actions`)).json?.data?.map((a) => a.state),
          turns: ctx.turnRows(sid).map((r) => `${r.status}|${r.code}`),
          resolves: ctx.harnessTap.count((o) => /\/resolve$/.test(o.url)),
        };
      } else if (u.pathname === '/done') { ctx.done = true; }
    } catch (e) { out.error = String(e); }
    ctx.mark('control', { path: u.pathname, out });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
  await new Promise((r) => control.listen(0, '127.0.0.1', r));
  fs.writeFileSync(`${ctx.runDir}/ui.json`, JSON.stringify({ proxy: proxy.address().port, control: control.address().port, spring: ctx.springPortValue }));
  ctx.mark('ui.ready', { proxy: proxy.address().port, control: control.address().port });
  const end = Date.now() + 40 * 60 * 1000;
  while (!ctx.done && Date.now() < end) await ctx.sleep(500);
  proxy.close(); control.close();
}
