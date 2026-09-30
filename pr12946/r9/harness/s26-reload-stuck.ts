// S26 (round 8): after the old Harness is gone and its store writer lease
// (60 s) has expired, load each stuck Session in a new Harness and detach.
//   S26_TARGETS="W:sessionId:server[,server] ..."
import {
  Harness, leaseHeld, mcpProfile, result, setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const targets = (process.env['S26_TARGETS'] ?? '').split(/\s+/).filter(Boolean).map((t) => {
  const [w, sid, servers] = t.split(':');
  return { W: Number(w), sid: sid!, servers: servers!.split(',') };
});
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
setScript(() => ({ content: 'TEXT_ONLY_ANSWER' }));
const out: Record<string, unknown> = {};
const code = (r: { status: number; json: any }) => `${r.status}:${r.json?.code ?? ''}`;
try {
  for (const t of targets) {
    const r: Record<string, unknown> = { leaseBefore: await leaseHeld(t.W) };
    const l = await h.open(t.sid, `workspace-${t.W}`, mcpProfile(t.W, t.servers.map((s) => [s])), 'load');
    r['load'] = code(l);
    if (l.status === 200) {
      r['status'] = (await h.call(t.sid, `/session/${t.sid}/status`)).json;
      const p = await h.prompt(t.sid, 'TEXT_RELOAD', { wait: false });
      r['prompt'] = code(p.admit);
      if (p.admit.status === 202) await new Promise((res) => setTimeout(res, 3000));
      r['detach'] = code(await h.call(t.sid, `/session/${t.sid}/detach`, {}));
    }
    r['leaseAfter'] = await leaseHeld(t.W);
    out[`ws${t.W}`] = r;
  }
} finally {
  result('s26', out);
  await h.close();
  await model.close();
  await proxy.close();
}
