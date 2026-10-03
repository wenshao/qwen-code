// Scripted cell assertions for arms F and G (the round-3 delta A/B).
// Parses the op lines of logs/F-{head,nofix}.log and logs/G-{head,nofix}.log
// and asserts the round-specific expectations. Exit 1 on any failed cell.
import * as fs from 'node:fs';
import * as path from 'node:path';
const logdir = process.argv[2];
const parse = (file) => {
  const raw = fs.readFileSync(path.join(logdir, file), 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
  const ops = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^t\+\s*([\d.]+)s\s+(read|update)\s+(OK\s+gen=(\d+)|ERR\s+(.+?))\s*$/);
    if (m) ops.push({ t: Number(m[1]), op: m[2], ok: !m[2].startsWith('x') && m[3].startsWith('OK'), gen: m[4] ? Number(m[4]) : null, err: m[5] || null });
  }
  // second lines carry manifest/payload/journals
  const details = [...raw.matchAll(/manifest=(\S+) payload=(\d+) v1 \/ (\d+) v2 top=(\[.*?\]) journals=(\[.*\])/g)]
    .map((m) => ({ manifest: m[1], v1: Number(m[2]), v2: Number(m[3]), top: m[4], journals: m[5] }));
  const opsWithPhase = [];
  let cleared = false;
  for (const line of raw.split('\n')) {
    if (line.startsWith('clear') || line.startsWith('release')) cleared = true;
    const m = line.match(/^t\+\s*([\d.]+)s\s+(read|update)\s+(OK\s+gen=(\d+)|ERR\s+(.+?))\s*$/);
    if (m) opsWithPhase.push({ t: Number(m[1]), op: m[2], ok: m[3].startsWith('OK'), gen: m[4] ? Number(m[4]) : null, err: m[5] || null, afterClear: cleared });
  }
  return { ops: opsWithPhase, details, raw };
};

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const F = parse('F-head.log'), Fn = parse('F-nofix.log');
// F-head: first read surfaces the raw errno (EACCES from the chmod fault).
check('F head: 1st read surfaces the raw EACCES', !F.ops[0].ok && /EACCES/.test(F.ops[0].err), F.ops[0].err?.slice(0, 60));
// F-head: in-window ops refuse with ExtensionConflictError; an op past the
// window with the fault still in place retries and surfaces the raw errno
// again - both are refusals. The load-bearing property: nothing is served OK.
const headWindow = F.ops.slice(1).filter((o) => !o.afterClear);
const conflictRefusals = headWindow.filter((o) => !o.ok && /ExtensionConflictError/.test(o.err));
check('F head: in-window ops refuse with ExtensionConflictError', conflictRefusals.length >= 3, headWindow.map((o) => o.err?.slice(0, 40)).join('|'));
check('F head: no op while the fault was in place served OK', headWindow.length > 0 && !headWindow.some((o) => o.ok));
// F-head: after the fault clears and a window lapses, the store heals to v1 and updates.
const headLast = F.ops.slice(-2);
check('F head: heals to consistent v1 after clear+window', headLast[0].ok && headLast[0].gen === 1 && F.details[F.ops.indexOf(headLast[0])]?.v1 === 200 && F.details[F.ops.indexOf(headLast[0])]?.v2 === 0, JSON.stringify(headLast[0]));
check('F head: update after heal lands', headLast[1].ok && headLast[1].gen === 2, JSON.stringify(headLast[1]));

// F-nofix: the round-2 defect reproduces - in-window reads serve OK gen=1 over a torn tree.
const nofixWindow = Fn.ops.slice(1).filter((o) => !o.afterClear);
const served = nofixWindow.filter((o) => o.ok);
check('F nofix: 1st read surfaces the raw EACCES', !Fn.ops[0].ok && /EACCES/.test(Fn.ops[0].err), Fn.ops[0].err?.slice(0, 60));
check('F nofix (control): in-window reads serve OK gen=1 (the defect)', served.length >= 2 && served.every((o) => o.gen === 1), nofixWindow.map((o) => `${o.op}:${o.ok ? 'OK g' + o.gen : 'ERR'}`).join('|'));
const servedIdx = Fn.ops.indexOf(served[0]);
// The defect: serving OK gen=1 while the owed rollback to the v1 artifact never
// ran. The disk tree can be a v1/v2 mix OR fully v2 (kill timing decides);
// both contradict the generation the snapshot names.
const sd = servedIdx >= 0 ? Fn.details[servedIdx] : null;
const diskIsV1 = sd && sd.manifest === '1.0.0' && sd.v1 === 200 && sd.v2 === 0;
check('F nofix (control): the served tree was NOT the committed v1 artifact (rollback never ran)', sd && !diskIsV1 && /"held":false/.test(sd.journals), JSON.stringify(sd));
const nofixLast = Fn.ops.slice(-2);
check('F nofix (control): also heals after clear+window', nofixLast[0].ok && nofixLast[0].gen === 1 && Fn.details[Fn.ops.indexOf(nofixLast[0])]?.v2 === 0, JSON.stringify(nofixLast[0]));
check('F nofix (control): update after heal lands', nofixLast[1].ok && nofixLast[1].gen === 2, JSON.stringify(nofixLast[1]));

const G = parse('G-head.log'), Gn = parse('G-nofix.log');
// G (both dists): reads served with restored v1 + residue dir while held; update
// refused naming the lock; after release the prune completes and journals clear.
for (const [label, g] of [['head', G], ['nofix', Gn]]) {
  const held = g.ops.filter((o) => !o.afterClear);
  const heldReads = held.filter((o) => o.op === 'read');
  check(`G ${label}: reads while held serve restored v1 (gen=1)`, heldReads.length >= 2 && heldReads.every((o) => o.ok && o.gen === 1), heldReads.map((o) => `g${o.gen}`).join(','));
  const firstReadDetail = g.details[g.ops.indexOf(heldReads[0])];
  check(`G ${label}: residue added-dir disclosed during the hold`, firstReadDetail && firstReadDetail.v1 === 200 && firstReadDetail.v2 === 0 && /added-dir/.test(firstReadDetail.top), JSON.stringify(firstReadDetail));
  const heldUpdate = held.find((o) => o.op === 'update');
  check(`G ${label}: update while held refused with ExtensionDirectoryLockedError`, heldUpdate && !heldUpdate.ok && /ExtensionDirectoryLockedError/.test(heldUpdate.err), heldUpdate?.err?.slice(0, 60));
  const after = g.ops.filter((o) => o.afterClear);
  const pruneRead = after[after.length - 2];
  const pruneDetail = pruneRead ? g.details[g.ops.indexOf(pruneRead)] : null;
  check(`G ${label}: after release the prune completes, journals clear`, pruneRead?.ok && pruneDetail && pruneDetail.journals === '[]' && !/added-dir/.test(pruneDetail.top), JSON.stringify(pruneDetail));
  check(`G ${label}: final update lands`, after[after.length - 1]?.ok && after[after.length - 1]?.gen === 2);
}

console.log(`\nFG TOTAL: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
