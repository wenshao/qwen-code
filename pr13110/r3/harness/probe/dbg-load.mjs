// VERIFICATION RIG ONLY: load one Session with a debug bundle that prints the swallowed load error.
import { Harness, HSession, storeConnection, j } from './lib.mjs';
const [sessionId, workspaceId] = process.argv.slice(2);
const h = await new Harness({ name: 'dbg-load', arm: 'head4dbg' }).start();
const s = new HSession(h, sessionId, storeConnection(h, workspaceId));
const l = await s.load();
console.log('load', l.status, j(l.json));
console.log(h.log().split('\n').filter((x) => x.includes('RIGDEBUG') || /^\s+at /.test(x)).slice(0, 25).join('\n'));
await h.stop();
