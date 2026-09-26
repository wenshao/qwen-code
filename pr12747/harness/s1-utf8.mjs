// S1: boot v2 with bytes that are not UTF-8, real worker processes, base vs PR.
// Base replaces them with U+FFFD, so the mountRoot names a different directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startWorker, post, installation, call, ROUTES, BOOT_V1, BOOT_V2, PR_REPO, BASE_REPO } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12747-s1-'));
const out = [];
const log = (s) => { out.push(s); console.log(s); };
const cases = [
  ['v2, Latin-1 0xE9 in mountRoot', 2, Buffer.from([0x63, 0x61, 0x66, 0xe9])],
  ['v2, encoded surrogate ED A0 80', 2, Buffer.from([0x78, 0xed, 0xa0, 0x80])],
  ['v2, valid UTF-8 "café" (control)', 2, Buffer.from('café', 'utf8')],
  ['v1, Latin-1 0xE9 in workspaceCwd', 1, Buffer.from([0x63, 0x61, 0x66, 0xe9])],
];
// Make every directory the decoded name could land on, each with a marker.
for (const [label, , bytes] of cases) {
  const decoded = bytes.toString('utf8');
  const dir = path.join(base, decoded, 'services/api');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'which.txt'), `dir named ${JSON.stringify(decoded)} (${[...decoded].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')})\n`);
}
log(`base = ${base.replace(os.tmpdir(), '$TMP')}`);
for (const [arm, repo] of [['base 89b057b', BASE_REPO], ['PR   3594356', PR_REPO]]) {
  log(`## ${arm}`);
  for (const [label, version, bytes] of cases) {
    const boot = version === 2 ? { ...BOOT_V2, mountRoot: `${base}/@@` } : { ...BOOT_V1, workspaceCwd: `${base}/@@/services/api` };
    const [before, after] = JSON.stringify(boot).split('@@');
    const raw = Buffer.concat([Buffer.from(before), bytes, Buffer.from(after)]);
    const w = await startWorker(boot, { repo, raw });
    let line;
    if (w.kind !== 'ready') {
      line = `exit ${w.code} before ready; stderr: ${w.stderr.trim().split('\n').pop()}`;
    } else {
      let result;
      if (version === 2) {
        const inst = await post(w.url, ROUTES.CONTEXT, await installation('s1', 'services/api'), boot);
        if (inst.status !== 200) result = `install ${inst.status} ${inst.json?.code}`;
        else {
          const r = await post(w.url, ROUTES.EXECUTE, call('s1', 'c1', 'run_shell_command', { command: 'cat which.txt' }), boot);
          result = `install 200; shell in session: ${/Output: (.*)/.exec(r.json?.result?.responseParts?.[0]?.text ?? '')?.[1] ?? JSON.stringify(r.json).slice(0, 160)}`;
        }
      } else {
        const r = await post(w.url, ROUTES.EXECUTE, call('s1', 'c1', 'run_shell_command', { command: 'cat which.txt' }), boot);
        result = `shell: ${/Output: (.*)/.exec(r.json?.result?.responseParts?.[0]?.text ?? '')?.[1] ?? JSON.stringify(r.json).slice(0, 160)}`;
      }
      line = `ready (${w.ready.protocolVersion ?? w.ready.version ?? JSON.stringify(w.ready).slice(0, 40)}); ${result}`;
    }
    log(`  ${label.padEnd(36)} -> ${line}`);
    await w.close();
  }
}
fs.writeFileSync(process.argv[2] ?? 's1.log', out.join('\n') + '\n');
