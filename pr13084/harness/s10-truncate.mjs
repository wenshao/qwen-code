// s10: capture budget 1 MiB, 3 MiB of stdout; does the public Turn finish? (head vs base, same Harness/worker bundle)
import fs from 'node:fs';
import * as L from './lib.mjs';
const ARM = process.env.ARM;
L.openLog(`s10-${ARM}`);
fs.writeFileSync(`${L.R}/run/tap-mode.json`, JSON.stringify({ shell: true, capture: 1024 * 1024 }));
const ws = `ws-trunc-${ARM}-${Date.now().toString(36)}`;
L.register(ws, process.env.ST ?? 'st-s36');
const sid = await L.createShellSession(ws, L.shellPrompt('truncate', L.genCmd('trunc', 3 * 1024 * 1024 + 9, 0, 0)));
await L.sleep(3000);
fs.writeFileSync(`${L.R}/run/tap-mode.json`, JSON.stringify({ shell: true, capture: 2 * 1024 * 1024 * 1024 }));
const turn = await L.waitTurn(sid, { timeoutMs: 120_000 });
const pub = L.sql(`SELECT producer_phase, capture_bytes FROM qwen_tool_publication WHERE session_id='${sid}'`);
const results = L.resultRows(sid).map((r) => r.state);
const steps = L.modelRequests().filter((m) => Date.parse(m.t) > Date.now() - 200_000 && /trunc/.test(m.lastToolResult ?? '') || false).length;
L.say('result', { arm: ARM, session: sid, turn: turn.status, timeout: !!turn.timeout, ms: turn.ms, pub, results, modelGotToolResult: steps > 0 });
