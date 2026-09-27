// Real model (qwen3.8-max via DashScope) on the real stack.
// Part 1: two Workspaces, Write/Read/Edit, detach + reload, history follow-up.
// Part 2: two threads of ONE Workspace prompted at the same time.
import fs from 'node:fs';
import * as L from './lib.mjs';

const DB = 'rig1';
const MODEL = process.env.REAL_MODEL ?? 'qwen3.8-max';
const ARM = process.env.ARM ?? 'pr';
const [W1, W2, W3] = (process.argv[2] ?? 'b,h,g').split(',');
L.openLog(`s6-real-model-${ARM}-${W3}`);
const proxy = await L.startBrokerProxy('http://127.0.0.1:19831');
const h = await new L.Harness({ name: `real-${ARM}`, brokerUrl: proxy.url, realModel: MODEL }).start();
fs.writeFileSync(`${h.root}/todo.md`, 'DECOY in the Harness launch directory');
L.say('setup', `arm=${ARM} model=${MODEL} harness=${h.baseUrl} decoy=${h.root}/todo.md`);
async function session(st) {
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const s = new L.HSession(h, await L.createWorkspaceSession(18831, ws), L.storeConnection(h, ws, 18831));
  const c = await s.create();
  if (c.status !== 200) throw new Error(`create ${c.status}`);
  return s;
}
const show = (tag, r) => {
  L.say(tag, L.summarizeTurn(r));
  for (const t of L.toolTrace(r.events ?? [])) L.say(`${tag} tool`, t);
  L.say(`${tag} text`, L.assistantText(r.events ?? []).replace(/\s+/g, ' ').slice(0, 220));
};
try {
  if (!process.env.ONLY_CONCURRENT) {
    const A = await session(W1);
    const B = await session(W2);
    const [ra, rb] = await Promise.all([
      A.prompt('Use your file tools. Create todo.md with three bullet items: build, test, tag. Read it back, then use the edit tool to change "tag" to "tag v1.0". Reply with the final file.'),
      B.prompt('Use your file tools. Create notes.txt containing the single line "workspace B". Then read it back and reply with its content.'),
    ]);
    show('A1', ra);
    show('B1', rb);
    L.say('fs', `roots/${W1}/child/todo.md=${JSON.stringify(fs.readFileSync(`${L.RIG}/roots/${W1}/child/todo.md`, 'utf8'))}`);
    L.say('fs', `roots/${W2}/child/notes.txt=${JSON.stringify(fs.readFileSync(`${L.RIG}/roots/${W2}/child/notes.txt`, 'utf8'))}`);
    L.say('fs', `decoy=${JSON.stringify(fs.readFileSync(`${h.root}/todo.md`, 'utf8'))}`);
    L.say('A detach', (await A.detach()).status);
    L.say('A reload (no profile)', (await A.load({})).status);
    L.say('A reload (profile)', (await A.load()).status);
    const a2 = await A.prompt('Without using any tools: what is the exact third bullet of the file you edited earlier?');
    show('A2', a2);
  }
  // Part 2: two threads in one Workspace.
  const C = await session(W3);
  const D = await session(W3);
  const t0 = Date.now();
  const [rc, rd] = await Promise.all([
    C.prompt('Use your file tools. Create c.txt containing "from thread C", read it back, and reply with its content.'),
    D.prompt('Use your file tools. Create d.txt containing "from thread D", read it back, and reply with its content.'),
  ]);
  show('C', rc);
  show('D', rd);
  for (const l of L.ledgerSince(proxy.ledger, t0).filter((x) => /acquire|release/.test(x))) L.say('C/D broker', l);
  for (const [n, s, r] of [['C', C, rc], ['D', D, rd]]) {
    const st = await s.status();
    if (st.recoveryBlocked) {
      const again = await s.submit('Are you there?');
      L.say(`${n} after the other finished`, `new prompt -> ${again.status} ${JSON.stringify(again.json)}`);
    } else if (r.terminal?.[0]?.type === 'turn_error') {
      const again = await s.prompt('The previous attempt failed because the Workspace was busy. Please retry the same request now.');
      show(`${n} retry`, again);
    }
  }
  L.say('fs', `c.txt=${fs.existsSync(`${L.RIG}/roots/${W3}/child/c.txt`)} d.txt=${fs.existsSync(`${L.RIG}/roots/${W3}/child/d.txt`)}`);
  L.say('log', h.log().split('\n').filter((l) => /recovery blocked|failed:/.test(l)).map((l) => l.replace(/^.*qwen serve: /, '')).join(' || ') || '<none>');
} finally {
  await h.stop();
  await proxy.close();
}
