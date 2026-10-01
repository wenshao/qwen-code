// S21 (433f9d358e merge adds a per-call guard in hosted-workspace-tool-turn.ts): one write_file call whose id is so
// long that the assistant record still fits the 64 KiB inline limit but that call's own cancellation response does not.
// A refused PreToolUse + operator cancel would then need a refusal record that can never be stored.
// LEN=<n> picks the id length; WS=<workspace>. Records decoded sizes of the assistant commit and any refusal write.
import { startStoreProxy, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, turn, pin, hookRecords, setControl, j } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
if (!process.env.DB || !process.env.LEN || !process.env.WS) throw new Error('DB, LEN and WS are required');
const arm = process.env.ARM ?? 'head';
const LEN = Number(process.env.LEN);
const WS = process.env.WS;
const R = new Report(`s21-bigid-guard-${arm}-${WS}-${LEN}`);
setControl({});
const model = await startModel();
const proxy = await startStoreProxy();
const seen = [];
proxy.state.hook = async (entry, parsed, body) => {
  let decoded = 0;
  let hay = '';
  for (const m of body.toString().matchAll(/"bytesBase64"\s*:\s*"([A-Za-z0-9+/=]+)"/g)) {
    const b = Buffer.from(m[1], 'base64');
    decoded = Math.max(decoded, b.length);
    hay += b.toString();
  }
  if (hay.includes('ixxxxxxxxxx')) seen.push({ kind: hay.includes('cancelled before this tool call ran') ? 'refusal' : hay.includes('"functionCall"') ? 'assistant' : 'other', decoded, entry });
  return 'forward';
};
const h = await new Harness({ name: `s21-${arm}-${LEN}`, modelUrl: model.url, arm }).start();
try {
  const w = await workspace(STORAGE[WS], WS);
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId, proxy.url));
  await s.create({ hookCatalog: pin(WS) });
  const p1 = await s.prompt(`BIGID:${LEN}:END`, 60_000);
  const rec = hookRecords(id, 'hook_execution').find((r) => r.rec.hookId === 'bf-pre')?.rec;
  const fail = [...(await import('node:fs')).readFileSync(h.logPath, 'utf8').matchAll(/turn \S+ failed: (.*)/g)].map((m) => m[1]).join(' | ');
  const c = rec ? await s.hookStatus(rec.hookExecutionId, true) : { status: '-' };
  const next = await s.prompt(script([], `BIGID-NEXT-${LEN}`), 60_000);
  const d = await s.detach();
  const l = d.status === 204 ? await s.load() : { status: '-' };
  const again = l.status === 200 ? await s.prompt(script([], `BIGID-AGAIN-${LEN}`), 60_000) : { status: '-' };
  R.note(`id length ${LEN}`, `first turn=${turn(p1)} harness error=${fail || '-'} PreToolUse record=${rec ? `${rec.run.state}/${j(rec.run.execution)}` : 'none (no Hook ran)'} cancel=${c.status} ${c.json?.state ?? c.json?.code ?? ''} | store writes with the id: ${seen.map((x) => `${x.kind} ${x.decoded}B ${x.entry.status}`).join(', ') || 'none'} | next=${turn(next)} detach=${d.status} load=${l.status}${l.json?.recoveryRequired ? ' recoveryRequired' : ''}${l.json?.code ? ` ${l.json.code}` : ''} again=${again.status === '-' ? '-' : turn(again)}`);
  if (l.status === 200) await s.detach();
} finally {
  await h.close();
  await model.close();
  await proxy.close();
  R.done();
}
