// Stage timing on the PR build: what commit() does in order — validate, then
// JSON.stringify(event) for the byte-limit check.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [label, wt, nArg] = process.argv.slice(2);
const { parseManagedSessionEvent } = await import(pathToFileURL(path.join(wt, 'packages/core/dist/src/managed-runtime/managed-session-records.js')).href);
const n = Number(nArg);
let s = { leaf: 1 }; for (let i = 0; i < n; i++) s = { a: s, b: s };
const ev = { v: 1, sequence: 2, eventId: 'evt-2', sessionKey: { tenantId: 't1', workspaceId: 'w1', sessionId: 's1' }, kind: 'cancel.requested', occurredAt: 1, payload: { requestId: 'r', target: s, reason: 'x', requestedBy: 'user' } };
let t = process.hrtime.bigint();
let v = 'ok'; try { parseManagedSessionEvent(ev); } catch (e) { v = e.message.slice(0, 80); }
const tv = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`STAGE\t${label}\tN=${n}\tvalidate=${tv.toFixed(1)}ms (${v})`);
t = process.hrtime.bigint();
let r; try { r = `len=${JSON.stringify(ev).length}`; } catch (e) { r = `${e.name}: ${e.message}`; }
console.log(`STAGE\t${label}\tN=${n}\tJSON.stringify=${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(0)}ms (${r})`);
