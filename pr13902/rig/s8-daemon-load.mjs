// S8: does a daemon client's POST /session/:id/load on a LIVE session reach
// the ACP child's withLiveSessionRestore (beginClose + drain)? If it did, the
// call would block until the in-flight turn drains.
// usage: node s8-daemon-load.mjs <runDir> <port>
import fs from 'node:fs';
import path from 'node:path';
import { runCtx, Sess, sleep, check } from './lib.mjs';

const [runDir, port] = process.argv.slice(2);
const ctx = runCtx(runDir, Number(port));
const results = []; const v = {};
const A = new Sess(ctx, 'leader');
await A.create();
await A.mode('yolo');
await A.prompt('[[LEAD:slow:S8:12]] Think for a while.');
await sleep(1500);
v.statusBefore = (({ hasActivePrompt, activeWorkState }) => ({ hasActivePrompt, activeWorkState }))(await A.status());
const t0 = ctx.ts();
const r = await ctx.j('POST', `/session/${A.id}/load`, { cwd: ctx.ws });
v.load = { status: r.status, tookS: +(ctx.ts() - t0).toFixed(3), attached: r.data?.attached };
v.statusAfter = (({ hasActivePrompt, activeWorkState }) => ({ hasActivePrompt, activeWorkState }))(await A.status());
await A.waitTurns(1, 30);
v.turnEndedAtS = A.turns[0]?.t; v.loadSentAtS = t0;
check(results, 'turn was in flight when load was sent', v.statusBefore.hasActivePrompt === true, v.statusBefore);
check(results, 'daemon load of a live session returns without waiting for the turn to drain', v.load.status === 200 && v.load.tookS < 2 && v.turnEndedAtS - v.loadSentAtS > 5, v.load);
console.log('V', JSON.stringify(v));
fs.writeFileSync(path.join(runDir, 's8-result.json'), JSON.stringify({ v, results, timeline: ctx.timeline }, null, 2));
console.log(`RESULT s8 pass=${results.filter((x) => x.ok).length} fail=${results.filter((x) => !x.ok).length}`);
A.close(); process.exit(0);
