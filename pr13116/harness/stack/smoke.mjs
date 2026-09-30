// VERIFICATION RIG ONLY: happy path on the real stack (one Workspace-file Turn).
import fs from 'node:fs';
import { R, register, create, waitTurn, turnRow, sql } from './lib.mjs';
const tag = process.argv[2] ?? 's';
register(`ws-smoke-${tag}`, 'st-l');
fs.rmSync(`${R}/roots/l/child/smoke.txt`, { force: true });
const c = await create(`ws-smoke-${tag}`, 'G0_FILES name=smoke.txt', `smoke-${tag}`);
console.log('create', c.status, c.json.id, c.json.error?.code ?? '');
const w = await waitTurn(c.json.id, { timeoutMs: 120_000 });
console.log('turn', JSON.stringify(turnRow(c.json.id)), 'ms', w.ms, 'file', fs.existsSync(`${R}/roots/l/child/smoke.txt`) && fs.readFileSync(`${R}/roots/l/child/smoke.txt`, 'utf8'));
