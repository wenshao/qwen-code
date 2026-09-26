// S1: boot + route matrix, main (85c16ae878) vs PR (42d6f28a51), real worker processes.
import fs from 'node:fs';
import path from 'node:path';
import { startWorker, post, installation, call, ROUTES, BOOT_V1, BOOT_V2, PR_REPO, MAIN_REPO } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12732-s1-'));
fs.mkdirSync(path.join(base, 'services/api'), { recursive: true });
const out = [];
const log = (s) => { out.push(s); console.log(s); };
const attestV2 = { protocolVersion: 2, provisionRequestId: BOOT_V1.provisionRequestId, tenantId: BOOT_V1.tenantId, workspaceId: BOOT_V1.workspaceId, workspaceGeneration: BOOT_V1.workspaceGeneration, workspaceCwd: path.join(base, "services/api"), capabilityDigest: BOOT_V1.capabilityDigest, isolationClass: 'workspace' };
const fixtures = JSON.parse(fs.readFileSync(path.join(PR_REPO, 'packages/cli/src/serve/contracts/managed-context-v1.fixtures.json'), 'utf8'));
const attestV3 = { ...fixtures.attestationCases.find((c) => c.id === 'canonical').body, mountRoot: base };
const matrix = async (w, boot) => {
  const r = {};
  r['v2/attest'] = (await post(w.url, ROUTES.ATTEST_V2, attestV2, boot)).status;
  r['v3/attest'] = (await post(w.url, ROUTES.ATTEST_V3, attestV3, boot)).status;
  r['v3/context'] = (await post(w.url, ROUTES.CONTEXT, await installation('s1', 'services/api'), boot)).status;
  const e = await post(w.url, ROUTES.EXECUTE, call('s1', 'c1', 'run_shell_command', { command: 'pwd' }), boot);
  r['v2/execute'] = e.status === 200 ? `200 pwd=${/Output: (.*)/.exec(e.json.result.responseParts[0].text)?.[1]?.replace(base, '$BASE')}` : `${e.status} ${e.json?.code ?? ''}`.trim();
  r['v2/status'] = (await post(w.url, ROUTES.STATUS, { protocolVersion: 2, reference: call('s1', 'c1').reference }, boot)).status;
  r['GET /'] = (await fetch(`${w.url}/`)).status;
  return r;
};
for (const [arm, repo] of [['main 85c16ae878', MAIN_REPO], ['PR   42d6f28a51', PR_REPO]]) {
  const v1 = { ...BOOT_V1, workspaceCwd: path.join(base, 'services/api') };
  const w1 = await startWorker(v1, { repo });
  log(`[${arm}] boot v1 -> ${w1.kind}: ${JSON.stringify(w1.ready)?.replace(/"url":"[^"]+"/, '"url":"…"')}`);
  log(`   routes: ${JSON.stringify(await matrix(w1, v1))}`);
  await w1.close();
  const v2 = { ...BOOT_V2, mountRoot: base };
  const w2 = await startWorker(v2, { repo });
  if (w2.kind === 'ready') {
    log(`[${arm}] boot v2 -> ready: ${JSON.stringify(w2.ready).replace(/"url":"[^"]+"/, '"url":"…"')}`);
    log(`   routes: ${JSON.stringify(await matrix(w2, v2))}`);
  } else {
    log(`[${arm}] boot v2 -> exit ${w2.code}, stdout ${w2.stdout.length} bytes, stderr[0]="${w2.stderr.split('\n')[0]}", token in stderr: ${w2.stderr.includes(BOOT_V2.token)}`);
  }
  await w2.close();
  // A boot v2 document with one extra key, and a v1/v2 hybrid.
  for (const [label, doc] of [['boot v2 + extra key', { ...v2, extra: 1 }], ['boot v1 keys + version 2', { ...v1, version: 2 }], ['boot v2 with mountRoot "C:\\\\ws"', { ...v2, mountRoot: 'C:\\ws' }]]) {
    const w = await startWorker(doc, { repo });
    let tail = '';
    if (w.kind === 'ready') {
      const i = await post(w.url, ROUTES.CONTEXT, await installation('s1', '.'));
      tail = `, install "." -> ${i.status} ${i.json?.code ?? ''}`;
    }
    log(`[${arm}] ${label.padEnd(30)} -> ${w.kind === 'ready' ? 'ready v' + w.ready.version : 'exit ' + w.code + ' (no ready line: ' + (w.stdout.length === 0) + ', token in stderr: ' + w.stderr.includes(BOOT_V2.token) + ')'}${tail}`);
    await w.close();
  }
}
fs.writeFileSync(process.argv[2] ?? 's1.log', out.join('\n') + '\n');
