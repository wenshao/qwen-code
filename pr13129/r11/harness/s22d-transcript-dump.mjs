// S22d: dump the Harness transcript events of one prompt for a Session with a given catalog (debug for S22 A).
import { Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, turn, pin, setControl } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
if (!process.env.DB || !process.env.WS) throw new Error('DB and WS are required');
const WS = process.env.WS;
setControl({});
const model = await startModel();
const h = await new Harness({ name: `s22d-${process.env.ARM}-${WS}`, modelUrl: model.url, arm: process.env.ARM ?? 'head' }).start();
try {
  const w = await workspace(STORAGE[WS], WS);
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s.create(WS === 'ws-dz0' ? undefined : { hookCatalog: pin(WS) });
  const p = await s.prompt(script([], 'DRAFT-ONE'), 60_000);
  console.log(`${WS} ${process.env.ARM} turn=${turn(p)}`);
  for (const e of (await s.transcript()).filter((x) => x.promptId === p.promptId))
    console.log(`  ${e.type} keys=${Object.keys(e.data ?? {}).join(',')} ${JSON.stringify(e.data).slice(0, 160)}`);
  await s.detach();
} finally {
  await h.close();
  await model.close();
}
