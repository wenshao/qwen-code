// VERIFICATION RIG ONLY (PR #13773): private deployment Hook manifest with one catalog per scenario shape, on every rig Workspace.
// usage: DB=.. node manifest.mjs -> writes $RIG/run/<db>/hooks.json + pins.json (catalogId -> pin)
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const RIG = '/Users/wenshao/pr13773-rig'; const DB = process.env.DB;
const LOGD = `${RIG}/run/${DB}`; fs.mkdirSync(`${LOGD}/hookctl`, { recursive: true });
const cmd = (hookId, eventName, extra = {}) => ({ hookId, eventName, sequential: false, onceKey: null, failClosed: false, async: false,
  config: { type: 'command', command: `${RIG}/probe/hookcmd.sh ${LOGD}/hooks-rec.jsonl ${LOGD}/hookctl`, timeout: 600000, shell: 'bash' }, ...extra });
const shapes = {
  'cat-ptu': [cmd('ptu', 'PostToolUse')],
  'cat-ptb': [cmd('ptb', 'PostToolBatch')],
  'cat-ptuf': [cmd('ptuf', 'PostToolUseFailure')],
  'cat-stop': [cmd('stop', 'Stop')],
  'cat-once': [cmd('once', 'PostToolUse', { onceKey: 'result-once' })],
  'cat-off': [cmd('off', 'PostToolUse', { enabled: false })],
};
const workspaces = 'abcdefghijklmno'.split('').map((c) => `ws-${c}`);
const pins = {}; const catalogs = [];
for (const [catalogId, hooks] of Object.entries(shapes)) {
  const definitionDigest = createHash('sha256').update(JSON.stringify(hooks)).digest('hex');
  pins[catalogId] = { catalogId, catalogRevision: 1, definitionDigest };
  for (const workspaceId of workspaces) catalogs.push({ tenantId: 't-rig', workspaceId, catalogId, catalogRevision: 1, definitionDigest, hooks });
}
fs.writeFileSync(`${LOGD}/hooks.json`, JSON.stringify({ version: 1, catalogs }, null, 1));
fs.writeFileSync(`${LOGD}/pins.json`, JSON.stringify(pins, null, 1));
console.log(Object.keys(pins).join(','));
