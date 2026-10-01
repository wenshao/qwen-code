// S18x (c5a4cd2853 "also runs on load for previously cancelled records"): load Sessions that EARLIER builds left
// stranded in this database with the new Harness. EXPECT=recover|blocked per Session.
import { Report, Harness, HSession, startModel, storeConnection, script, turn, toolTrace } from './lib.mjs';
if (!process.env.DB || !process.env.SESSIONS) throw new Error('DB and SESSIONS (id:workspace:expect,...) are required');
const arm = process.env.ARM ?? 'head';
const R = new Report(`s18x-load-recovery-${arm}`);
const model = await startModel();
const h = await new Harness({ name: `s18x-${arm}`, modelUrl: model.url, arm }).start();
try {
  for (const spec of process.env.SESSIONS.split(',')) {
    const [id, ws, expect, label] = spec.split(':');
    const s = new HSession(h, id, storeConnection(h, ws));
    const l = await s.load();
    const tr = l.status === 200 ? toolTrace(await s.transcript().catch(() => [])) : [];
    const calls = tr.filter((x) => x.startsWith('call ')).length;
    const results = tr.filter((x) => x.startsWith('result '));
    const p = await s.prompt(script([], `X-${ws}`), 60_000);
    const recovered = l.status === 200 && !l.json?.recoveryRequired && p.terminal?.[0]?.type === 'turn_complete';
    const ok = expect === 'recover' ? recovered && results.length === calls : !recovered;
    R.check(`${label ?? ws} (${expect === 'recover' ? 'expected to recover' : 'expected to stay blocked'})`, ok,
      `load=${l.status}${l.json?.recoveryRequired ? ' recoveryRequired' : ''}${l.json?.code ? ` ${l.json.code}` : ''} durable calls/results=${calls}/${results.length} [${results.map((x) => x.slice(0, 80)).join(' | ')}] next=${turn(p)}`);
    await s.detach();
  }
} finally {
  await h.close();
  await model.close();
  R.done();
}
