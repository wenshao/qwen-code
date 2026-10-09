// VERIFICATION RIG ONLY (PR #13673): private deployment Hook manifest: COMMAND SessionEnd + SessionDelete -> hookcmd.sh.
// usage: DB=.. WSS=ws-a,ws-b node manifest.mjs   -> writes $RIG/run/<db>/hooks.json + hook-pin.json, prints the pin
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const RIG = '/Users/wenshao/pr13673-rig'; const DB = process.env.DB;
const LOGD = `${RIG}/run/${DB}`; fs.mkdirSync(`${LOGD}/hookctl`, { recursive: true });
const cmd = (hookId, eventName) => ({ hookId, eventName, sequential: false, onceKey: null, failClosed: false, async: false,
  config: { type: 'command', command: `${RIG}/probe/hookcmd.sh ${LOGD}/hooks-rec.jsonl ${LOGD}/hookctl`, timeout: 600000, shell: 'bash' } });
const hooks = [cmd('end', 'SessionEnd'), cmd('del', 'SessionDelete')];
const definitionDigest = createHash('sha256').update(JSON.stringify(hooks)).digest('hex');
const workspaces = (process.env.WSS ?? 'ws-a').split(',');
const catalogs = workspaces.map((workspaceId) => ({ tenantId: 't-rig', workspaceId, catalogId: 'cat-life', catalogRevision: 1, definitionDigest, hooks }));
fs.writeFileSync(`${LOGD}/hooks.json`, JSON.stringify({ version: 1, catalogs }, null, 1));
const pin = { catalogId: 'cat-life', catalogRevision: 1, definitionDigest };
fs.writeFileSync(`${LOGD}/hook-pin.json`, JSON.stringify(pin));
console.log(JSON.stringify(pin));
