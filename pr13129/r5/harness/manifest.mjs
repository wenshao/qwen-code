// VERIFICATION RIG ONLY (PR #13129): deployment Hook manifest (QWEN_MANAGED_HOOK_CONFIG) for one rig DB.
// usage: DB=<db> node manifest.mjs   -> writes run/<db>/hooks.json and run/<db>/catalogs.json (pins by name)
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { RUN, RIG, TENANT } from './lib.mjs';

const HANDLERS = `${RIG}/probe/handlers.mjs`;
export const HTTP_PORT = 19129;
const fn = (hookId, eventName, exportName, o = {}) => ({
  hookId,
  eventName,
  ...(o.matcher ? { matcher: o.matcher } : {}),
  sequential: o.sequential ?? false,
  onceKey: o.onceKey ?? null,
  failClosed: o.failClosed ?? false,
  async: false,
  config: { type: 'function', timeout: o.timeout ?? 20_000 },
  handler: { handlerId: o.handlerId ?? `h-${hookId}`, handlerRevision: o.handlerRevision ?? 1, modulePath: HANDLERS, exportName },
});
const http = (hookId, eventName, path, o = {}) => ({
  hookId,
  eventName,
  ...(o.matcher ? { matcher: o.matcher } : {}),
  sequential: false,
  onceKey: o.onceKey ?? null,
  failClosed: o.failClosed ?? false,
  async: false,
  config: { type: 'http', url: `http://127.0.0.1:${HTTP_PORT}${path}`, timeout: o.timeout ?? 8_000, ...(o.headers ? { headers: o.headers } : {}) },
});
const cmd = (hookId, eventName, command, o = {}) => ({
  hookId,
  eventName,
  ...(o.matcher ? { matcher: o.matcher } : {}),
  sequential: false,
  onceKey: o.onceKey ?? null,
  failClosed: o.failClosed ?? false,
  async: o.async ?? false,
  config: { type: 'command', command, timeout: o.timeout ?? 10_000 },
});
export const promptSpec = (reply) => `RIGPH:${Buffer.from(JSON.stringify(reply)).toString('base64')}:END`;
const prompt = (hookId, eventName, reply, o = {}) => ({
  hookId,
  eventName,
  sequential: false,
  onceKey: o.onceKey ?? null,
  failClosed: o.failClosed ?? false,
  async: false,
  config: { type: 'prompt', prompt: `${o.text ?? ''}${promptSpec(reply)} $ARGUMENTS`, timeout: o.timeout ?? 20_000 },
});

