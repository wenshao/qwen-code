// Real model (qwen3.8-max via DashScope) on the real stack with the Shell profile.
// R1 basic Shell + decoy, R2 large failing build output, R3 >30 s command.
import fs from 'node:fs';
import * as L from './lib.mjs';

const DB = process.env.DB ?? 'p848a';
const HTTP = Number(process.env.HTTP ?? 18848);
const MODEL = process.env.REAL_MODEL ?? 'qwen3.8-max';
const ARM = process.env.ARM ?? 'pr';
const ROOTS = process.env.ROOTS ?? 'roots1';
const ONLY = (process.env.ONLY ?? 'R1,R2,R3').split(',');
const TAG = process.env.TAG ?? '';
const [W1, W2, W3] = (process.argv[2] ?? 'g,h,i').split(',');
const SHELL = { toolProfile: 'hosted-workspace-shell/1' };
L.openLog(`s2-real-model-${ARM}-${W1}${W2}${W3}${TAG}`);
const proxy = await L.startBrokerProxy(process.env.BROKER ?? 'http://127.0.0.1:19848');
const h = await new L.Harness({ name: `real-${ARM}-${W1}`, brokerUrl: proxy.url, realModel: MODEL }).start();
fs.writeFileSync(`${h.root}/marker.txt`, 'DECOY in the Harness launch directory\n');
L.say('setup', `arm=${ARM} model=${MODEL} harness=${h.baseUrl}`);
const dir = (st) => `${L.RIG}/${ROOTS}/${st}/child`;
async function session(st) {
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  const c = await s.create(SHELL);
  if (c.status !== 200) throw new Error(`create ${c.status} ${JSON.stringify(c.json)}`);
  return s;
}
function toolResults(events) {
  const out = [];
  for (const e of events) for (const p of e.data?.record?.message?.parts ?? []) if (p.functionResponse) out.push(p.functionResponse);
  return out;
}
const show = (tag, r) => {
  L.say(tag, L.summarizeTurn(r));
  for (const t of L.toolTrace(r.events ?? [])) L.say(`${tag} tool`, t);
  L.say(`${tag} text`, L.assistantText(r.events ?? []).replace(/\s+/g, ' ').slice(0, 400));
};
try {
  if (ONLY.includes('R1')) {
    fs.writeFileSync(`${dir(W1)}/marker.txt`, 'WORKSPACE marker for ws-' + W1 + '\n');
    const A = await session(W1);
    const t0 = Date.now();
    const r = await A.prompt('Use the shell tool once to run exactly: pwd && cat marker.txt && echo created-by-shell > from-shell.txt && ls. Then tell me the working directory and what marker.txt contains.');
    show('R1', r);
    L.say('R1 ledger', L.ledgerSince(proxy.ledger, t0));
    L.say('R1 fs', `workspace from-shell.txt=${JSON.stringify(fs.existsSync(`${dir(W1)}/from-shell.txt`) ? fs.readFileSync(`${dir(W1)}/from-shell.txt`, 'utf8') : null)} harness-root from-shell.txt exists=${fs.existsSync(`${h.root}/from-shell.txt`)}`);
    for (const fr of toolResults(r.events)) L.say('R1 model-facing', JSON.stringify(fr.response).slice(0, 600));
    const r2 = await A.prompt('What file did you create in the previous turn, and what does it contain? Answer from the conversation; do not run tools.');
    show('R1b', r2);
  }
  if (ONLY.includes('R2')) {
    const lines = [];
    fs.writeFileSync(`${dir(W2)}/build.sh`, [
      '#!/bin/sh',
      'echo run >> runs.log',
      'i=1',
      'while [ $i -le 600 ]; do echo "compiling module $i ... ok (cache warm, 0 warnings)"; i=$((i+1)); done',
      'echo "ERROR: undefined symbol foo_bar referenced from module 417" >&2',
      'echo "BUILD FAILED after 600 modules"',
      'exit 3',
      '',
    ].join('\n'));
    const B = await session(W2);
    const t0 = Date.now();
    const r = await B.prompt('Run `sh build.sh` in the workspace with the shell tool. Then tell me the exact ERROR line it printed and the exit code.');
    show('R2', r);
    L.say('R2 ledger', L.ledgerSince(proxy.ledger, t0));
    for (const fr of toolResults(r.events)) {
      const text = JSON.stringify(fr.response);
      L.say('R2 model-facing', `bytes=${Buffer.byteLength(text)} hasERROR=${text.includes('ERROR: undefined symbol')} hasExit3=${/Exit Code: 3/.test(text)} hasFAILED=${text.includes('BUILD FAILED')} head=${text.slice(0, 260)}`);
      L.say('R2 model-facing tail', text.slice(-300));
    }
    L.say('R2 fs', `runs.log lines=${fs.existsSync(`${dir(W2)}/runs.log`) ? fs.readFileSync(`${dir(W2)}/runs.log`, 'utf8').trim().split('\n').length : 0}`);
  }
  if (ONLY.includes('R4')) {
    const D = await session(W3);
    const t0 = Date.now();
    const r = await D.prompt('Wait 40 seconds, then append the line done to slow.txt in the workspace, and tell me when it is finished.', 400000);
    show('R4', r);
    L.say('R4 ledger', L.ledgerSince(proxy.ledger, t0).map((l) => l.replace(/[0-9a-f-]{36}/g, '<id>')).filter((l, i, a) => a.indexOf(l) === i));
    L.say('R4 fs', `slow.txt=${JSON.stringify(fs.existsSync(`${dir(W3)}/slow.txt`) ? fs.readFileSync(`${dir(W3)}/slow.txt`, 'utf8') : null)}`);
    L.say('R4 harness', h.log().split('\n').filter((l) => /failed:/.test(l)).slice(-2));
  }
  if (ONLY.includes('R3')) {
    const C = await session(W3);
    const t0 = Date.now();
    const r = await C.prompt('Use the shell tool to run exactly this command with timeout 120000: sleep 45 && echo slept-45 >> slow.txt && echo done-after-45. Report its output.', 400000);
    show('R3', r);
    const ledger = L.ledgerSince(proxy.ledger, t0);
    const counts = {};
    for (const l of ledger) counts[l] = (counts[l] ?? 0) + 1;
    L.say('R3 ledger (deduped)', Object.entries(counts).map(([k, v]) => `${v}x ${k}`));
    L.say('R3 fs', `slow.txt=${JSON.stringify(fs.existsSync(`${dir(W3)}/slow.txt`) ? fs.readFileSync(`${dir(W3)}/slow.txt`, 'utf8') : null)}`);
  }
} catch (e) {
  L.say('ERROR', String(e?.stack ?? e));
} finally {
  L.say('executions', L.sql(DB, "SELECT execution_state, IFNULL(execution_status,'-'), COUNT(*) FROM qwen_tool_execution GROUP BY 1,2"));
  L.say('harness log tail', h.log().split('\n').filter((l) => /error|Error|fail|blocked/i.test(l)).slice(-8));
  await h.stop();
  await proxy.close();
}
