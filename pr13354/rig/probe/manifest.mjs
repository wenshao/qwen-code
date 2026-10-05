// VERIFICATION RIG ONLY (PR #13354): deployment Hook manifest for workspace ws-h: HTTP SessionEnd + SessionDelete -> hookrec.
// usage: DB=.. node manifest.mjs   -> writes $RIG/run/<db>/hooks.json, prints the pin
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const RIG = '/Users/wenshao/pr13354-rig'; const DB = process.env.DB;
const http = (hookId, eventName, path) => ({ hookId, eventName, sequential: false, onceKey: null, failClosed: false, async: false, config: { type: 'http', url: `http://127.0.0.1:19154${path}`, timeout: 8000 } });
const hooks = [http('end', 'SessionEnd', '/end'), http('del', 'SessionDelete', '/delete')];
const definitionDigest = createHash('sha256').update(JSON.stringify(hooks)).digest('hex');
const workspaces = (process.env.WSS ?? 'ws-h').split(',');
const catalogs = workspaces.map((workspaceId) => ({ tenantId: 't-rig', workspaceId, catalogId: 'cat-life', catalogRevision: 1, definitionDigest, hooks }));
fs.writeFileSync(`${RIG}/run/${DB}/hooks.json`, JSON.stringify({ version: 1, catalogs }, null, 1));
const pin = { catalogId: 'cat-life', catalogRevision: 1, definitionDigest };
fs.writeFileSync(`${RIG}/run/${DB}/hook-pin.json`, JSON.stringify(pin));
console.log(JSON.stringify(pin));