// workspace -> [{ catalogId, catalogRevision, hooks }]
export const CATALOGS = {
  'ws-t1': [
    {
      catalogId: 'cat-t1',
      catalogRevision: 1,
      hooks: [
        fn('start', 'SessionStart', 'start'),
        fn('ups', 'UserPromptSubmit', 'ups'),
        fn('perm', 'PermissionRequest', 'perm', { matcher: 'write_file' }),
        fn('pre', 'PreToolUse', 'pre', { matcher: 'write_file' }),
        fn('post', 'PostToolUse', 'post', { matcher: 'write_file' }),
        fn('batch', 'PostToolBatch', 'batch'),
        fn('stop', 'Stop', 'stop'),
        fn('display', 'MessageDisplay', 'display'),
      ],
    },
  ],
  'ws-t2': [
    { catalogId: 'cat-t2', catalogRevision: 1, hooks: [fn('h-a', 'PreToolUse', 'rev1', { matcher: 'write_file' }), fn('h-once', 'UserPromptSubmit', 'once', { onceKey: 'k-once' })] },
    { catalogId: 'cat-t2', catalogRevision: 2, hooks: [fn('h-b', 'PreToolUse', 'rev2', { matcher: 'write_file' }), fn('h-once', 'UserPromptSubmit', 'once', { onceKey: 'k-once' })] },
  ],
  'ws-t3': [
    {
      catalogId: 'cat-t3',
      catalogRevision: 1,
      hooks: [
        prompt('p-notify', 'Notification', { ok: true, additionalContext: 'PROMPT-NOTIFY-CTX' }),
        fn('f-notify', 'Notification', 'notify'),
        prompt('p-ups', 'UserPromptSubmit', { ok: true, additionalContext: 'PROMPT-UPS-CTX' }),
        fn('end', 'SessionEnd', 'lifecycle'),
        fn('delete', 'SessionDelete', 'lifecycle'),
      ],
    },
  ],
  'ws-t4': [
    {
      catalogId: 'cat-t4',
      catalogRevision: 1,
      hooks: [http('http-post', 'PostToolUse', '/post', { matcher: 'write_file' }), http('http-notify', 'Notification', '/notify')],
    },
  ],
  'ws-t5': [{ catalogId: 'cat-t5', catalogRevision: 1, hooks: Array.from({ length: 17 }, (_, i) => fn(`slow${i + 1}`, 'Notification', 'slow', { handlerId: `slow${i + 1}` })) }],
  'ws-t5b': [{ catalogId: 'cat-t5b', catalogRevision: 1, hooks: Array.from({ length: 17 }, (_, i) => fn(`slow${i + 1}`, 'Notification', 'slow', { handlerId: `slow${i + 1}`, failClosed: true })) }],
  'ws-t6': [
    {
      catalogId: 'cat-t6',
      catalogRevision: 1,
      hooks: [
        ...Array.from({ length: 8 }, (_, i) => fn(`plain${i + 1}`, 'Notification', 'plain', { handlerId: `plain${i + 1}` })),
        fn('guard-open', 'PreToolUse', 'pre', { matcher: 'write_file', handlerId: 'guard-open' }),
      ],
    },
  ],
  'ws-t6b': [
    {
      catalogId: 'cat-t6b',
      catalogRevision: 1,
      hooks: [
        ...Array.from({ length: 8 }, (_, i) => fn(`plain${i + 1}`, 'Notification', 'plain', { handlerId: `plain${i + 1}` })),
        fn('guard-closed', 'PreToolUse', 'pre', { matcher: 'write_file', handlerId: 'guard-closed', failClosed: true }),
      ],
    },
  ],
  'ws-t7': [
    {
      catalogId: 'cat-t7',
      catalogRevision: 1,
      hooks: [
        http('sec-http', 'Notification', '/secret?token=RIG-SECRET-URL-91c2', { headers: { Authorization: 'Bearer RIG-SECRET-HEADER-7f3a' } }),
        cmd('sec-cmd', 'SessionEnd', 'echo RIG-SECRET-CMD-5d1e'),
        fn('sec-fn', 'Notification', 'notify'),
        prompt('sec-prompt', 'UserPromptSubmit', { ok: true }, { text: 'RIG-PROMPT-TEXT-SENSITIVE ' }),
      ],
    },
  ],
  'ws-t8': [{ catalogId: 'cat-t8', catalogRevision: 1, hooks: [cmd('cmd-ups', 'UserPromptSubmit', `/usr/bin/touch ${RUN}/cmd-ran.marker`), fn('f-notify', 'Notification', 'notify')] }],
  'ws-t9': [{ catalogId: 'cat-t9', catalogRevision: 1, hooks: [fn('ack', 'Notification', 'plain', { handlerId: 'ack' }), fn('ack-pre', 'PreToolUse', 'pre', { matcher: 'write_file', handlerId: 'ack-pre' })] }],
};
for (const [i, l] of ["b","c","d","e"].entries()) { CATALOGS[`ws-t4${l}`] = [{ ...CATALOGS['ws-t4'][0], catalogId: `cat-t4${l}` }]; CATALOGS[`ws-t9${l}`] = [{ ...CATALOGS['ws-t9'][0], catalogId: `cat-t9${l}` }]; }
CATALOGS['ws-t6c'] = [{ ...CATALOGS['ws-t6b'][0], catalogId: 'cat-t6c' }];
CATALOGS['ws-hv'] = [{ catalogId: 'cat-hv', catalogRevision: 1, hooks: [fn('hv-ups', 'UserPromptSubmit', 'ups', { handlerId: 'hv', handlerRevision: 2 })] }];
CATALOGS['ws-hvs'] = [{ catalogId: 'cat-hvs', catalogRevision: 1, hooks: [fn('hv-start', 'SessionStart', 'start', { handlerId: 'hvs', handlerRevision: 2 })] }];
CATALOGS['ws-hvp'] = [{ catalogId: 'cat-hvp', catalogRevision: 1, hooks: [fn('hv-pre', 'PreToolUse', 'pre', { matcher: 'write_file', handlerId: 'hvp', handlerRevision: 2 })] }];
CATALOGS['ws-t8p'] = [{ catalogId: 'cat-t8p', catalogRevision: 1, hooks: [cmd('cmd-pre', 'PreToolUse', `/usr/bin/touch ${RUN}/cmd-ran.marker`, { matcher: 'write_file' })] }];
CATALOGS['ws-hvo'] = [{ catalogId: 'cat-hvo', catalogRevision: 1, hooks: [fn('hvo-ups', 'UserPromptSubmit', 'ups', { handlerId: 'hvo', handlerRevision: 2, onceKey: 'k-hvo' })] }];
CATALOGS['ws-t8s'] = [{ catalogId: 'cat-t8s', catalogRevision: 1, hooks: [cmd('cmd-start', 'SessionStart', `/usr/bin/touch ${RUN}/cmd-ran.marker`)] }];
CATALOGS['ws-cx'] = [{ catalogId: 'cat-cx', catalogRevision: 1, hooks: [fn('cx-ups', 'UserPromptSubmit', 'cxUps'), fn('cx-pre', 'PreToolUse', 'cxPre', { matcher: 'write_file' }), fn('cx-post', 'PostToolUse', 'cxPost', { matcher: 'write_file' }), fn('cx-stop', 'Stop', 'cxStop')] }];
CATALOGS['ws-life1'] = [{ catalogId: 'cat-life1', catalogRevision: 1, hooks: [fn('end-throw', 'SessionEnd', 'lifeThrow'), fn('del', 'SessionDelete', 'lifecycle')] }];
CATALOGS['ws-life2'] = [{ catalogId: 'cat-life2', catalogRevision: 1, hooks: [fn('end-missing', 'SessionEnd', 'lifecycle', { handlerId: 'endmiss', handlerRevision: 2 }), fn('del', 'SessionDelete', 'lifecycle')] }];
CATALOGS['ws-life3'] = [{ catalogId: 'cat-life3', catalogRevision: 1, hooks: [http('end-http', 'SessionEnd', '/end'), fn('del', 'SessionDelete', 'lifecycle')] }];
CATALOGS['ws-life4'] = [{ catalogId: 'cat-life4', catalogRevision: 1, hooks: [fn('end', 'SessionEnd', 'lifecycle'), fn('del', 'SessionDelete', 'lifecycle')] }];
if (process.env.DROP_CAT !== 'ws-dr') CATALOGS['ws-dr'] = [{ catalogId: 'cat-dr', catalogRevision: 1, hooks: [fn('dr-pre', 'PreToolUse', 'pre', { matcher: 'write_file', handlerId: 'drpre' })] }];
CATALOGS['ws-act'] = [{ catalogId: 'cat-act', catalogRevision: 1, hooks: [prompt('p-act', 'Notification', { ok: true, additionalContext: 'PROMPT-NOTIFY-CTX' })] }];
for (const n of ['ws-cx1', 'ws-cx2', 'ws-cx3', 'ws-cx4']) CATALOGS[n] = [{ ...CATALOGS['ws-cx'][0], catalogId: `cat-${n.slice(3)}` }];
CATALOGS['ws-act2'] = [{ ...CATALOGS['ws-act'][0], catalogId: 'cat-act2' }];
CATALOGS['ws-cxn'] = [{ ...CATALOGS['ws-cx'][0], catalogId: 'cat-cxn' }];
CATALOGS['ws-cxh'] = [{ catalogId: 'cat-cxh', catalogRevision: 1, hooks: [http('cxh-pre', 'PreToolUse', '/slowpre', { matcher: 'write_file', timeout: 20_000 })] }];
CATALOGS['ws-hist'] = [{ ...CATALOGS['ws-t1'][0], catalogId: 'cat-hist' }];
CATALOGS['ws-actd'] = [{ ...CATALOGS['ws-act'][0], catalogId: 'cat-actd' }];
CATALOGS['ws-cxh2'] = [{ catalogId: 'cat-cxh2', catalogRevision: 1, hooks: [http('cxh-ups', 'UserPromptSubmit', '/slowups', { timeout: 20_000 })] }];
CATALOGS['ws-cxh3'] = [{ catalogId: 'cat-cxh3', catalogRevision: 1, hooks: [http('cxh-post', 'PostToolUse', '/slowpost', { matcher: 'write_file', timeout: 20_000 })] }];
CATALOGS['ws-cxh4'] = [{ catalogId: 'cat-cxh4', catalogRevision: 1, hooks: [http('cxh-stop', 'Stop', '/slowstop', { timeout: 20_000 })] }];
CATALOGS['ws-cxhh'] = [{ catalogId: 'cat-cxhh', catalogRevision: 1, hooks: [http('cxh-hang', 'PreToolUse', '/hangpre', { matcher: 'write_file', timeout: 10_000 })] }];
for (const [n, p] of [['ws-hto1', '/hang1'], ['ws-hto2', '/hang2'], ['ws-hto3', '/slow5'], ['ws-hto4', '/hang1'], ['ws-hto5', '/hang2']]) CATALOGS[n] = [{ catalogId: `cat-${n.slice(3)}`, catalogRevision: 1, hooks: [http(`${n.slice(3)}-pre`, 'PreToolUse', p, { matcher: 'write_file', timeout: 15 })] }];
CATALOGS['ws-cap'] = [{ ...CATALOGS['ws-t6'][0], catalogId: 'cat-cap' }];
for (const n of ['ws-f1a', 'ws-f1b', 'ws-f1c', 'ws-f1d']) CATALOGS[n] = CATALOGS['ws-t2'].map((c) => ({ ...c, catalogId: `cat-${n.slice(3)}` }));
CATALOGS['ws-lx1'] = [{ catalogId: 'cat-lx1', catalogRevision: 1, hooks: [cmd('cmd-pre', 'PreToolUse', '/lx/cmd/pre.sh', { matcher: 'write_file', timeout: 15_000 }), cmd('cmd-detach', 'UserPromptSubmit', '/lx/cmd/detach.sh', { timeout: 5_000 }), cmd('cmd-long', 'Notification', '/lx/cmd/long.sh', { timeout: 90_000 })] }];
CATALOGS['ws-lx2'] = [{ catalogId: 'cat-lx2', catalogRevision: 1, hooks: [{ ...cmd('cmd-secret', 'Notification', '/lx/cmd/secret.sh', { timeout: 20_000 }), config: { type: 'command', command: '/lx/cmd/secret.sh', timeout: 20_000, env: { RIG_SECRET: 'RIG-ARGV-SECRET-4411' } } }, cmd('cmd-pre', 'PreToolUse', '/lx/cmd/pre.sh', { matcher: 'write_file' })] }];
export const STORAGE = {
  'ws-hto1': 'b5', 'ws-hto2': 'c5', 'ws-hto3': 'd5', 'ws-hto4': 'e5', 'ws-hto5': 'f5',
  'ws-cxh2': 'f4', 'ws-cxh3': 'g4', 'ws-cxh4': 'h4', 'ws-cxhh': 'a5',
  'ws-cxn': 'a4', 'ws-cxh': 'b4', 'ws-hist': 'c4', 'ws-hist0': 'd4', 'ws-actd': 'e4',
  'ws-cx1': 'p', 'ws-cx2': 'q', 'ws-cx3': 'u', 'ws-cx4': 'w', 'ws-act2': 'x',
  'ws-t8s': 'a3', 'ws-cx': 'b3', 'ws-life1': 'c3', 'ws-life2': 'd3', 'ws-life3': 'e3', 'ws-life4': 'f3', 'ws-dr': 'g3', 'ws-act': 'h3',
  'ws-hvo': 'o',
  'ws-hvs': 'a2', 'ws-hvp': 'b2', 'ws-t8p': 'c2', 'ws-cap': 'd2', 'ws-f1a': 'e2', 'ws-f1b': 'f2', 'ws-f1c': 'g2', 'ws-f1d': 'h2',
  'ws-hv': 'z',
  'ws-t6c': 'y',
  'ws-lx1': 'v', 'ws-lx2': 'w', 'ws-lx3': 'x',
  'ws-t4b': 'n', 'ws-t4c': 'o', 'ws-t4d': 'p', 'ws-t4e': 'q', 'ws-t9b': 'r', 'ws-t9c': 's', 'ws-t9d': 't', 'ws-t9e': 'u', 'ws-t1': 'a', 'ws-t2': 'b', 'ws-t3': 'c', 'ws-t4': 'd', 'ws-t5': 'e', 'ws-t5b': 'f', 'ws-t6': 'g', 'ws-t6b': 'h', 'ws-t7': 'i', 'ws-t8': 'j', 'ws-t9': 'k', 'ws-base': 'l', 'ws-base2': 'm' };

export function build() {
  const catalogs = [];
  const pins = {};
  for (const [workspaceId, list] of Object.entries(CATALOGS)) {
    for (const c of list) {
      const definitionDigest = createHash('sha256').update(JSON.stringify(c.hooks)).digest('hex');
      catalogs.push({ tenantId: TENANT, workspaceId, catalogId: c.catalogId, catalogRevision: c.catalogRevision, definitionDigest, hooks: c.hooks });
      pins[`${workspaceId}#${c.catalogRevision}`] = { catalogId: c.catalogId, catalogRevision: c.catalogRevision, definitionDigest };
    }
  }
  return { manifest: { version: 1, catalogs }, pins };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { manifest, pins } = build();
  fs.mkdirSync(RUN, { recursive: true });
  fs.writeFileSync(`${RUN}/hooks.json`, JSON.stringify(manifest, null, 1));
  fs.writeFileSync(`${RUN}/catalogs.json`, JSON.stringify(pins, null, 1));
  console.log(`manifest: ${manifest.catalogs.length} catalogs, ${Buffer.byteLength(JSON.stringify(manifest))} bytes -> ${RUN}/hooks.json`);
}
