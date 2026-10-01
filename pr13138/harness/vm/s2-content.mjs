// S2: what ordinary Workspace content does to a capture. Runs on the S1 database while st-a is fenced (S1 leaves it fenced).
// Each case adds one entry to the stopped source tree (as an agent's Shell or a build would have left it), makes a fresh
// operator copy with `cp -a`, captures with a new recovery UUID, records the outcome and the operation row, then removes
// the entry again. Nothing else changes between cases.
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
L.openLog(`s2-content${process.env.TAG ? '-' + process.env.TAG : ''}`);
const { say } = L;
const fromRow = process.env.FENCE_FROM_ROW === '1' ? L.mountRow('a') : null;
if (fromRow && fromRow.state !== 'FENCED') throw new Error(`st-a is not fenced: ${L.mstr(fromRow)}`);
const { fence, revision } = fromRow ? { fence: fromRow.operation, revision: fromRow.revision } : JSON.parse(fs.readFileSync(`${L.OUT}/s1.json`, 'utf8')).again;
const R = `${L.root('a')}/project`;
say(L.hostFacts()); say(`   ${L.mstr(L.mountRow('a'))}`);
const CASES = [
  { id: 'control', what: 'nothing added', add: '', del: '' },
  { id: 'git-repo', what: 'git init + one commit in project/repo', add: `mkdir -p ${R}/repo && cd ${R}/repo && git init -q && echo hello > README.md && git add . && git -c user.email=r@x -c user.name=r commit -qm init`, del: `rm -rf ${R}/repo` },
  { id: 'venv', what: 'python3 -m venv --without-pip project/.venv (bin/python3 -> /usr/bin/python3)', add: `python3 -m venv --without-pip ${R}/.venv`, del: `rm -rf ${R}/.venv` },
  { id: 'abs-link-inside', what: 'absolute symlink to a file inside the root', add: `ln -s ${R}/notes.txt ${R}/abs-notes`, del: `rm -f ${R}/abs-notes` },
  { id: 'rel-link-dir', what: 'relative symlink to a directory inside the root (allowed by design)', add: `ln -s src ${R}/src-link`, del: `rm -f ${R}/src-link` },
  { id: 'dangling-link', what: 'relative symlink whose target does not exist (e.g. a stale build link)', add: `ln -s dist/index.js ${R}/main-link`, del: `rm -f ${R}/main-link` },
  { id: 'escaping-link', what: 'relative symlink that leaves the root (../../../etc/hostname)', add: `ln -s ../../../etc/hostname ${R}/host-link`, del: `rm -f ${R}/host-link` },
  { id: 'hard-link', what: 'second hard link to a regular file (ln, pnpm store, cp -al)', add: `ln ${R}/data.bin ${R}/data-hard`, del: `rm -f ${R}/data-hard` },
  { id: 'fifo', what: 'named pipe left in the tree (mkfifo)', add: `mkfifo ${R}/pipe`, del: `rm -f ${R}/pipe` },
  { id: 'socket', what: 'unix socket file left by a killed dev server', add: `/opt/qwen/node -e "require('net').createServer().listen('${R}/dev.sock',()=>process.exit(0))" || true`, del: `rm -f ${R}/dev.sock` },
];
const rows = [];
for (const c of CASES) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(c.id)) continue;
  say(`== ${c.id}: ${c.what}`);
  if (c.add) { try { L.sh(c.add); } catch (e) { say(`   add failed: ${e.message.split('\n')[0]}`); continue; } }
  const listing = c.add ? L.sh(`cd ${R} && ls -la | grep -v '^total' | grep -E '${c.id === 'git-repo' ? 'repo' : c.id === 'venv' ? '\\.venv' : 'abs-notes|src-link|main-link|host-link|data-hard|pipe|dev.sock'}' || true`) : '';
  if (listing) say(`   source: ${listing.replace(/\s+/g, ' ').slice(0, 160)}`);
  const { bundle } = W.prepareBundle(`s2${process.env.TAG ?? ''}-${c.id}`, { sessions: W.members('a').map((m) => m.id) });
  const copyNote = L.sh(`cd ${bundle}/workspace/project && ls -la 2>/dev/null | grep -cE 'abs-notes|src-link|main-link|host-link|data-hard|pipe|dev.sock|repo|\\.venv' || true`);
  const req = W.captureRequest({ fence, revision, bundle, ...(process.env.CLI_DIST ? { dist: process.env.CLI_DIST } : {}) });
  const r = await W.w1b('capture', req, { oss: true, label: `capture${process.env.TAG ?? ''}-${c.id}` });
  const row = W.opRow(req.operationId);
  say(`   ${W.opStr(row)}`);
  // A refused capture can be retried with the same UUID once the operator fixes the tree: is that still possible?
  let retry = '-';
  if (r.code !== 0) {
    if (c.del) L.sh(c.del);
    const { bundle: b2 } = W.prepareBundle(`s2${process.env.TAG ?? ''}-${c.id}`, { sessions: W.members('a').map((m) => m.id) });
    const rr = await W.w1b('capture', req, { oss: true, label: `capture${process.env.TAG ?? ''}-${c.id}-retry-after-removal` });
    retry = W.summary(rr).slice(0, 90);
    say(`   same-UUID retry after removing the entry: ${retry}`);
  } else if (c.del) L.sh(c.del);
  rows.push({ id: c.id, what: c.what, exit: r.code, outcome: W.summary(r), worker: r.workerLine, state: row?.state ?? '<no row>', lastError: row?.error, retry, stderr: r.stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 300) });
}
say('== summary');
for (const x of rows) say(`   ${x.id.padEnd(16)} exit=${x.exit} state=${String(x.state).padEnd(12)} lastError=${String(x.lastError).padEnd(26)} worker="${x.worker}" retry: ${x.retry}`);
fs.writeFileSync(`${L.OUT}/s2-content${process.env.TAG ? '-' + process.env.TAG : ''}.json`, JSON.stringify(rows, null, 1));
say('S2-DONE');
