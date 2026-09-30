// Records every process that descends from a root PID (the E2E runner), with
// the parent it was first seen under and its full argv, plus the TCP ports the
// descendants listen on and a fixed allow-list of entry-point environment
// variables. Nothing here talks to the processes; it only reads `ps` and
// `lsof`, so the run under observation is the unmodified script.
//
// usage: node watch-procs.mjs <rootPid> <out.jsonl> [pathNeedle ...]
// A process is also recorded when its argv contains one of the path needles,
// so a worker that re-parents away from the runner is still caught.
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const rootPid = Number(process.argv[2]);
const out = process.argv[3];
const needles = process.argv.slice(4);
writeFileSync(out, '');
const startedAt = Date.now();
const seen = new Map(); // pid -> record
const listening = new Map(); // `${pid}:${port}` -> true
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});

function snapshot() {
  const text = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match) {
      rows.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
      });
    }
  }
  return rows;
}

function descendants(rows) {
  const byParent = new Map();
  for (const row of rows) {
    if (!byParent.has(row.ppid)) byParent.set(row.ppid, []);
    byParent.get(row.ppid).push(row);
  }
  const result = new Map();
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift();
    for (const child of byParent.get(pid) ?? []) {
      if (!result.has(child.pid)) {
        result.set(child.pid, child);
        queue.push(child.pid);
      }
    }
  }
  return result;
}

function emit(record) {
  appendFileSync(out, `${JSON.stringify(record)}\n`);
}

let lastPortScan = 0;
while (!stopping) {
  let rows;
  try {
    rows = snapshot();
  } catch {
    continue;
  }
  const now = Date.now();
  const tree = descendants(rows);
  const live = new Set();
  for (const row of rows) {
    const inTree = tree.has(row.pid);
    const byNeedle =
      !inTree &&
      row.pid !== process.pid &&
      needles.some((needle) => row.command.includes(needle)) &&
      !row.command.includes('watch-procs.mjs');
    if (!inTree && !byNeedle) continue;
    live.add(row.pid);
    if (!seen.has(row.pid)) {
      const parent = rows.find((candidate) => candidate.pid === row.ppid);
      const record = {
        kind: 'spawn',
        tMs: now - startedAt,
        pid: row.pid,
        ppid: row.ppid,
        parentCommand: parent?.command.slice(0, 200) ?? null,
        via: inTree ? 'descendant' : 'path-needle',
        command: row.command,
      };
      seen.set(row.pid, record);
      emit(record);
    } else if (seen.get(row.pid).command !== row.command) {
      // exec() replaced the image (for example `sh -c` -> the real binary).
      const record = {
        kind: 'exec',
        tMs: now - startedAt,
        pid: row.pid,
        ppid: row.ppid,
        command: row.command,
      };
      seen.get(row.pid).command = row.command;
      emit(record);
    }
  }
  // For the Spring and CLI processes, read the entry-point variables the
  // runner exported to them. Only these names are ever written out.
  for (const pid of live) {
    const record = seen.get(pid);
    if (record.envDone || !/java -jar|dist\/cli\.js serve/.test(record.command)) {
      continue;
    }
    record.envDone = true;
    try {
      const text = execFileSync('ps', ['eww', '-o', 'command=', '-p', String(pid)], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      const env = {};
      for (const name of [
        'SERVER_PORT',
        'QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED',
        'QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT',
        'QWEN_MANAGED_AGENT_NODE_EXECUTABLE',
        'QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY',
        'QWEN_MANAGED_AGENT_CLI_ENTRY',
        'QWEN_MANAGED_AGENT_HARNESS_BASE_URL',
        'QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED',
        'QWEN_RUNTIME_BROKER_URL',
      ]) {
        const match = new RegExp(`(?:^| )${name}=(\\S*)`).exec(text);
        if (match) env[name] = match[1];
      }
      emit({ kind: 'env', tMs: now - startedAt, pid, env });
    } catch {
      // The process exited between the two ps calls.
    }
  }
  for (const [pid, record] of seen) {
    if (!live.has(pid) && !record.exited) {
      record.exited = true;
      emit({ kind: 'exit', tMs: now - startedAt, pid });
    }
  }
  if (now - lastPortScan > 1500 && live.size > 0) {
    lastPortScan = now;
    try {
      const text = execFileSync(
        'lsof',
        ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', [...live].join(',')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      for (const line of text.split('\n').slice(1)) {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 9) continue;
        const pid = Number(columns[1]);
        const address = columns[8];
        const key = `${pid}:${address}`;
        if (!listening.has(key)) {
          listening.set(key, true);
          emit({ kind: 'listen', tMs: now - startedAt, pid, address });
        }
      }
    } catch {
      // lsof exits 1 when no descendant listens yet.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
}
emit({ kind: 'observer-stop', tMs: Date.now() - startedAt, total: seen.size });
