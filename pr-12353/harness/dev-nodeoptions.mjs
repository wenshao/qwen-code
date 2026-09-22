// DEV=true is the one launch mode that keeps NODE_OPTIONS for ACP children
// (every other launch scrubs it). Drive the PR's NODE_OPTIONS rewrite through
// the real daemon and compare what the parent Node and the child Node loaded.
// usage: node dev-nodeoptions.mjs <arm> <mode> <case>
//   case = escaped  : --require "<dir\\sub>/p.cjs"   (quoted, backslash escaped)
//   case = triage   : --require "<dir\sub>/p.cjs"    (quoted, bare backslash — the triage shape)
//   case = unquoted : --require <dir\sub>/p.cjs      (unquoted literal backslash)
import fs from 'node:fs';
import path from 'node:path';
import { makeRun, startFakeProvider, startDaemon, acpChildren, alive, sleep, waitFor, memoryStatus, procCmdline, procEnvKeys, heapFlags } from './lib.mjs';

const [arm = 'head', mode = 'enforce', kase = 'escaped'] = process.argv.slice(2);
const name = `dev-${arm}-${mode}-${kase}`;
const run = makeRun(name);
// Two preload files whose paths differ only by the backslash; each records
// which one a given process actually loaded.
const escRoot = path.join(run.dir, 'esc');
const withBs = path.join(escRoot, 'dir\\sub');
const withoutBs = path.join(escRoot, 'dirsub');
for (const [dir, tag] of [[withBs, 'WITH-BACKSLASH'], [withoutBs, 'WITHOUT-BACKSLASH']]) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'p.cjs'),
    `require('fs').appendFileSync(${JSON.stringify(path.join(run.dir, 'loads.jsonl'))}, JSON.stringify({pid: process.pid, role: process.argv.includes('--acp') ? 'acp-child' : 'daemon', loaded: ${JSON.stringify(tag)}, heapMb: +(require('v8').getHeapStatistics().heap_size_limit/1048576).toFixed(0), nodeOptions: process.env.NODE_OPTIONS ?? null}) + '\\n');\n`,
  );
}
const target = `${escRoot}/dir\\sub/p.cjs`; // literal backslash in the real path
const nodeOptions = {
  escaped: `--require "${target.replaceAll('\\', '\\\\')}" --max-old-space-size=3072 --trace-deprecation`,
  triage: `--require "${target}" --max-old-space-size=3072 --trace-deprecation`,
  unquoted: `--require ${target} --max-old-space-size=3072 --trace-deprecation`,
}[kase];

const provider = await startFakeProvider(run);
const d = await startDaemon(run, {
  arm,
  provider,
  env: { DEV: 'true', NODE_OPTIONS: nodeOptions },
  serveArgs: ['--child-heap-mode', mode, '--memory-budget-mb', '1024', '--workspace', run.ws.primary],
});
const out = { arm, mode, case: kase, daemonNodeOptions: nodeOptions, booted: !!d.url };
try {
  if (d.url) {
    out.enforced = memoryStatus((await d.api('GET', '/daemon/status')).json)?.enforced;
    const s = await d.api('POST', '/session', { cwd: run.ws.primary, sessionScope: 'thread' });
    out.session = { status: s.status, code: s.json?.code ?? null, error: typeof s.json === 'object' ? s.json.error ?? null : String(s.json).slice(0, 200) };
    const pid = await waitFor(() => acpChildren(d.child.pid)[0], 15000);
    await sleep(1500);
    out.child = pid
      ? { pid, alive: alive(pid), cmdlineHeapFlags: heapFlags(procCmdline(pid)), env: procEnvKeys(pid, ['NODE_OPTIONS', 'DEV']) }
      : null;
  }
} finally {
  await d.stop();
  const loads = fs.existsSync(path.join(run.dir, 'loads.jsonl'))
    ? fs.readFileSync(path.join(run.dir, 'loads.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  out.loads = loads;
  out.childSpawnErrors = d.log().split('\n').filter((l) => /Cannot find module|MODULE_NOT_FOUND|serve pid=.*Error/.test(l)).slice(0, 3);
  out.bootError = d.url ? null : d.log().split('\n').filter((l) => /Error|error/.test(l)).slice(0, 3);
  out.daemonExit = d.exited();
  await provider.close();
  fs.writeFileSync(path.join(run.dir, 'report.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
}
