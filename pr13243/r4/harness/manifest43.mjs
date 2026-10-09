// VERIFICATION RIG ONLY (PR #13243): deployment Hook manifest for the module-evaluation scenarios.
// usage: DB=<db> node manifest43.mjs -> writes run/<db>/hooks.json and run/<db>/catalogs.json
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { RUN, RIG, TENANT } from './lib.mjs';

const fn = (hookId, eventName, moduleName, timeout, o = {}) => ({
  hookId,
  eventName,
  ...(o.matcher ? { matcher: o.matcher } : {}),
  sequential: false,
  onceKey: null,
  failClosed: o.failClosed ?? false,
  async: false,
  config: { type: 'function', timeout },
  handler: { handlerId: `h43-${moduleName}`, handlerRevision: 1, modulePath: `${RIG}/probe/r43/${moduleName}.mjs`, exportName: 'registered' },
});
// workspace -> [moduleName, manifest timeout ms, storage letter]
export const R43 = {
  'ws-43-hang': ['hang', 2000, 'a'],
  'ws-43-gate1': ['gate1', 60_000, 'b'],
  'ws-43-floor': ['slow300', 10, 'c'],
  'ws-43-over': ['slow1500', 10, 'd'],
  'ws-43-govern': ['slow1500b', 3000, 'e'],
  'ws-43-broken': ['broken', 20_000, 'f'],
  'ws-43-gate2': ['gate2', 60_000, 'g'],
  'ws-43-gate3': ['gate3', 60_000, 'h'],
  'ws-43-gate4': ['gate4', 60_000, 'i'],
  'ws-43-gate5': ['gate5', 3000, 'j'],
  'ws-43-gate6': ['gate6', 60_000, 'k'],
  'ws-43-pre1': ['slowpre', 20_000, 'l', 'PreToolUse'],
  'ws-43-pre2': ['slowpre', 20_000, 'm', 'PreToolUse'],
};
export const STORAGE43 = Object.fromEntries(Object.entries(R43).map(([ws, [, , l]]) => [ws, l]));
// A plain Workspace without Hooks, for "does the Workspace still serve other Sessions" checks.
export const PLAIN_LETTER = { 'ws-43-hang': 'a', 'ws-43-gate1': 'b', 'ws-43-over': 'd', 'ws-43-gate2': 'g', 'ws-43-gate3': 'h' };

if (import.meta.url === `file://${process.argv[1]}`) {
  const catalogs = [];
  const pins = {};
  for (const [workspaceId, [moduleName, timeout, , event]] of Object.entries(R43)) {
    const ev = event ?? 'UserPromptSubmit';
    const hooks = [fn(`${ev === 'PreToolUse' ? 'pre' : 'ups'}-${moduleName}`, ev, moduleName, timeout, ev === 'PreToolUse' ? { matcher: 'write_file' } : {})];
    const definitionDigest = createHash('sha256').update(JSON.stringify(hooks)).digest('hex');
    const catalogId = `cat-${workspaceId.slice(3)}`;
    catalogs.push({ tenantId: TENANT, workspaceId, catalogId, catalogRevision: 1, definitionDigest, hooks });
    pins[`${workspaceId}#1`] = { catalogId, catalogRevision: 1, definitionDigest };
  }
  fs.mkdirSync(RUN, { recursive: true });
  fs.writeFileSync(`${RUN}/hooks.json`, JSON.stringify({ version: 1, catalogs }, null, 1));
  fs.writeFileSync(`${RUN}/catalogs.json`, JSON.stringify(pins, null, 1));
  console.log(`manifest43: ${catalogs.length} catalogs -> ${RUN}/hooks.json`);
}
