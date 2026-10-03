// VERIFICATION RIG ONLY: create one bound Session on ws-a and wait for its initial Turn; prints the id.
import fs from 'node:fs';
import { ensureWorkspace, createSession, waitTurn } from './lib.mjs';
ensureWorkspace('ws-a', 'st-a');
const c = await createSession('public', 'ws-a', 'PLAIN');
const t = await waitTurn(c.session);
console.log(`session ${c.status} ${c.session} turn ${t.status}`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, c.session);
