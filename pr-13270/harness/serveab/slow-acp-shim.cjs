#!/usr/bin/env node
// QWEN_CLI_ENTRY shim: the daemon spawns `node <this> --acp …` as its ACP child.
// We spawn the REAL CLI with the same argv and proxy the NDJSON JSON-RPC stream
// verbatim in both directions, holding back exactly one frame — the response to
// the `initialize` request — for SLOW_ACP_INIT_HOLD_MS. Frames that arrive during
// the hold are queued and released in order after it. Everything else (real
// child, real capability negotiation, real session/new) stays untouched: this is
// what a contended shared runner looks like from the daemon's side.
'use strict';
const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');

const REAL = process.env.SLOW_ACP_REAL_ENTRY;
const HOLD = Number(process.env.SLOW_ACP_INIT_HOLD_MS || 0);
const LOG = process.env.SLOW_ACP_LOG;
const t0 = Date.now();
const log = (msg) => {
  if (LOG) appendFileSync(LOG, `${new Date().toISOString()} shim[${process.pid}] +${Date.now() - t0}ms ${msg}\n`);
};

const child = spawn(process.execPath, [...process.execArgv, REAL, ...process.argv.slice(2)], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
});
log(`spawned real ACP child pid=${child.pid} hold=${HOLD}ms argv=${JSON.stringify(process.argv.slice(2))}`);

let initId;
let inBuf = '';
process.stdin.on('data', (chunk) => {
  inBuf += chunk.toString('utf8');
  let nl;
  while ((nl = inBuf.indexOf('\n')) !== -1) {
    const line = inBuf.slice(0, nl + 1);
    inBuf = inBuf.slice(nl + 1);
    try {
      const msg = JSON.parse(line);
      if (msg && msg.method === 'initialize' && initId === undefined) {
        initId = msg.id;
        log(`daemon -> child: initialize request id=${initId}`);
      }
    } catch {}
    child.stdin.write(line);
  }
});
process.stdin.on('end', () => {
  log('daemon closed stdin');
  child.stdin.end();
});

let holding = false;
let held = false;
const queue = [];
let outBuf = '';
const flush = () => {
  holding = false;
  for (const l of queue.splice(0)) process.stdout.write(l);
};
child.stdout.on('data', (chunk) => {
  outBuf += chunk.toString('utf8');
  let nl;
  while ((nl = outBuf.indexOf('\n')) !== -1) {
    const line = outBuf.slice(0, nl + 1);
    outBuf = outBuf.slice(nl + 1);
    if (holding) {
      queue.push(line);
      continue;
    }
    let isInitReply = false;
    try {
      const msg = JSON.parse(line);
      isInitReply = initId !== undefined && msg.id === initId && ('result' in msg || 'error' in msg);
    } catch {}
    if (isInitReply && !held && HOLD > 0) {
      held = true;
      holding = true;
      queue.push(line);
      log(`child -> daemon: initialize response id=${initId} HELD for ${HOLD}ms`);
      setTimeout(() => {
        log(`releasing initialize response id=${initId} (+${queue.length - 1} queued frames)`);
        flush();
      }, HOLD);
      continue;
    }
    if (isInitReply) log(`child -> daemon: initialize response id=${initId} passed through`);
    process.stdout.write(line);
  }
});
child.on('exit', (code, signal) => {
  log(`real ACP child exited code=${code} signal=${signal}`);
  process.exit(code ?? 1);
});
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    log(`shim got ${sig}; forwarding`);
    child.kill(sig);
  });
}
