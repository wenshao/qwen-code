#!/usr/bin/env python3
"""Env-gated (neutral when VERIFY_FAULT is unset): one-shot Store fault injection in the
driver's Store proxy, armed only for the Nth javaLoad() (VERIFY_FAULT_AT, default 1).
Every armed Store request and the javaLoad outcome go to $VERIFY_STORE_LOG. Local only."""
import sys
p = sys.argv[1]
s = open(p).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)
rep("import { createServer } from 'node:http';",
"import { createServer } from 'node:http';\nimport { appendFileSync as verifyAppend, writeFileSync as verifyWrite, rmSync as verifyRm } from 'node:fs';")
rep("""const storeProxy = createServer(async (req, res) => {
  try {
    const payload = await bytes(req);""",
"""const verifyFault = process.env['VERIFY_FAULT'] ?? '';
const verifyLog = process.env['VERIFY_STORE_LOG'];
let verifyArmed = false;
let verifyJavaLoads = 0;
const verifyHits = new Map<string, number>();
const verifyHeld: Array<() => void> = [];
function verifyNote(entry: Record<string, unknown>) {
  if (verifyLog)
    verifyAppend(verifyLog, JSON.stringify({ t: Date.now(), ...entry }) + '\\n');
}
function verifyKind(method: string, url: string) {
  if (method === 'GET' && url.includes('/restore?')) return 'restore';
  if (method === 'GET' && url.includes('/transactions?')) return 'transactions';
  if (method === 'GET' && url.includes('/resources/')) return 'resource';
  if (method === 'POST' && url.endsWith('/writers:renew')) return 'renew';
  if (method === 'POST' && url.endsWith('/transactions:commit')) return 'commit';
  return 'other';
}
const VERIFY_PLAN: Record<string, { kind: string; action: string; times: number }> = {
  'restore-reset': { kind: 'restore', action: 'reset', times: 1 },
  'transactions-503x2': { kind: 'transactions', action: '503', times: 2 },
  'resource-midbody': { kind: 'resource', action: 'midbody', times: 1 },
  'resource-502x2': { kind: 'resource', action: '502', times: 2 },
  'renew-lost': { kind: 'renew', action: 'lost', times: 1 },
  'resource-404-persist': { kind: 'resource', action: '404', times: Infinity },
  'resource-503-persist': { kind: 'resource', action: '503', times: Infinity },
  'restore-wedge': { kind: 'restore', action: 'wedge', times: 1 },
  'commit-lost': { kind: 'commit', action: 'lost', times: 1 },
};
const storeProxy = createServer(async (req, res) => {
  const verifyPlan = verifyArmed ? VERIFY_PLAN[verifyFault] : undefined;
  const verifyK = verifyKind(req.method!, req.url!);
  let verifyAction = 'pass';
  if (verifyPlan && verifyPlan.kind === verifyK) {
    const hits = (verifyHits.get(verifyK) ?? 0) + 1;
    verifyHits.set(verifyK, hits);
    if (hits <= verifyPlan.times) verifyAction = verifyPlan.action;
  }
  if (verifyArmed)
    verifyNote({ store: true, method: req.method, kind: verifyK, action: verifyAction, path: req.url!.replace(/sessions\\/[^/]+/, 'sessions/<id>').replace(/\\?.*$/, '') });
  if (verifyAction === 'reset') {
    req.socket.destroy();
    return;
  }
  if (verifyAction === 'wedge') {
    await new Promise<void>((resolve) => verifyHeld.push(resolve));
    req.socket.destroy();
    return;
  }
  if (['503', '502', '404'].includes(verifyAction)) {
    res.writeHead(Number(verifyAction), {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: { code: verifyAction === '404' ? 'managed_session_resource_not_found' : 'injected_transient', message: `injected ${verifyAction}` } }));
    return;
  }
  try {
    const payload = await bytes(req);""")
rep("""    const output = Buffer.from(await response.arrayBuffer());
    if (
      response.ok &&
      req.url?.endsWith('/tool-results:publish') &&""",
"""    const output = Buffer.from(await response.arrayBuffer());
    if (verifyAction === 'lost') {
      verifyNote({ store: true, lostAfterUpstream: response.status });
      req.socket.destroy();
      return;
    }
    if (verifyAction === 'midbody') {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.write(output.subarray(0, Math.max(1, Math.floor(output.length / 2))));
      setTimeout(() => res.socket?.destroy(), 20);
      return;
    }
    if (
      response.ok &&
      req.url?.endsWith('/tool-results:publish') &&""")
rep("""async function javaLoad(expected = 200) {
  const response = await fetch(config.coldLoadUrl, {""",
"""async function javaLoad(expected = 200) {
  verifyJavaLoads++;
  verifyArmed =
    verifyFault !== '' &&
    verifyJavaLoads === Number(process.env['VERIFY_FAULT_AT'] ?? 1);
  const verifyT0 = Date.now();
  if (verifyArmed) verifyNote({ javaLoadStart: verifyJavaLoads, fault: verifyFault, sessionId });
  if (verifyArmed && process.env['VERIFY_STALL_FLAG'])
    verifyWrite(process.env['VERIFY_STALL_FLAG'], '1');
  let response: Response;
  try {
    response = await verifyJavaFetch();
  } finally {
    if (verifyArmed) {
      verifyArmed = false;
      for (const release of verifyHeld.splice(0)) release();
      if (process.env['VERIFY_STALL_FLAG'])
        verifyRm(process.env['VERIFY_STALL_FLAG'], { force: true });
    }
  }
  const body = await response.text();
  if (verifyFault !== '' && verifyJavaLoads === Number(process.env['VERIFY_FAULT_AT'] ?? 1))
    verifyNote({ javaLoadEnd: verifyJavaLoads, fault: verifyFault, status: response.status, body: body.slice(0, 300), ms: Date.now() - verifyT0, hits: Object.fromEntries(verifyHits) });
  assert.equal(response.status, expected, body);
  return JSON.parse(body) as { clientId: string; code?: string };
}
async function verifyJavaFetch() {
  return fetch(config.coldLoadUrl, {""")
rep("""      storeUrl: storeProxyUrl,
    }),
  });
  const body = await response.text();
  assert.equal(response.status, expected, body);
  return JSON.parse(body) as { clientId: string; code?: string };
}""", """      storeUrl: storeProxyUrl,
    }),
  });
}""")
open(p, 'w').write(s)
print('patched driver')
