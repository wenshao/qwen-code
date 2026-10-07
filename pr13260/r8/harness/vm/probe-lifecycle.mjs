import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
const [sid, kind] = process.argv.slice(2);
const route = kind === 'delete' ? `/v1/agents/sessions/${sid}` : `/v1/agents/sessions/${sid}/${kind}`;
const r = await L.api(kind === 'delete' ? 'DELETE' : 'POST', route, kind === 'delete' ? undefined : {}, { key: randomUUID() });
console.log(kind, r.status, JSON.stringify(r.json).slice(0, 400));
