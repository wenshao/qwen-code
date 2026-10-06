// Populate one shared storage (st-a: Workspaces ws-a1 + ws-a2) and one unrelated storage (st-b) through the deployed stack:
// public create -> packaged Hosted Harness -> embedded Broker -> durable local workers, with the scripted model.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';

const { say } = L;
export const term = (r) => r.terminal?.map((t) => `${t.type}${t.type === 'turn_error' ? ` ${JSON.stringify(t.data).slice(0, 140)}` : ''}`).join(',') || `<admit ${r.status} ${JSON.stringify(r.json ?? {}).slice(0, 140)}>`;

export async function lifecycle(sessionId, kind) {
  const route = kind === 'delete' ? `/v1/agents/sessions/${sessionId}` : `/v1/agents/sessions/${sessionId}/${kind}`;
  const r = await L.api(kind === 'delete' ? 'DELETE' : 'POST', route, undefined, { key: randomUUID() });
  const opId = r.json?.operation_id ?? r.json?.id ?? r.json?.operationId;
  let st = r.json?.state ?? r.json?.status;
  for (let i = 0; i < 100 && opId && !['completed', 'failed', 'COMPLETED', 'FAILED', 'succeeded'].includes(String(st)); i++) {
    await L.sleep(200);
    const g = await L.api('GET', `/v1/agents/sessions/${sessionId}/operations/${opId}`);
    st = g.json?.state ?? g.json?.status;
  }
  return `${kind}: ${r.status}${r.json?.error?.code ? ` ${r.json.error.code}` : ''} op=${String(opId).slice(0, 8)} state=${st}`;
}

// Register storages offline (the W1a rollout), then run the service with verified recovery on.
export async function rollout(storages = ['a', 'b']) {
  say('  ', L.svc('VERIFIED=false', 'start'));
  say('  ', L.svc('stop') || 'stopped (migrations applied)');
  const ops = {};
  for (const st of storages) { ops[st] = randomUUID(); L.sayMaint(`register-${st}`, L.maint(['register', L.TENANT, `st-${st}`, L.root(st), ops[st], '--offline-confirmed'])); }
  say('  ', L.svc('VERIFIED=true', 'start'));
  for (const st of storages) say(`   inspect ${st}:`, L.inspect(st).out);
  return ops;
}

export async function populate(rig, { o2 = true, extraShell = [] } = {}) {
  L.seedWs('ws-a1', 'a'); L.seedWs('ws-a2', 'a'); L.seedWs('ws-b1', 'b');
  const S = {};
  const open = async (name, ws, profile, extra, cwd = 'project') => {
    const s = new L.HSession(rig.h, await L.createSession(ws, cwd), ws);
    const c = await s.create(profile, extra);
    say(`   ${name} ${s.sessionId} (${ws}, ${profile ?? 'no profile'}${extra?.captureBytes ? `, captureBytes=${extra.captureBytes}` : ''}) create=${c.status}${c.status !== 200 ? ` ${JSON.stringify(c.json).slice(0, 160)}` : ''}`);
    S[name] = s; return s;
  };
  const run = async (name, text) => { const r = await S[name].prompt(text); say(`     ${name} ${text.slice(0, 48)}: ${term(r)}`); return r; };

  await open('F1', 'ws-a1', L.FILES);
  await run('F1', 'WRITE notes.txt v1'); await run('F1', 'WRITE notes.txt v2'); await run('F1', 'WRITE __proto__ proto-named'); await run('F1', 'READ notes.txt');
  await open('S1', 'ws-a1', L.SHELL);
  await run('S1', L.shell64('mkdir -p src bin && printf "export const a = 1;\\n" > src/a.ts && head -c 6291487 /dev/urandom > data.bin && ln -sf ../data.bin bin/data-link && printf "#!/bin/sh\\necho hi\\n" > bin/run.sh && chmod 755 bin/run.sh && echo made'));
  for (const cmd of extraShell) await run('S1', L.shell64(cmd));
  if (o2) {
    await open('O1', 'ws-a2', L.SHELL, { captureBytes: 16 * 1024 * 1024 }, 'project2');
    await run('O1', L.o2sh('head -c 3000000 /dev/zero | tr "\\0" x; echo'));
    const p = L.publications(S.O1.sessionId)[0];
    say(`     O1 publication: ${p ? `${p.phase} ${L.pubObjects(p.id).filter((x) => x.slot.startsWith('segment')).length} segments, seals ${L.pubSeals(p.id).map((s) => `${s.stream}=${s.segments}/${s.length}`).join(' ')}` : 'none'}`);
  }
  await open('F2', 'ws-a2', L.FILES, undefined, 'project2');
  await run('F2', 'WRITE other.txt x1'); await run('F2', 'WRITE other.txt x2');
  await open('F3', 'ws-a1', L.FILES);
  await run('F3', 'WRITE closed.txt c1');
  await open('S2', 'ws-a1', L.SHELL);
  await run('S2', L.shell64('echo deleted-session > del.txt && echo ok'));
  const U1 = await L.createSession('ws-a2', 'project2'); say(`   U1 ${U1} (ws-a2) public create only, never attached`);
  await open('B1', 'ws-b1', L.FILES);
  await run('B1', 'WRITE b.txt b1');
  for (const s of Object.values(S)) await s.detach();
  say('   lifecycle', await lifecycle(S.F2.sessionId, 'archive'), '|', await lifecycle(S.F3.sessionId, 'close'), '|', await lifecycle(S.S2.sessionId, 'delete'));
  return { S, U1 };
}

// Offline maintenance boundary: Harness stopped, service stopped, writer leases lapsed, storage fenced (W1a).
export async function offlineAndFence(rig, storage = 'a') {
  await rig.h.stop(); say('   Harness stopped');
  say('  ', L.svc('stop') || 'service stopped');
  say(`   writer leases lapsed after ${await W.waitLeasesExpired(storage)} ms`);
  const before = L.mountRow(storage);
  const fence = randomUUID();
  L.sayMaint(`fence-${storage}`, L.maint(['fence', L.TENANT, `st-${storage}`, L.root(storage), String(before.revision), fence, '--offline-confirmed']));
  say(`   ${L.mstr(L.mountRow(storage))}`);
  return { fence, revision: before.revision };
}

export function memberTable(storage = 'a') {
  for (const m of W.members(storage)) say(`     ${m.id} ${m.ws} ${m.status.padEnd(8)} head=${m.head} rev=${m.rev} seq=${m.seq} history=${fs.existsSync(`${W.historyRoot()}/${m.id}`) ? fs.readdirSync(`${W.historyRoot()}/${m.id}`).length + ' files' : '-'}`);
}
